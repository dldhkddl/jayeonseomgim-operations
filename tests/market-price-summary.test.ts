import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketPriceTrend, connectMarketTrend, describeMarketTrendPoint, filterMarketPrices, filterMarketPricesByQuery, formatMarketPackageUnit, marketGradeOptions, marketPackageOptions, summarizeMarketPriceTrend, summarizeMarketPrices } from "../app/lib/market-prices/summary.ts";
import type { GarakMarketPrice } from "../app/lib/market-prices/types.ts";

test("finds the highest and lowest positive prices across the search results", () => {
  const low = price({ id: "low", itemName: "복숭아 가납암(백)", grade: "하", unitQuantity: 2.5, averagePrice: 5646 });
  const high = price({ id: "high", itemName: "복숭아 경봉(백)", grade: "특", unitQuantity: 10, averagePrice: 52586 });
  const unavailable = price({ id: "zero", averagePrice: 0 });

  const summary = summarizeMarketPrices([price({ id: "middle", averagePrice: 12375 }), high, unavailable, low]);

  assert.equal(summary?.highest, high);
  assert.equal(summary?.lowest, low);
  assert.equal(summary?.spread, 46940);
});

test("returns no summary when there are no positive prices", () => {
  assert.equal(summarizeMarketPrices([price({ averagePrice: 0 })]), null);
});

test("keeps only the searched fruit in cards, summaries, and tables", () => {
  const peach = price({ id: "peach", itemCode: "복숭아", itemName: "복숭아 백도(백)" });
  const apple = price({ id: "apple", itemCode: "사과", itemName: "사과 홍로" });

  assert.deepEqual(filterMarketPricesByQuery([apple, peach], "복숭아"), [peach]);
});

test("shows no market results before a fruit has been searched", () => {
  const peach = price({ id: "peach", itemName: "복숭아 백도(백)" });

  assert.deepEqual(filterMarketPricesByQuery([peach], ""), []);
  assert.deepEqual(filterMarketPricesByQuery([peach], "   "), []);
});

test("labels the auction price with its kilogram package size", () => {
  assert.equal(formatMarketPackageUnit(1), "1kg 포장");
  assert.equal(formatMarketPackageUnit(4), "4kg 포장");
  assert.equal(formatMarketPackageUnit(2.5), "2.5kg 포장");
});

test("offers only kilogram sizes that exist in the API results", () => {
  assert.deepEqual(marketPackageOptions([
    price({ unitQuantity: 10 }),
    price({ unitQuantity: 2.5 }),
    price({ unitQuantity: 10 }),
    price({ unitQuantity: 4 }),
  ]), [2.5, 4, 10]);
});

test("offers only grades that exist in the API results", () => {
  assert.deepEqual(marketGradeOptions([
    price({ grade: "상" }),
    price({ grade: "특" }),
    price({ grade: "보통" }),
    price({ grade: "하" }),
    price({ grade: "상" }),
    price({ grade: "" }),
  ]), ["특", "상", "보통", "하", "등급 미상"]);
});

test("filters market rows by grade and package together", () => {
  const ordinaryFive = price({ id: "ordinary-five", grade: "보통", unitQuantity: 5 });
  const premiumFive = price({ id: "premium-five", grade: "특", unitQuantity: 5 });
  const ordinaryTen = price({ id: "ordinary-ten", grade: "보통", unitQuantity: 10 });

  assert.deepEqual(filterMarketPrices([ordinaryFive, premiumFive, ordinaryTen], {
    unit: "5",
    grade: "보통",
  }), [ordinaryFive]);
  assert.deepEqual(filterMarketPrices([ordinaryFive], { unit: "10", grade: "특" }), []);
});

test("builds a chronological trend for the exact variety, grade, and package", () => {
  const selected = price({ itemName: "복숭아 가납암(백)", itemCode: "복숭아 가납암(백)", grade: "보통", unitQuantity: 2.5 });
  const yesterday = price({ ...selected, id: "yesterday", priceDate: "20260811", averagePrice: 7000 });
  const today = price({ ...selected, id: "today", priceDate: "20260812", averagePrice: 7945 });
  const wrongGrade = price({ ...selected, id: "wrong-grade", grade: "특", averagePrice: 12375 });
  const wrongUnit = price({ ...selected, id: "wrong-unit", unitQuantity: 5, averagePrice: 18000 });

  const trend = buildMarketPriceTrend([today, wrongGrade, wrongUnit, yesterday], selected);

  assert.deepEqual(trend, [yesterday, today]);
  assert.deepEqual(summarizeMarketPriceTrend(trend), {
    previous: yesterday,
    latest: today,
    change: 945,
    changeRate: 13.5,
  });
});

test("connects real trading-day points with one line without creating missing-day rows", () => {
  const august10 = price({ id: "10", priceDate: "20260810" });
  const august11 = price({ id: "11", priceDate: "20260811" });
  const august13 = price({ id: "13", priceDate: "20260813" });

  assert.deepEqual(connectMarketTrend([august10, august11, august13]), [august10, august11, august13]);
});

test("describes each real chart point against the previous trading day", () => {
  const previous = price({ id: "previous", priceDate: "20260810", averagePrice: 7000 });
  const current = price({ id: "current", priceDate: "20260812", averagePrice: 7945 });

  assert.equal(describeMarketTrendPoint(current, previous), "8/12 · 7,945원 · 직전 거래일 대비 +945원 (+13.5%)");
  assert.equal(describeMarketTrendPoint(previous, null), "8/10 · 7,000원 · 첫 거래 데이터");
});

function price(overrides: Partial<GarakMarketPrice> = {}): GarakMarketPrice {
  return {
    id: "price",
    source: "garak",
    priceDate: "20260812",
    previousDate: "20260811",
    categoryCode: "2",
    marketCode: "1",
    itemCode: "복숭아",
    itemName: "복숭아",
    grade: "상",
    tradeQuantity: 0,
    unitQuantity: 5,
    averagePrice: 12000,
    previousDayChangeRate: 0,
    ...overrides,
  };
}
