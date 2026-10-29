import { env } from "cloudflare:workers";
import { changeCoupangSalesStatus, CoupangApiError } from "../../../../lib/coupang";
import { isTrustedLocalMutationRequest } from "../../../../lib/naver";

type CoupangEnv = { COUPANG_ACCESS_KEY?: string; COUPANG_SECRET_KEY?: string; COUPANG_VENDOR_ID?: string };

export async function POST(request: Request) {
  if (!isTrustedLocalMutationRequest(request)) {
    return Response.json({ error: "쿠팡 판매 상태 변경은 이 컴퓨터의 localhost에서만 실행할 수 있습니다." }, { status: 403 });
  }
  try {
    const body = await request.json() as { vendorItemId?: string; statusType?: string };
    if (body.statusType !== "SALE" && body.statusType !== "SUSPENSION") {
      return Response.json({ error: "판매중 또는 판매중지 상태만 변경할 수 있습니다." }, { status: 400 });
    }
    const values = env as unknown as CoupangEnv;
    if (!values.COUPANG_ACCESS_KEY || !values.COUPANG_SECRET_KEY || !values.COUPANG_VENDOR_ID) {
      return Response.json({ error: "쿠팡 API 설정이 필요합니다." }, { status: 400 });
    }
    await changeCoupangSalesStatus({
      accessKey: values.COUPANG_ACCESS_KEY,
      secretKey: values.COUPANG_SECRET_KEY,
      vendorId: values.COUPANG_VENDOR_ID,
    }, String(body.vendorItemId ?? ""), body.statusType);
    return Response.json({ ok: true, statusType: body.statusType });
  } catch (error) {
    const status = error instanceof CoupangApiError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "쿠팡 판매 상태 변경에 실패했습니다." }, { status });
  }
}
