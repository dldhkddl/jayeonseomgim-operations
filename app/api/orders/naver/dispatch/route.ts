import { env } from "cloudflare:workers";
import { dispatchProductOrders, getAccessToken, isNaverApiError, isTrustedLocalOperationUrl, type NaverDispatchInput } from "../../../../lib/naver";
import { findAlreadyDispatched, recordDispatchResults } from "../../../../lib/orders/order-repository";

type NaverEnv = { NAVER_CLIENT_ID?: string; NAVER_CLIENT_SECRET?: string };
type DispatchResult = { successProductOrderIds?: string[]; successProductOrderInfos?: Array<{ productOrderId?: string }>; failProductOrderInfos?: Array<{ productOrderId?: string; code?: string; message?: string }> };

export async function POST(request: Request) {
  if (!isTrustedLocalOperationUrl(request.url)) return Response.json({ error: "송장 전송은 이 컴퓨터의 localhost에서만 실행할 수 있습니다." }, { status: 403 });
  let rows: NaverDispatchInput[] = [];
  try {
    const body = await request.json() as { rows?: NaverDispatchInput[] };
    rows = Array.isArray(body.rows) ? body.rows : [];
    const duplicateIds = await findAlreadyDispatched(rows.map((row) => String(row.productOrderId ?? "")));
    if (duplicateIds.length) return Response.json({ error: `이미 발송 처리된 주문 ${duplicateIds.length}건이 포함되어 있습니다.`, duplicateIds }, { status: 409 });

    const { NAVER_CLIENT_ID: clientId, NAVER_CLIENT_SECRET: clientSecret } = env as unknown as NaverEnv;
    if (!clientId || !clientSecret) return Response.json({ error: "네이버 API 설정이 필요합니다." }, { status: 400 });
    const { accessToken } = await getAccessToken({ clientId, clientSecret });
    const result = await dispatchProductOrders(accessToken, rows) as DispatchResult;
    const successIds = result.successProductOrderIds ?? result.successProductOrderInfos?.map((item) => item.productOrderId ?? "").filter(Boolean) ?? [];
    const failures = result.failProductOrderInfos ?? [];
    if (!successIds.length && !failures.length) throw new Error("네이버가 주문별 발송 처리 결과를 반환하지 않았습니다.");
    const byId = new Map(rows.map((row) => [row.productOrderId, row]));
    await recordDispatchResults([
      ...successIds.flatMap((id) => {
        const row = byId.get(id); return row ? [{ productOrderId: id, carrierCode: row.deliveryCompanyCode, trackingNumber: row.trackingNumber, status: "completed" as const }] : [];
      }),
      ...failures.flatMap((failure) => {
        const id = failure.productOrderId ?? ""; const row = byId.get(id); return row ? [{ productOrderId: id, carrierCode: row.deliveryCompanyCode, trackingNumber: row.trackingNumber, status: "failed" as const, error: failure.message || failure.code || "발송 처리 실패" }] : [];
      }),
    ]);
    return Response.json({ ok: failures.length === 0, successIds, failures });
  } catch (error) {
    if (isNaverApiError(error)) return Response.json({ error: error.message, detail: error.detail, stage: error.stage }, { status: error.status || 400 });
    return Response.json({ error: error instanceof Error ? error.message : "네이버 송장 전송에 실패했습니다." }, { status: 500 });
  }
}
