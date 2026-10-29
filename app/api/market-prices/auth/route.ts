import {
  createMarketPricesSession,
  getMarketPricesPassword,
  isMarketPricesPassword,
  MARKET_PRICES_SESSION_COOKIE,
  MARKET_PRICES_SESSION_TTL_MS,
} from "../../../lib/market-prices/access.ts";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!isMarketPricesPassword(body.password ?? "", getMarketPricesPassword())) {
    return Response.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const value = createMarketPricesSession();
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${MARKET_PRICES_SESSION_COOKIE}=${value}; Max-Age=${Math.floor(MARKET_PRICES_SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax; Secure`,
      },
    },
  );
}
