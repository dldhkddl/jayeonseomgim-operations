import { env } from "cloudflare:workers";
import { changeCoupangStock, CoupangApiError } from "../../../lib/coupang";
import { isTrustedLocalMutationRequest } from "../../../lib/naver";

type CoupangEnv = { COUPANG_ACCESS_KEY?: string; COUPANG_SECRET_KEY?: string; COUPANG_VENDOR_ID?: string };

export async function POST(request: Request) {
  if (!isTrustedLocalMutationRequest(request)) {
    return Response.json({ error: "쿠팡 재고 수정은 이 컴퓨터의 localhost에서만 실행할 수 있습니다." }, { status: 403 });
  }
  try {
    const body = await request.json() as { vendorItemId?: string; stockQuantity?: number };
    const values = env as unknown as CoupangEnv;
    if (!values.COUPANG_ACCESS_KEY || !values.COUPANG_SECRET_KEY || !values.COUPANG_VENDOR_ID) {
      return Response.json({ error: "쿠팡 API 설정이 필요합니다." }, { status: 400 });
    }
    await changeCoupangStock({
      accessKey: values.COUPANG_ACCESS_KEY,
      secretKey: values.COUPANG_SECRET_KEY,
      vendorId: values.COUPANG_VENDOR_ID,
    }, String(body.vendorItemId ?? ""), Number(body.stockQuantity));
    return Response.json({ ok: true, stockQuantity: Number(body.stockQuantity) });
  } catch (error) {
    const status = error instanceof CoupangApiError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "쿠팡 재고 수정에 실패했습니다." }, { status });
  }
}
