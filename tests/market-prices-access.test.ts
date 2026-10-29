import test from "node:test";
import assert from "node:assert/strict";
import { isMarketPricesPassword, isValidMarketPricesSession } from "../app/lib/market-prices/access.ts";

test("accepts only the configured shared dashboard password", () => {
  assert.equal(isMarketPricesPassword("office-pass", "office-pass"), true);
  assert.equal(isMarketPricesPassword("wrong", "office-pass"), false);
  assert.equal(isMarketPricesPassword("office-pass", ""), false);
});

test("accepts a non-expired session timestamp and rejects expired values", () => {
  const now = 1_700_000_000_000;
  assert.equal(isValidMarketPricesSession(String(now + 60_000), now), true);
  assert.equal(isValidMarketPricesSession(String(now - 1), now), false);
  assert.equal(isValidMarketPricesSession("not-a-time", now), false);
});
