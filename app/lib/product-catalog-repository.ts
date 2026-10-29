import type { Product } from "./products.ts";
import type { D1Executor } from "./market-prices/repository.ts";

const CATALOG_ID = "default";

export class ProductCatalogRepository {
  constructor(private readonly db: D1Executor) {}

  async load(): Promise<{ initialized: boolean; products: Product[] }> {
    await this.ensureSchema();
    const result = await this.db.prepare(
      "SELECT products_json AS productsJson FROM product_catalog_state WHERE id = ? LIMIT 1",
    ).bind(CATALOG_ID).all<{ productsJson: string }>();
    const row = result.results[0];
    if (!row) return { initialized: false, products: [] };
    try {
      const products = JSON.parse(row.productsJson) as Product[];
      return { initialized: true, products: Array.isArray(products) ? products : [] };
    } catch {
      return { initialized: true, products: [] };
    }
  }

  async save(products: Product[]): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare(`
      INSERT INTO product_catalog_state (id, products_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        products_json = excluded.products_json,
        updated_at = CURRENT_TIMESTAMP
    `).bind(CATALOG_ID, JSON.stringify(products)).run();
  }

  private async ensureSchema(): Promise<void> {
    await this.db.prepare(`CREATE TABLE IF NOT EXISTS product_catalog_state (id TEXT PRIMARY KEY, products_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  }
}
