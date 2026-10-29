import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * 상품 템플릿 — "빠른 명령"(예: "사과 39900원에 올려줘")이 찾아 쓰는 재사용 상품 정보.
 * 원산지·품종·상세설명·사진처럼 잘 안 바뀌는 사실은 여기 저장해두고,
 * 명령어에서 가격·재고만 다시 지정하면 그 값으로 덮어써서 등록한다.
 *
 * 브라우저 localStorage(상품 목록)와 달리 서버 D1에 저장되므로 다른 기기·직원과 공유된다.
 */
export const productTemplates = sqliteTable("product_templates", {
  id: text("id").primaryKey(),
  /** 명령어에서 찾는 이름. 예: "사과" */
  name: text("name").notNull(),
  /** 콤마로 구분한 별칭. 예: "부사,홍로,사과박스" */
  aliases: text("aliases").notNull().default(""),
  /** CanonicalRow(공통 상품 스키마) 전체를 JSON 문자열로 저장 */
  data: text("data").notNull(),
  /** 사진 URL 배열 JSON */
  images: text("images").notNull().default("[]"),
  /** 사진별 표지/상세 역할 태그 JSON */
  imageRoles: text("image_roles").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const productCatalogState = sqliteTable("product_catalog_state", {
  id: text("id").primaryKey(),
  productsJson: text("products_json").notNull().default("[]"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * 카페24 OAuth 토큰 — 이 앱은 한 사람(한 쇼핑몰)만 쓰므로 행 하나(id="default")만 둔다.
 * access_token은 2시간마다 만료되므로 refresh_token으로 계속 갱신해서 이 표에 다시 저장한다.
 */
export const cafe24Tokens = sqliteTable("cafe24_tokens", {
  id: text("id").primaryKey().default("default"),
  mallId: text("mall_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  /** ISO 문자열. 이 시각이 지나면 access_token을 다시 발급받아야 한다 */
  expiresAt: text("expires_at").notNull(),
  scopes: text("scopes").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const marketPriceObservations = sqliteTable("market_price_observations", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  priceDate: text("price_date").notNull(),
  previousDate: text("previous_date").notNull(),
  categoryCode: text("category_code").notNull(),
  marketCode: text("market_code").notNull(),
  itemCode: text("item_code").notNull(),
  itemName: text("item_name").notNull(),
  grade: text("grade").notNull(),
  tradeQuantity: integer("trade_quantity").notNull(),
  unitQuantity: integer("unit_quantity").notNull(),
  averagePrice: integer("average_price").notNull(),
  previousDayChangeRate: real("previous_day_change_rate"),
  fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("market_price_history_idx").on(table.itemCode, table.marketCode, table.priceDate),
]);

export const marketPriceIngestionRuns = sqliteTable("market_price_ingestion_runs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  queryJson: text("query_json").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  fetchedCount: integer("fetched_count").notNull().default(0),
  persistedCount: integer("persisted_count").notNull().default(0),
  error: text("error"),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  orderId: text("order_id").notNull(),
  productOrderId: text("product_order_id").notNull(),
  channelProductId: text("channel_product_id").notNull().default(""),
  sellerProductCode: text("seller_product_code").notNull().default(""),
  productName: text("product_name").notNull(),
  optionName: text("option_name").notNull().default(""),
  quantity: integer("quantity").notNull(),
  paymentAmount: integer("payment_amount").notNull().default(0),
  orderedAt: text("ordered_at").notNull().default(""),
  paidAt: text("paid_at").notNull().default(""),
  lastChangedAt: text("last_changed_at").notNull(),
  orderStatus: text("order_status").notNull(),
  claimType: text("claim_type").notNull().default(""),
  claimStatus: text("claim_status").notNull().default(""),
  buyerName: text("buyer_name").notNull().default(""),
  buyerPhone: text("buyer_phone").notNull().default(""),
  buyerId: text("buyer_id").notNull().default(""),
  recipientName: text("recipient_name").notNull().default(""),
  recipientPhone1: text("recipient_phone_1").notNull().default(""),
  recipientPhone2: text("recipient_phone_2").notNull().default(""),
  zipCode: text("zip_code").notNull().default(""),
  baseAddress: text("base_address").notNull().default(""),
  detailedAddress: text("detailed_address").notNull().default(""),
  deliveryMessage: text("delivery_message").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("orders_channel_product_order_idx").on(table.channel, table.productOrderId),
  index("orders_last_changed_idx").on(table.channel, table.lastChangedAt),
]);

export const orderEvents = sqliteTable("order_events", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  productOrderId: text("product_order_id").notNull(),
  eventType: text("event_type").notNull(),
  orderStatus: text("order_status").notNull(),
  claimType: text("claim_type").notNull().default(""),
  claimStatus: text("claim_status").notNull().default(""),
  changedAt: text("changed_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("order_events_product_order_idx").on(table.channel, table.productOrderId, table.changedAt)]);

export const orderSourcePayloads = sqliteTable("order_source_payloads", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  productOrderId: text("product_order_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  retainedUntil: text("retained_until").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("order_source_channel_product_idx").on(table.channel, table.productOrderId)]);

export const orderSyncState = sqliteTable("order_sync_state", {
  channel: text("channel").primaryKey(),
  cursor: text("cursor").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const orderSyncRuns = sqliteTable("order_sync_runs", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  status: text("status").notNull(),
  rangeFrom: text("range_from").notNull(),
  rangeTo: text("range_to").notNull(),
  fetchedCount: integer("fetched_count").notNull().default(0),
  error: text("error"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [index("order_sync_runs_channel_started_idx").on(table.channel, table.startedAt)]);

export const shipmentDispatches = sqliteTable("shipment_dispatches", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  productOrderId: text("product_order_id").notNull(),
  carrierCode: text("carrier_code").notNull(),
  trackingNumber: text("tracking_number").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  requestedAt: text("requested_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("shipment_dispatch_channel_order_idx").on(table.channel, table.productOrderId),
  index("shipment_dispatch_requested_idx").on(table.channel, table.requestedAt),
]);

export const inventorySnapshots = sqliteTable("inventory_snapshots", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  channelProductNo: text("channel_product_no").notNull(),
  originProductNo: text("origin_product_no").notNull(),
  productName: text("product_name").notNull().default(""),
  sellerManagementCode: text("seller_management_code").notNull().default(""),
  statusType: text("status_type").notNull().default(""),
  stockQuantity: integer("stock_quantity").notNull(),
  fetchedAt: text("fetched_at").notNull(),
}, (table) => [uniqueIndex("inventory_snapshot_channel_product_idx").on(table.channel, table.channelProductNo)]);

export const inventoryChanges = sqliteTable("inventory_changes", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  channelProductNo: text("channel_product_no").notNull(),
  originProductNo: text("origin_product_no").notNull(),
  previousQuantity: integer("previous_quantity").notNull(),
  newQuantity: integer("new_quantity").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  requestedAt: text("requested_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [index("inventory_changes_product_requested_idx").on(table.channel, table.channelProductNo, table.requestedAt)]);

export const centralInventoryItems = sqliteTable("central_inventory_items", {
  id: text("id").primaryKey(),
  sellerProductCode: text("seller_product_code").notNull(),
  productName: text("product_name").notNull().default(""),
  masterChannelProductNo: text("master_channel_product_no").notNull(),
  masterOriginProductNo: text("master_origin_product_no").notNull(),
  availableQuantity: integer("available_quantity").notNull(),
  mappingSource: text("mapping_source").notNull().default("auto"),
  initializedAt: text("initialized_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("central_inventory_seller_code_idx").on(table.sellerProductCode)]);

export const centralInventoryMappings = sqliteTable("central_inventory_mappings", {
  id: text("id").primaryKey(),
  centralInventoryId: text("central_inventory_id").notNull(),
  channel: text("channel").notNull(),
  channelProductNo: text("channel_product_no").notNull(),
  originProductNo: text("origin_product_no").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("central_inventory_mapping_channel_product_idx").on(table.channel, table.channelProductNo),
  index("central_inventory_mapping_central_idx").on(table.centralInventoryId),
]);

export const centralInventoryReservations = sqliteTable("central_inventory_reservations", {
  id: text("id").primaryKey(),
  centralInventoryId: text("central_inventory_id").notNull(),
  channel: text("channel").notNull(),
  productOrderId: text("product_order_id").notNull(),
  quantity: integer("quantity").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("central_inventory_reservation_central_idx").on(table.centralInventoryId)]);
