import { env } from "cloudflare:workers";
import { hasMarketPricesSession } from "../../../lib/market-prices/access.ts";
import { MarketPriceRepository } from "../../../lib/market-prices/repository.ts";

export async function GET(request: Request) {
  if (!hasMarketPricesSession(request)) return Response.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "가격 데이터베이스가 연결되지 않았습니다." }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const rows = await new MarketPriceRepository(env.DB).listHistory({
    itemCode: params.get("itemCode") ?? undefined,
    marketCode: params.get("marketCode") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    limit: Number(params.get("limit") ?? 365),
  });
  return Response.json({ rows });
}
