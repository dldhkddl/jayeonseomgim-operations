import { env } from "cloudflare:workers";
import { changeNaverStock, getAccessToken, isNaverApiError, isTrustedLocalOperationUrl, readNaverInventory } from "../../../lib/naver";
import { recordInventoryChange, saveInventorySnapshot } from "../../../lib/orders/order-repository";

type NaverEnv = { NAVER_CLIENT_ID?: string; NAVER_CLIENT_SECRET?: string };

async function token() {
  const { NAVER_CLIENT_ID: clientId, NAVER_CLIENT_SECRET: clientSecret } = env as unknown as NaverEnv;
  if (!clientId || !clientSecret) throw new Error("네이버 API 설정이 필요합니다.");
  return (await getAccessToken({ clientId, clientSecret })).accessToken;
}

export async function GET(request: Request) {
  if (!isTrustedLocalOperationUrl(request.url)) return Response.json({ error: "재고 관리는 이 컴퓨터의 localhost에서만 사용할 수 있습니다." }, { status: 403 });
  try {
    const channelProductNo = new URL(request.url).searchParams.get("channelProductNo") ?? "";
    const item = await readNaverInventory(await token(), channelProductNo);
    await saveInventorySnapshot(item);
    return Response.json({ item }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isNaverApiError(error)) return Response.json({ error: error.message, detail: error.detail, stage: error.stage }, { status: error.status || 400 });
    return Response.json({ error: error instanceof Error ? error.message : "네이버 재고 조회에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isTrustedLocalOperationUrl(request.url)) return Response.json({ error: "재고 수정은 이 컴퓨터의 localhost에서만 실행할 수 있습니다." }, { status: 403 });
  let current;
  let stockQuantity = -1;
  try {
    const body = await request.json() as { channelProductNo?: string; stockQuantity?: number };
    stockQuantity = Number(body.stockQuantity);
    const accessToken = await token();
    current = await readNaverInventory(accessToken, String(body.channelProductNo ?? ""));
    await saveInventorySnapshot(current);
    await changeNaverStock(accessToken, current.originProductNo, stockQuantity);
    const item = { ...current, stockQuantity, statusType: stockQuantity === 0 ? "OUTOFSTOCK" : "SALE" };
    await Promise.all([saveInventorySnapshot(item), recordInventoryChange({ item: current, newQuantity: stockQuantity, status: "completed" })]);
    return Response.json({ ok: true, item });
  } catch (error) {
    if (current) await recordInventoryChange({ item: current, newQuantity: stockQuantity, status: "failed", error: error instanceof Error ? error.message : "재고 수정 실패" });
    if (isNaverApiError(error)) return Response.json({ error: error.message, detail: error.detail, stage: error.stage }, { status: error.status || 400 });
    return Response.json({ error: error instanceof Error ? error.message : "네이버 재고 수정에 실패했습니다." }, { status: 500 });
  }
}
