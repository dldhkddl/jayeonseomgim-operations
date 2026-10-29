import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateChannelMargins,
  DEFAULT_CHANNEL_FEES,
  sellingPriceForTargetProductMargin,
} from "../app/lib/margin-calculator.ts";

const baseInput = {
  sellingPrice: 100_000,
  productCost: 40_000,
  customerShippingFee: 0,
  actualShippingCost: 5_000,
  packagingCost: 2_000,
  advertisingCost: 3_000,
  otherCost: 0,
  taxable: false,
};

test("calculates every channel from the same product costs and its editable fee", () => {
  const results = calculateChannelMargins(baseInput, { naver: 5, coupang: 10, cafe24: 4 });

  assert.deepEqual(results.map(({ channel, platformFee, profit, marginRate, roi }) => ({ channel, platformFee, profit, marginRate, roi })), [
    { channel: "naver", platformFee: 5_000, profit: 45_000, marginRate: 45, roi: 90 },
    { channel: "coupang", platformFee: 10_000, profit: 40_000, marginRate: 40, roi: 80 },
    { channel: "cafe24", platformFee: 4_000, profit: 46_000, marginRate: 46, roi: 92 },
  ]);
  assert.equal(results.find((result) => result.channel === "cafe24")?.isBest, true);
  assert.equal(results.find((result) => result.channel === "coupang")?.profitGap, 6_000);
});

test("includes estimated output VAT only when the sale is taxable", () => {
  const [naver] = calculateChannelMargins({ ...baseInput, taxable: true }, { naver: 5, coupang: 10, cafe24: 4 });
  assert.equal(naver.estimatedVat, 9_091);
  assert.equal(naver.profit, 35_909);
});

test("returns safe zero percentages for an empty calculation", () => {
  const results = calculateChannelMargins({
    sellingPrice: 0, productCost: 0, customerShippingFee: 0, actualShippingCost: 0,
    packagingCost: 0, advertisingCost: 0, otherCost: 0, taxable: false,
  }, DEFAULT_CHANNEL_FEES);
  assert.equal(results.every((result) => Number.isFinite(result.marginRate) && result.marginRate === 0), true);
  assert.equal(results.every((result) => Number.isFinite(result.roi) && result.roi === 0), true);
});

test("calculates a selling-price-based target margin from product cost only", () => {
  assert.equal(sellingPriceForTargetProductMargin(10_000, 20), 12_500);
});

test("rounds up so the target margin is never reduced", () => {
  const price = sellingPriceForTargetProductMargin(12_345, 20);

  assert.equal(price, 15_500);
  assert.ok(price !== null && (price - 12_345) / price >= 0.2);
});

test("rejects missing cost and impossible target margins", () => {
  assert.equal(sellingPriceForTargetProductMargin(0, 20), null);
  assert.equal(sellingPriceForTargetProductMargin(10_000, 100), null);
  assert.equal(sellingPriceForTargetProductMargin(10_000, -1), null);
});
