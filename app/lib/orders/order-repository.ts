import { and, desc, eq, inArray } from "drizzle-orm";
import { ensureFulfillmentSchema, getDb } from "../../../db";
import { inventoryChanges, inventorySnapshots, orderEvents, orders, orderSourcePayloads, orderSyncRuns, orderSyncState, shipmentDispatches } from "../../../db/schema";
import { storedOrderToInvoiceOrder } from "../invoice/matcher";
import type { NaverInventory } from "../naver";
import { buildInventorySnapshotRecord, groupCollectedInventoryProducts, type ChannelInventoryItem } from "../inventory/channel-inventory";
import type { CoupangOrderSyncRepository, SuccessfulCoupangOrderSync } from "./coupang-order-sync";
import type { StoredOrderInput } from "./naver-order-api";
import { maskOrderForList } from "./order-privacy";
import { buildOrderStorageRow } from "./order-storage";
import { selectLatestRunsByChannel } from "./order-sync-history";
import type { OrderSyncRepository } from "./naver-order-sync";

const CHANNEL = "naver";

type StoredSourcePayload = { productOrderId: string; payload: unknown };
type StoredOrderEvent = { productOrderId: string; eventType: string; orderStatus: string; claimType: string; claimStatus: string; changedAt: string };

async function readChannelCursor(channel: string) {
  const row = (await getDb().select().from(orderSyncState).where(eq(orderSyncState.channel, channel)).limit(1))[0];
  return row?.cursor ?? null;
}

