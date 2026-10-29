import { eq } from "drizzle-orm";

import { ensureFulfillmentSchema, getDb } from "../../../db";
import {
  centralInventoryItems,
  centralInventoryMappings,
  centralInventoryReservations,
  inventorySnapshots,
  orders,
} from "../../../db/schema";
import type { CentralInventoryMapping, InventoryReservation } from "./central-inventory";

export async function initializeCentralInventory(groups: CentralInventoryMapping[]) {
  await ensureFulfillmentSchema();
  const db = getDb();
  const existing = await db.select({ id: centralInventoryItems.id }).from(centralInventoryItems).limit(1);
  if (existing.length) return { initialized: false, count: (await db.select().from(centralInventoryItems)).length };

  const now = new Date().toISOString();
  for (const group of groups) {
    await db.insert(centralInventoryItems).values({
      id: group.id,
      sellerProductCode: group.sellerProductCode,
      productName: group.productName,
      masterChannelProductNo: group.master.channelProductNo,
      masterOriginProductNo: group.master.originProductNo,
      availableQuantity: group.availableQuantity,
      mappingSource: "auto",
      initializedAt: now,
      updatedAt: now,
    });
    for (const item of [group.master, ...group.targets]) {
      await db.insert(centralInventoryMappings).values({
        id: `${item.channel}:${item.channelProductNo}`,
        centralInventoryId: group.id,
        channel: item.channel,
        channelProductNo: item.channelProductNo,
        originProductNo: item.originProductNo,
        createdAt: now,
      }).onConflictDoNothing();
    }
  }
  return { initialized: true, count: groups.length };
}

export async function createCentralInventoryMapping(group: CentralInventoryMapping) {
  await ensureFulfillmentSchema();
  const db = getDb();
  const mappingIds = new Set((await db.select({ id: centralInventoryMappings.id }).from(centralInventoryMappings)).map((item) => item.id));
  for (const item of [group.master, ...group.targets]) {
    if (mappingIds.has(`${item.channel}:${item.channelProductNo}`)) {
      throw new Error(`${item.channel === "naver" ? "네이버" : "쿠팡"} 상품이 이미 다른 중앙재고에 연결되어 있습니다.`);
    }
  }
  const sameCode = await db.select({ id: centralInventoryItems.id }).from(centralInventoryItems).where(eq(centralInventoryItems.id, group.id)).limit(1);
  if (sameCode.length) throw new Error("같은 네이버 기준 상품코드가 이미 사용 중입니다. 중복 상품코드를 먼저 정리해 주세요.");

  const now = new Date().toISOString();
  await db.insert(centralInventoryItems).values({
    id: group.id,
    sellerProductCode: group.sellerProductCode,
    productName: group.productName,
    masterChannelProductNo: group.master.channelProductNo,
    masterOriginProductNo: group.master.originProductNo,
    availableQuantity: group.availableQuantity,
    mappingSource: "manual",
    initializedAt: now,
    updatedAt: now,
  });
  for (const item of [group.master, ...group.targets]) {
    await db.insert(centralInventoryMappings).values({
      id: `${item.channel}:${item.channelProductNo}`,
      centralInventoryId: group.id,
      channel: item.channel,
      channelProductNo: item.channelProductNo,
      originProductNo: item.originProductNo,
      createdAt: now,
    });
  }
  return { id: group.id, sellerProductCode: group.sellerProductCode };
}

export async function deleteCentralInventoryMapping(centralInventoryId: string) {
  await ensureFulfillmentSchema();
  const id = String(centralInventoryId ?? "").trim();
  if (!id) throw new Error("해제할 중앙재고 연결을 선택해 주세요.");
  const db = getDb();
  const existing = await db.select({ id: centralInventoryItems.id, mappingSource: centralInventoryItems.mappingSource }).from(centralInventoryItems)
    .where(eq(centralInventoryItems.id, id)).limit(1);
  if (!existing.length) throw new Error("이미 해제됐거나 존재하지 않는 연결입니다.");
  if (existing[0].mappingSource !== "manual") throw new Error("자동으로 연결된 중앙재고는 여기서 해제할 수 없습니다.");
  const reservations = await db.select({ status: centralInventoryReservations.status }).from(centralInventoryReservations)
    .where(eq(centralInventoryReservations.centralInventoryId, id));
  if (reservations.some((item) => item.status === "reserved")) {
    throw new Error("처리 중인 주문 재고가 예약된 상품은 연결을 해제할 수 없습니다. 주문 처리가 끝난 뒤 다시 시도해 주세요.");
  }

  await db.batch([
    db.delete(centralInventoryReservations).where(eq(centralInventoryReservations.centralInventoryId, id)),
    db.delete(centralInventoryMappings).where(eq(centralInventoryMappings.centralInventoryId, id)),
    db.delete(centralInventoryItems).where(eq(centralInventoryItems.id, id)),
  ]);
  return { id };
}

export async function loadCentralInventoryData() {
  await ensureFulfillmentSchema();
  const db = getDb();
  const [items, mappings, reservations, orderRows] = await Promise.all([
    db.select().from(centralInventoryItems),
    db.select().from(centralInventoryMappings),
    db.select().from(centralInventoryReservations),
    db.select({
      id: orders.id,
      channel: orders.channel,
      productOrderId: orders.productOrderId,
      channelProductId: orders.channelProductId,
      sellerProductCode: orders.sellerProductCode,
      quantity: orders.quantity,
      orderedAt: orders.orderedAt,
      orderStatus: orders.orderStatus,
      claimStatus: orders.claimStatus,
    }).from(orders),
  ]);
  return { items, mappings, reservations, orders: orderRows };
}

export async function loadCentralInventorySnapshots() {
  await ensureFulfillmentSchema();
  const rows = await getDb().select().from(inventorySnapshots);
  return rows.map((item) => ({
    channel: item.channel,
    channelProductNo: item.channelProductNo,
    originProductNo: item.originProductNo,
    sellerProductCode: item.sellerManagementCode,
    productName: item.productName,
    stockQuantity: item.stockQuantity,
  }));
}

export async function applyCentralInventoryState(input: {
  quantities: Array<{ id: string; availableQuantity: number }>;
  reservations: Array<InventoryReservation & { centralInventoryId: string; channel: string; productOrderId: string }>;
}) {
  await ensureFulfillmentSchema();
  const db = getDb();
  const now = new Date().toISOString();
  for (const item of input.quantities) {
    await db.update(centralInventoryItems).set({
      availableQuantity: item.availableQuantity,
      updatedAt: now,
    }).where(eq(centralInventoryItems.id, item.id));
  }
  for (const reservation of input.reservations) {
    await db.insert(centralInventoryReservations).values({
      id: reservation.id,
      centralInventoryId: reservation.centralInventoryId,
      channel: reservation.channel,
      productOrderId: reservation.productOrderId,
      quantity: reservation.quantity,
      status: reservation.status,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: centralInventoryReservations.id,
      set: { quantity: reservation.quantity, status: reservation.status, updatedAt: now },
    });
  }
}
