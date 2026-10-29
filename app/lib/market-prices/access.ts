export const MARKET_PRICES_SESSION_COOKIE = "market_prices_session";
export const MARKET_PRICES_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function isMarketPricesPassword(candidate: string, configured: string | undefined): boolean {
  return Boolean(configured && candidate && candidate === configured);
}

export function createMarketPricesSession(now = Date.now()): string {
  return String(now + MARKET_PRICES_SESSION_TTL_MS);
}

export function isValidMarketPricesSession(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const expiresAt = Number(value);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function getMarketPricesPassword(): string | undefined {
  return process.env.MARKET_PRICES_PASSWORD;
}

export function hasMarketPricesSession(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${MARKET_PRICES_SESSION_COOKIE}=([^;]+)`));
  return isValidMarketPricesSession(match?.[1]);
}
