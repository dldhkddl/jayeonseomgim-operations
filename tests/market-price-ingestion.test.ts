import assert from "node:assert/strict";
import test from "node:test";
import { buildGarakPriceQueries, collectGarakPriceQueries } from "../app/lib/market-prices/ingestion.ts";

test("builds Garak queries with a required requested item instead of a blank item", () => {
  const queries = buildGarakPriceQueries({
    now: new Date("2026-08-12T03:00:00.000Z"),
    itemNames: ["  복숭아  ", ""],
    categoryCode: "2",
    marketCode: "1",
  });

  assert.deepEqual(queries, [{
    searchDate: "20260812",
    previousDate: "20260811",
    categoryCode: "2",
    marketCode: "1",
    itemName: "복숭아",
  }]);
});

test("rejects ingestion when no fruit item was provided", () => {
  assert.throws(
    () => buildGarakPriceQueries({
      now: new Date("2026-08-12T03:00:00.000Z"),
      itemNames: ["", "   "],
      categoryCode: "2",
      marketCode: "1",
    }),
    /품목명을 입력해 주세요/,
  );
});

test("builds one real Garak query per calendar day for a 30-day history", () => {
  const queries = buildGarakPriceQueries({
    now: new Date("2026-08-12T03:00:00.000Z"),
    itemNames: ["복숭아 가납암(백)"],
    categoryCode: "2",
    marketCode: "1",
    days: 3,
  });

  assert.deepEqual(queries.map((query) => [query.searchDate, query.previousDate, query.itemName]), [
    ["20260812", "20260811", "복숭아 가납암(백)"],
    ["20260811", "20260810", "복숭아 가납암(백)"],
    ["20260810", "20260809", "복숭아 가납암(백)"],
  ]);
});

test("caps history collection at 30 days", () => {
  const queries = buildGarakPriceQueries({
    now: new Date("2026-08-12T03:00:00.000Z"),
    itemNames: ["복숭아"],
    categoryCode: "2",
    marketCode: "1",
    days: 90,
  });

  assert.equal(queries.length, 30);
  assert.equal(queries.at(-1)?.searchDate, "20260714");
});

test("keeps real successful days and records API gaps without inventing rows", async () => {
  const queries = buildGarakPriceQueries({
    now: new Date("2026-08-12T03:00:00.000Z"),
    itemNames: ["복숭아 가납암(백)"],
    categoryCode: "2",
    marketCode: "1",
    days: 3,
  });
  const persistedDates: string[] = [];
  const failedDates: string[] = [];

  const result = await collectGarakPriceQueries(queries, {
    fetch: async (query) => {
      if (query.searchDate === "20260811") throw new Error("no auction data");
      return [{ priceDate: query.searchDate }];
    },
    persist: async (rows) => { persistedDates.push(...rows.map((row) => row.priceDate)); },
    onFailure: async (query) => { failedDates.push(query.searchDate); },
  });

  assert.deepEqual(persistedDates, ["20260812", "20260810"]);
  assert.deepEqual(failedDates, ["20260811"]);
  assert.deepEqual(result, { fetched: 2, completedDates: ["20260812", "20260810"], failedDates: ["20260811"] });
});
