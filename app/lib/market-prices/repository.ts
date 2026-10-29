import type { GarakMarketPrice, GarakPriceQuery, MarketPriceHistoryFilter } from "./types";

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
};

export type D1Executor = {
  prepare(query: string): D1PreparedStatement;
};

export class MarketPriceRepository {
  private readonly db: D1Executor;

  constructor(db: D1Executor) {
    this.db = db;
  }

  async upsertPrices(prices: GarakMarketPrice[]): Promise<void> {
    await ensureMarketPriceSchema(this.db);
    for (const price of prices) {
      await this.db.prepare(`
        INSERT INTO market_price_observations (
          id, source, price_date, previous_date, category_code, market_code,
          item_code, item_name, grade, trade_quantity, unit_quantity,
          average_price, previous_day_change_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          previous_date = excluded.previous_date,
          item_name = excluded.item_name,
          trade_quantity = excluded.trade_quantity,
          average_price = excluded.average_price,
          previous_day_change_rate = excluded.previous_day_change_rate,
          fetched_at = CURRENT_TIMESTAMP
      `).bind(
        price.id, price.source, price.priceDate, price.previousDate,
        price.categoryCode, price.marketCode, price.itemCode, price.itemName,
        price.grade, price.tradeQuantity, price.unitQuantity, price.averagePrice,
        price.previousDayChangeRate,
      ).run();
    }
  }

  async listHistory(filter: MarketPriceHistoryFilter = {}): Promise<GarakMarketPrice[]> {
    await ensureMarketPriceSchema(this.db);
    const clauses = ["1 = 1"];
    const values: unknown[] = [];
    if (filter.itemCode) { clauses.push("item_code = ?"); values.push(filter.itemCode); }
    if (filter.marketCode) { clauses.push("market_code = ?"); values.push(filter.marketCode); }
    if (filter.from) { clauses.push("price_date >= ?"); values.push(filter.from); }
    if (filter.to) { clauses.push("price_date <= ?"); values.push(filter.to); }
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
    const result = await this.db.prepare(`
      SELECT id, source, price_date AS priceDate, previous_date AS previousDate,
        category_code AS categoryCode, market_code AS marketCode, item_code AS itemCode,
        item_name AS itemName, grade, trade_quantity AS tradeQuantity,
        unit_quantity AS unitQuantity, average_price AS averagePrice,
        previous_day_change_rate AS previousDayChangeRate
      FROM market_price_observations
      WHERE ${clauses.join(" AND ")}
      ORDER BY price_date DESC, item_code ASC, grade ASC
      LIMIT ${limit}
    `).bind(...values).all<GarakMarketPrice>();
    return result.results;
  }

  async startIngestionRun(input: { id: string; query: GarakPriceQuery; startedAt?: string }): Promise<void> {
    await ensureMarketPriceSchema(this.db);
    await this.db.prepare(`
      INSERT INTO market_price_ingestion_runs (id, source, query_json, status, started_at, fetched_count, persisted_count)
      VALUES (?, 'garak', ?, 'running', ?, 0, 0)
      ON CONFLICT(id) DO UPDATE SET status = 'running', started_at = excluded.started_at,
        completed_at = NULL, fetched_count = 0, persisted_count = 0, error = NULL
    `).bind(input.id, JSON.stringify(input.query), input.startedAt ?? new Date().toISOString()).run();
  }

  async completeIngestionRun(id: string, input: { fetchedCount: number; persistedCount: number; completedAt?: string }): Promise<void> {
    await this.db.prepare(`
      UPDATE market_price_ingestion_runs
      SET status = 'completed', fetched_count = ?, persisted_count = ?, completed_at = ?, error = NULL
      WHERE id = ?
    `).bind(input.fetchedCount, input.persistedCount, input.completedAt ?? new Date().toISOString(), id).run();
  }

  async failIngestionRun(id: string, error: unknown, completedAt = new Date().toISOString()): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.db.prepare(`
      UPDATE market_price_ingestion_runs
      SET status = 'failed', error = ?, completed_at = ?
      WHERE id = ?
    `).bind(message, completedAt, id).run();
  }
}

async function ensureMarketPriceSchema(db: D1Executor): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS market_price_observations (id TEXT PRIMARY KEY, source TEXT NOT NULL, price_date TEXT NOT NULL, previous_date TEXT NOT NULL, category_code TEXT NOT NULL, market_code TEXT NOT NULL, item_code TEXT NOT NULL, item_name TEXT NOT NULL, grade TEXT NOT NULL, trade_quantity INTEGER NOT NULL, unit_quantity INTEGER NOT NULL, average_price INTEGER NOT NULL, previous_day_change_rate REAL, fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS market_price_history_idx ON market_price_observations(item_code, market_code, price_date)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS market_price_ingestion_runs (id TEXT PRIMARY KEY, source TEXT NOT NULL, query_json TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, fetched_count INTEGER NOT NULL DEFAULT 0, persisted_count INTEGER NOT NULL DEFAULT 0, error TEXT)`).run();
}
