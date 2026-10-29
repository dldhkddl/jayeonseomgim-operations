import assert from "node:assert/strict";
import test from "node:test";

import * as repository from "../app/lib/orders/order-storage.ts";
import { selectLatestRunsByChannel } from "../app/lib/orders/order-sync-history.ts";

test("uses channel plus product-order id as the cross-channel storage identity", () => {
  assert.equal(typeof repository.buildOrderStorageRow, "function");
  if (typeof repository.buildOrderStorageRow !== "function") return;
  const order = {
    channel: "coupang" as const,
    orderId: "O1", productOrderId: "P1", channelProductId: "I1", sellerProductCode: "SKU",
    productName: "복숭아", optionName: "4kg", quantity: 1, paymentAmount: 20000,
    orderedAt: "2026-08-14T09:00:00+09:00", paidAt: "2026-08-14T09:01:00+09:00", lastChangedAt: "2026-08-14T09:01:00+09:00",
    orderStatus: "ACCEPT", claimType: "", claimStatus: "", buyerName: "구매자", buyerPhone: "0501", buyerId: "",
    recipientName: "수취인", recipientPhone1: "0502", recipientPhone2: "", zipCode: "12345", baseAddress: "서울", detailedAddress: "101호", deliveryMessage: "",
  };

  const row = repository.buildOrderStorageRow(order, "2026-08-14T00:00:00.000Z");

  assert.equal(row.id, "coupang:P1");
  assert.equal(row.channel, "coupang");
  assert.equal(row.updatedAt, "2026-08-14T00:00:00.000Z");
});

test("keeps the newest sync run when grouping descending history by channel", () => {
  const newest = { id: "new", channel: "coupang", status: "completed" };
  const grouped = selectLatestRunsByChannel([
    newest,
    { id: "old", channel: "coupang", status: "failed" },
    { id: "naver", channel: "naver", status: "completed" },
  ]);
  assert.equal(grouped.coupang, newest);
  assert.equal(grouped.naver.id, "naver");
});