async function persistChannelSync(input: {
  channel: "naver" | "coupang";
  from: string;
  to: string;
  orders: StoredOrderInput[];
  sourcePayloads: StoredSourcePayload[];
  events: StoredOrderEvent[];
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const retainedUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const runId = crypto.randomUUID();
  await db.insert(orderSyncRuns).values({ id: runId, channel: input.channel, status: "running", rangeFrom: input.from, rangeTo: input.to, startedAt: now });
  for (const order of input.orders) {
    const row = buildOrderStorageRow(order, now);
    await db.insert(orders).values(row).onConflictDoUpdate({ target: orders.id, set: { ...order, updatedAt: now } });
  }
  for (const event of input.events) {
    const id = [input.channel, event.productOrderId, event.changedAt, event.eventType, event.claimStatus].join(":");
    await db.insert(orderEvents).values({ id, channel: input.channel, ...event }).onConflictDoNothing();
  }
  for (const source of input.sourcePayloads) {
    const id = `${input.channel}:${source.productOrderId}`;
    await db.insert(orderSourcePayloads).values({
      id, channel: input.channel, productOrderId: source.productOrderId, payloadJson: JSON.stringify(source.payload), retainedUntil, updatedAt: now,
    }).onConflictDoUpdate({ target: orderSourcePayloads.id, set: { payloadJson: JSON.stringify(source.payload), retainedUntil, updatedAt: now } });
  }
  await db.insert(orderSyncState).values({ channel: input.channel, cursor: input.to, updatedAt: now })
    .onConflictDoUpdate({ target: orderSyncState.channel, set: { cursor: input.to, updatedAt: now } });
  await db.update(orderSyncRuns).set({ status: "completed", fetchedCount: input.orders.length, completedAt: new Date().toISOString() }).where(eq(orderSyncRuns.id, runId));
}

async function recordChannelFailedSync(channel: string, input: { from: string; to: string; error: string }) {
  const now = new Date().toISOString();
  await getDb().insert(orderSyncRuns).values({
    id: crypto.randomUUID(), channel, status: "failed", rangeFrom: input.from, rangeTo: input.to, error: input.error, startedAt: now, completedAt: now,
  });
}

export function createOrderRepository(): OrderSyncRepository {
  return {
    readCursor: () => readChannelCursor("naver"),

    async persistSuccessfulSync(sync) {
      await persistChannelSync({
        channel: "naver", from: sync.from, to: sync.to, orders: sync.orders, sourcePayloads: sync.sourcePayloads,
        events: sync.changed.map((changed) => ({
          productOrderId: changed.productOrderId, eventType: changed.lastChangedType, orderStatus: changed.productOrderStatus,
          claimType: changed.claimType ?? "", claimStatus: changed.claimStatus ?? "", changedAt: changed.lastChangedDate,
        })),
      });
    },

    recordFailedSync: (input) => recordChannelFailedSync("naver", input),
  };
}

export function createCoupangOrderRepository(): CoupangOrderSyncRepository {
  return {
    readCursor: () => readChannelCursor("coupang"),
    async persistSuccessfulSync(sync: SuccessfulCoupangOrderSync) {
      await persistChannelSync({
        channel: "coupang", from: sync.from, to: sync.to, orders: sync.orders, sourcePayloads: sync.sourcePayloads,
        events: sync.orders.map((order) => ({
          productOrderId: order.productOrderId, eventType: order.orderStatus, orderStatus: order.orderStatus,
          claimType: order.claimType, claimStatus: order.claimStatus, changedAt: order.lastChangedAt,
        })),
      });
    },
    recordFailedSync: (input) => recordChannelFailedSync("coupang", input),
  };
}

export async function listOrders(limit = 100) {
  const rows = await getDb().select().from(orders).orderBy(desc(orders.lastChangedAt)).limit(Math.min(Math.max(limit, 1), 300));
  return rows.map(maskOrderForList);
}

export async function latestOrderSyncRun(channel = "naver") {
  return (await getDb().select().from(orderSyncRuns).where(eq(orderSyncRuns.channel, channel)).orderBy(desc(orderSyncRuns.startedAt)).limit(1))[0] ?? null;
}

export async function latestOrderSyncRuns() {
  const rows = await getDb().select().from(orderSyncRuns).orderBy(desc(orderSyncRuns.startedAt)).limit(50);
  return selectLatestRunsByChannel(rows);
}

export async function listOrdersForFulfillment(limit = 300) {
  const rows = await getDb().select().from(orders).where(eq(orders.channel, CHANNEL)).orderBy(desc(orders.lastChangedAt)).limit(Math.min(Math.max(limit, 1), 300));
  return rows.map(storedOrderToInvoiceOrder);
}

export async function listCollectedInventoryProducts() {
  const rows = await getDb().select({
    channel: orders.channel,
    channelProductId: orders.channelProductId,
    sellerProductCode: orders.sellerProductCode,
    productName: orders.productName,
    optionName: orders.optionName,
    quantity: orders.quantity,
  }).from(orders).orderBy(desc(orders.lastChangedAt));
  return groupCollectedInventoryProducts(rows);
}

export async function findAlreadyDispatched(productOrderIds: string[]) {
  if (!productOrderIds.length) return [];
  await ensureFulfillmentSchema();
  const rows = await getDb().select({ productOrderId: shipmentDispatches.productOrderId }).from(shipmentDispatches)
    .where(and(eq(shipmentDispatches.channel, CHANNEL), inArray(shipmentDispatches.productOrderId, productOrderIds), eq(shipmentDispatches.status, "completed")));
  return rows.map((row) => row.productOrderId);
}

export async function recordDispatchResults(input: Array<{ productOrderId: string; carrierCode: string; trackingNumber: string; status: "completed" | "failed"; error?: string }>) {
  await ensureFulfillmentSchema();
  const now = new Date().toISOString();
  for (const item of input) {
    await getDb().insert(shipmentDispatches).values({
      id: `${CHANNEL}:${item.productOrderId}`,
      channel: CHANNEL,
      productOrderId: item.productOrderId,
      carrierCode: item.carrierCode,
      trackingNumber: item.trackingNumber,
      status: item.status,
      error: item.error ?? null,
      requestedAt: now,
      completedAt: now,
    }).onConflictDoUpdate({
      target: shipmentDispatches.id,
      set: { carrierCode: item.carrierCode, trackingNumber: item.trackingNumber, status: item.status, error: item.error ?? null, requestedAt: now, completedAt: now },
    });
  }
}

export async function saveInventorySnapshot(item: NaverInventory | ChannelInventoryItem) {
  const normalized: ChannelInventoryItem = "channel" in item ? item : {
    channel: CHANNEL,
    channelProductNo: item.channelProductNo,
    originProductNo: item.originProductNo,
    imageUrl: "",
    productName: item.name,
    sellerProductCode: item.sellerManagementCode,
    options: [],
    collectedOrderCount: 0,
    collectedQuantity: 0,
    statusType: item.statusType,
    stockQuantity: item.stockQuantity,
  };
  const row = buildInventorySnapshotRecord(normalized);
  if (!row) return;
  await ensureFulfillmentSchema();
  await getDb().insert(inventorySnapshots).values(row).onConflictDoUpdate({
    target: inventorySnapshots.id,
    set: {
      originProductNo: row.originProductNo,
      productName: row.productName,
      sellerManagementCode: row.sellerManagementCode,
      statusType: row.statusType,
      stockQuantity: row.stockQuantity,
      fetchedAt: row.fetchedAt,
    },
  });
}

export async function recordInventoryChange(input: { item: NaverInventory; newQuantity: number; status: "completed" | "failed"; error?: string }) {
  await ensureFulfillmentSchema();
  const now = new Date().toISOString();
  await getDb().insert(inventoryChanges).values({
    id: crypto.randomUUID(), channel: CHANNEL, channelProductNo: input.item.channelProductNo, originProductNo: input.item.originProductNo,
    previousQuantity: input.item.stockQuantity ?? 0, newQuantity: input.newQuantity, status: input.status, error: input.error ?? null,
    requestedAt: now, completedAt: now,
  });
}
