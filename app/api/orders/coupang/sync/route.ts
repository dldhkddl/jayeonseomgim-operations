import { env } from "cloudflare:workers";
import { CoupangApiError } from "../../../../lib/coupang";
import { syncCoupangOrders } from "../../../../lib/orders/coupang-order-sync";
import { createCoupangOrderRepository } from "../../../../lib/orders/order-repository";

type CoupangEnv = {
  COUPANG_ACCESS_KEY?: string;
  COUPANG_SECRET_KEY?: string;
  COUPANG_VENDOR_ID?: string;
};

export async function POST(request: Request) {
  const { COUPANG_ACCESS_KEY: accessKey, COUPANG_SECRET_KEY: secretKey, COUPANG_VENDOR_ID: vendorId } = env as unknown as CoupangEnv;
  if (!accessKey || !secretKey || !vendorId) {
    return Response.json({ error: "쿠팡 Access Key, Secret Key, 업체코드 설정이 필요합니다." }, { status: 400 });
  }

  try {
    const daysValue = Number(new URL(request.url).searchParams.get("days") ?? "");
    const historyDays = Number.isFinite(daysValue) && daysValue > 0 ? daysValue : undefined;
    const result = await syncCoupangOrders({
      credentials: { accessKey, secretKey, vendorId },
      repository: createCoupangOrderRepository(),
      historyDays,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CoupangApiError) {
      const message = error.status === 403
        ? "쿠팡 Wing에서 발급한 API 키에 주문 조회 권한이 필요합니다. 업체코드와 키의 판매자 계정도 같아야 합니다."
        : error.message;
      return Response.json({ error: message }, { status: error.status });
    }
    return Response.json({ error: error instanceof Error ? error.message : "쿠팡 주문 수집에 실패했습니다." }, { status: 500 });
  }
}
