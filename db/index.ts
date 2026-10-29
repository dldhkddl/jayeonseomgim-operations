import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

let fulfillmentSchemaReady: Promise<void> | null = null;

export function ensureFulfillmentSchema() {
  if (fulfillmentSchemaReady) return fulfillmentSchemaReady;
  fulfillmentSchemaReady = (async () => {
    const db = env.DB;
    if (!db) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
    const statements = [
      "CREATE TABLE IF NOT EXISTS shipment_dispatches (id text PRIMARY KEY NOT NULL, channel text NOT NULL, product_order_id text NOT NULL, carrier_code text NOT NULL, tracking_number text NOT NULL, status text NOT NULL, error text, requested_at text NOT NULL, completed_at text)",
      "CREATE UNIQUE INDEX IF NOT EXISTS shipment_dispatch_channel_order_idx ON shipment_dispatches (channel, product_order_id)",
      "CREATE INDEX IF NOT EXISTS shipment_dispatch_requested_idx ON shipment_dispatches (channel, requested_at)",
      "CREATE TABLE IF NOT EXISTS inventory_snapshots (id text PRIMARY KEY NOT NULL, channel text NOT NULL, channel_product_no text NOT NULL, origin_product_no text NOT NULL, product_name text DEFAULT '' NOT NULL, seller_management_code text DEFAULT '' NOT NULL, status_type text DEFAULT '' NOT NULL, stock_quantity integer NOT NULL, fetched_at text NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS inventory_snapshot_channel_product_idx ON inventory_snapshots (channel, channel_product_no)",
      "CREATE TABLE IF NOT EXISTS inventory_changes (id text PRIMARY KEY NOT NULL, channel text NOT NULL, channel_product_no text NOT NULL, origin_product_no text NOT NULL, previous_quantity integer NOT NULL, new_quantity integer NOT NULL, status text NOT NULL, error text, requested_at text NOT NULL, completed_at text)",
      "CREATE INDEX IF NOT EXISTS inventory_changes_product_requested_idx ON inventory_changes (channel, channel_product_no, requested_at)",
      "CREATE TABLE IF NOT EXISTS central_inventory_items (id text PRIMARY KEY NOT NULL, seller_product_code text NOT NULL, product_name text DEFAULT '' NOT NULL, master_channel_product_no text NOT NULL, master_origin_product_no text NOT NULL, available_quantity integer NOT NULL, mapping_source text DEFAULT 'auto' NOT NULL, initialized_at text NOT NULL, updated_at text NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS central_inventory_seller_code_idx ON central_inventory_items (seller_product_code)",
      "CREATE TABLE IF NOT EXISTS central_inventory_mappings (id text PRIMARY KEY NOT NULL, central_inventory_id text NOT NULL, channel text NOT NULL, channel_product_no text NOT NULL, origin_product_no text NOT NULL, created_at text NOT NULL)",
      "CREATE UNIQUE INDEX IF NOT EXISTS central_inventory_mapping_channel_product_idx ON central_inventory_mappings (channel, channel_product_no)",
      "CREATE INDEX IF NOT EXISTS central_inventory_mapping_central_idx ON central_inventory_mappings (central_inventory_id)",
      "CREATE TABLE IF NOT EXISTS central_inventory_reservations (id text PRIMARY KEY NOT NULL, central_inventory_id text NOT NULL, channel text NOT NULL, product_order_id text NOT NULL, quantity integer NOT NULL, status text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL)",
      "CREATE INDEX IF NOT EXISTS central_inventory_reservation_central_idx ON central_inventory_reservations (central_inventory_id)",
    ];
    await db.batch(statements.map((statement) => db.prepare(statement)));
    const columnResult = await db.prepare("PRAGMA table_info(central_inventory_items)").all<{ name: string }>();
    if (!columnResult.results.some((column) => column.name === "mapping_source")) {
      await db.prepare("ALTER TABLE central_inventory_items ADD COLUMN mapping_source text DEFAULT 'auto' NOT NULL").run();
      await db.prepare("UPDATE central_inventory_items SET mapping_source = 'manual' WHERE initialized_at > (SELECT MIN(initialized_at) FROM central_inventory_items)").run();
    }
  })().catch((error) => {
    fulfillmentSchemaReady = null;
    throw error;
  });
  return fulfillmentSchemaReady;
}
