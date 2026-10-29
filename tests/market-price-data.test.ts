import assert from "node:assert/strict";
import test from "node:test";
import { GarakClient } from "../app/lib/market-prices/garak-client.ts";
import { MarketPriceRepository, type D1Executor, type D1PreparedStatement } from "../app/lib/market-prices/repository.ts";
import type { GarakMarketPrice } from "../app/lib/market-prices/types.ts";

const query = {
  searchDate: "20260810",
  previousDate: "20260809",
  categoryCode: "100",
  marketCode: "1",
  itemName: "사과",
};

test("GarakClient requests the official query and normalizes price rows", async () => {
  let requestedUrl = "";
  const client = new GarakClient({
    apiKey: "test-key",
    endpoint: "https://api.garak.example/prices",
    fetch: async (input) => {
      requestedUrl = String(input);
      return Response.json({
        items: [{
          PUM_NM: "사과",
          PUM_CODE: "211",
          GRADE_NM: "상품",
          TOT_QTY: "1,200",
          UNIT_QTY: "10",
          AVG_PRC: "35,000",
          DPR1: "12.5",
        }],
      });
    },
  });

  const prices = await client.fetchPrices(query);

  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("serviceKey"), "test-key");
  assert.equal(url.searchParams.get("searchDate"), "20260810");
  assert.equal(url.searchParams.get("previousDate"), "20260809");
  assert.equal(url.searchParams.get("categoryCode"), "100");
  assert.equal(url.searchParams.get("marketCode"), "1");
  assert.equal(url.searchParams.get("itemName"), "사과");
  assert.deepEqual(prices, [{
    id: "20260810:1:100:211:상품:10",
    source: "garak",
    priceDate: "20260810",
    previousDate: "20260809",
    categoryCode: "100",
    marketCode: "1",
    itemCode: "211",
    itemName: "사과",
    grade: "상품",
    tradeQuantity: 1200,
    unitQuantity: 10,
    averagePrice: 35000,
    previousDayChangeRate: 12.5,
  }]);
});

test("MarketPriceRepository upserts observations and filters history", async () => {
  const db = new MemoryD1();
  const repository = new MarketPriceRepository(db);
  const original = price({ averagePrice: 35000 });
  const corrected = price({ averagePrice: 36000 });
  const older = price({ id: "20260809:1:100:211:상품:10", priceDate: "20260809", averagePrice: 34000 });

  await repository.upsertPrices([original, older]);
  await repository.upsertPrices([corrected]);

  assert.deepEqual(await repository.listHistory({ itemCode: "211", from: "20260810", to: "20260810" }), [corrected]);
  assert.equal(db.prices.size, 2);
});

test("MarketPriceRepository records ingestion completion and failure", async () => {
  const db = new MemoryD1();
  const repository = new MarketPriceRepository(db);

  await repository.startIngestionRun({ id: "run-1", query, startedAt: "2026-08-10T01:00:00.000Z" });
  await repository.completeIngestionRun("run-1", { fetchedCount: 2, persistedCount: 1, completedAt: "2026-08-10T01:01:00.000Z" });
  await repository.startIngestionRun({ id: "run-2", query, startedAt: "2026-08-10T02:00:00.000Z" });
  await repository.failIngestionRun("run-2", new Error("upstream unavailable"), "2026-08-10T02:01:00.000Z");

  assert.deepEqual(db.runs.get("run-1"), {
    id: "run-1", source: "garak", queryJson: JSON.stringify(query), status: "completed", startedAt: "2026-08-10T01:00:00.000Z", completedAt: "2026-08-10T01:01:00.000Z", fetchedCount: 2, persistedCount: 1, error: null,
  });
  assert.equal(db.runs.get("run-2")?.status, "failed");
  assert.equal(db.runs.get("run-2")?.error, "upstream unavailable");
});

function price(overrides: Partial<GarakMarketPrice> = {}): GarakMarketPrice {
  return {
    id: "20260810:1:100:211:상품:10", source: "garak", priceDate: "20260810", previousDate: "20260809", categoryCode: "100", marketCode: "1", itemCode: "211", itemName: "사과", grade: "상품", tradeQuantity: 1200, unitQuantity: 10, averagePrice: 35000, previousDayChangeRate: 12.5,
    ...overrides,
  };
}

class MemoryD1 implements D1Executor {
  readonly prices = new Map<string, GarakMarketPrice>();
  readonly runs = new Map<string, Record<string, unknown>>();

  prepare(query: string): D1PreparedStatement {
    return new MemoryStatement(this, query);
  }
}

class MemoryStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly db: MemoryD1;
  private readonly query: string;

  constructor(db: MemoryD1, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: unknown[]): D1PreparedStatement { this.values = values; return this; }

  async run(): Promise<unknown> {
    if (this.query.trimStart().startsWith("CREATE ")) return {};
    if (this.query.includes("market_price_observations")) {
      const [id, source, priceDate, previousDate, categoryCode, marketCode, itemCode, itemName, grade, tradeQuantity, unitQuantity, averagePrice, previousDayChangeRate] = this.values;
      this.db.prices.set(String(id), { id: String(id), source: String(source) as "garak", priceDate: String(priceDate), previousDate: String(previousDate), categoryCode: String(categoryCode), marketCode: String(marketCode), itemCode: String(itemCode), itemName: String(itemName), grade: String(grade), tradeQuantity: Number(tradeQuantity), unitQuantity: Number(unitQuantity), averagePrice: Number(averagePrice), previousDayChangeRate: Number(previousDayChangeRate) });
    } else if (this.query.includes("INSERT INTO market_price_ingestion_runs")) {
      const [id, queryJson, startedAt] = this.values;
      this.db.runs.set(String(id), { id, source: "garak", queryJson, status: "running", startedAt, completedAt: null, fetchedCount: 0, persistedCount: 0, error: null });
    } else if (this.query.includes("status = 'completed'")) {
      const [fetchedCount, persistedCount, completedAt, id] = this.values;
      Object.assign(this.db.runs.get(String(id))!, { status: "completed", fetchedCount, persistedCount, completedAt, error: null });
    } else if (this.query.includes("status = 'failed'")) {
      const [error, completedAt, id] = this.values;
      Object.assign(this.db.runs.get(String(id))!, { status: "failed", error, completedAt });
    }
    return {};
  }

  async all<T>(): Promise<{ results: T[] }> {
    const [itemCode, from, to] = this.values;
    const results = [...this.db.prices.values()]
      .filter((row) => (!itemCode || row.itemCode === itemCode) && (!from || row.priceDate >= from) && (!to || row.priceDate <= to))
      .sort((left, right) => right.priceDate.localeCompare(left.priceDate));
    return { results: results as T[] };
  }
}
