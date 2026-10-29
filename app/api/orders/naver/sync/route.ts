import { env } from "cloudflare:workers";
import { getAccessToken, NaverApiError } from "../../../../lib/naver";
import { NaverOrderApiError } from "../../../../lib/orders/naver-order-api";
import { createOrderRepository } from "../../../../lib/orders/order-repository";
import { syncNaverOrders } from "../../../../lib/orders/naver-order-sync";

type NaverEnv = { NAVER_CLIENT_ID?: string; NAVER_CLIENT_SECRET?: string };

export async function POST(request: Request) {
  const { NAVER_CLIENT_ID: clientId, NAVER_CLIENT_SECRET: clientSecret } = env as unknown as NaverEnv;
  if (!clientId || !clientSecret) return Response.json({ error: "네이버 API 설정이 필요합니다." }, { status: 400 });

  try {
    const { accessToken } = await getAccessToken({ clientId, clientSecret });
    const daysValue = Number(new URL(request.url).searchParams.get("days") ?? "");
    const historyDays = Number.isFinite(daysValue) && daysValue > 0 ? daysValue : undefined;
    const result = await syncNaverOrders({ accessToken, repository: createOrderRepository(), historyDays });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof NaverOrderApiError) {
      const message = error.status === 403
        ? "네이버 개발자센터 애플리케이션에 주문 API 그룹 권한이 필요합니다."
        : error.message;
      return Response.json({ error: message }, { status: error.status });
    }
    if (error instanceof NaverApiError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "네이버 주문 수집에 실패했습니다." }, { status: 500 });
  }
}
