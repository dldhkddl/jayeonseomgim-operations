import assert from "node:assert/strict";
import test from "node:test";

import * as coupangOrders from "../app/lib/orders/coupang-order-api.ts";
import * as coupangSync from "../app/lib/orders/coupang-order-sync.ts";

const shipment = {
  shipmentBoxId: 7001,
  orderId: 9001,
  orderedAt: "2026-08-14T09:00:00+09:00",
  paidAt: "2026-08-14T09:01:00+09:00",
  status: "ACCEPT",
  orderer: { name: "홍길동", safeNumber: "05011112222", ordererNumber: null },
  receiver: { name: "김수취", safeNumber: "01000006467", receiverNumber: null, addr1: "서울시 중구", addr2: "101호", postCode: "12345" },
  parcelPrintMessage: "문 앞",
  orderItems: [{
    sequenceNo: "001", productId: 777, vendorItemId: 888, vendorItemName: "복숭아 4kg, 대과",
    sellerProductId: 666, sellerProductName: "복숭아 4kg", sellerProductItemName: "대과",
    externalVendorSkuCode: "PEACH-4", shippingCount: 2, cancelCount: 0, holdCountForCancel: 0,
    orderPrice: { currencyCode: "KRW", units: 45000, nanos: 0 }, canceled: false,
  }],
};

test("queries every Coupang order status with the signed 24-hour time-frame contract", async () => {
  assert.equal(typeof coupangOrders.collectCoupangOrderSheets, "function");
  if (typeof coupangOrders.collectCoupangOrderSheets !== "function") return;
  const requests: Array<{ url: URL; authorization: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, authorization: String(new Headers(init?.headers).get("Authorization") ?? "") });
    return Response.json({ code: 200, message: "OK", data: url.searchParams.get("status") === "ACCEPT" ? [shipment] : [] });
  };

  const result = await coupangOrders.collectCoupangOrderSheets(
    { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    "2026-08-14T00:00+09:00",
    "2026-08-14T23:59+09:00",
    fetcher,
  );

  assert.deepEqual(requests.map(({ url }) => url.searchParams.get("status")), ["ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY", "NONE_TRACKING"]);
  assert.equal(requests.every(({ url }) => url.pathname === "/v2/providers/openapi/apis/api/v5/vendors/A01755825/ordersheets"), true);
  assert.equal(requests.every(({ url }) => url.searchParams.get("searchType") === "timeFrame"), true);
  assert.equal(requests.every(({ authorization }) => authorization.startsWith("CEA algorithm=HmacSHA256")), true);
  assert.deepEqual(result, [shipment]);
});

test("normalizes every Coupang order item into the shared stored-order shape", () => {
  assert.equal(typeof coupangOrders.normalizeCoupangOrderSheet, "function");
  if (typeof coupangOrders.normalizeCoupangOrderSheet !== "function") return;

  assert.deepEqual(coupangOrders.normalizeCoupangOrderSheet(shipment), [{
    channel: "coupang",
    orderId: "9001",
    productOrderId: "7001-001",
    channelProductId: "888",
    sellerProductCode: "PEACH-4",
    productName: "복숭아 4kg",
    optionName: "대과",
    quantity: 2,
    paymentAmount: 45000,
    orderedAt: "2026-08-14T09:00:00+09:00",
    paidAt: "2026-08-14T09:01:00+09:00",
    lastChangedAt: "2026-08-14T09:01:00+09:00",
    orderStatus: "ACCEPT",
    claimType: "",
    claimStatus: "",
    buyerName: "홍길동",
    buyerPhone: "05011112222",
    buyerId: "",
    recipientName: "김수취",
    recipientPhone1: "01000006467",
    recipientPhone2: "",
    zipCode: "12345",
    baseAddress: "서울시 중구",
    detailedAddress: "101호",
    deliveryMessage: "문 앞",
  }]);
});

test("retries a rate-limited Coupang order request", async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    if (attempts === 1) return Response.json({ message: "rate limited" }, { status: 429, headers: { "Retry-After": "0" } });
    return Response.json({ code: 200, message: "OK", data: [] });
  };

  await coupangOrders.collectCoupangOrderSheets(
    { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    "2026-08-14T00:00+09:00",
    "2026-08-14T01:00+09:00",
    fetcher,
  );

  assert.equal(attempts, 7);
});

test("syncs Coupang orders in daily windows and deduplicates stored product orders", async () => {
  assert.equal(typeof coupangSync.syncCoupangOrders, "function");
  if (typeof coupangSync.syncCoupangOrders !== "function") return;
  let persisted: coupangSync.SuccessfulCoupangOrderSync | undefined;
  let requestCount = 0;
  const repository: coupangSync.CoupangOrderSyncRepository = {
    readCursor: async () => null,
    persistSuccessfulSync: async (sync) => { persisted = sync; },
    recordFailedSync: async () => {},
  };
  const fetcher: typeof fetch = async (input) => {
    requestCount += 1;
    const status = new URL(String(input)).searchParams.get("status");
    return Response.json({ code: 200, message: "OK", data: status === "ACCEPT" ? [shipment] : [] });
  };

  const result = await coupangSync.syncCoupangOrders({
    credentials: { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    repository,
    fetcher,
    now: new Date("2026-08-14T12:00:00.000Z"),
    historyDays: 2,
  });

  assert.equal(requestCount, 18);
  assert.equal(result.fetched, 1);
  assert.equal(persisted?.orders.length, 1);
  assert.equal(persisted?.sourcePayloads.length, 1);
  assert.equal(persisted?.from, "2026-08-12T21:00+09:00");
  assert.equal(persisted?.to, "2026-08-14T21:00+09:00");
});

test("does not persist a partial Coupang sync when one status request fails", async () => {
  assert.equal(typeof coupangSync.syncCoupangOrders, "function");
  if (typeof coupangSync.syncCoupangOrders !== "function") return;
  let persisted = false;
  let failed = false;
  const repository: coupangSync.CoupangOrderSyncRepository = {
    readCursor: async () => null,
    persistSuccessfulSync: async () => { persisted = true; },
    recordFailedSync: async () => { failed = true; },
  };
  const fetcher: typeof fetch = async (input) => {
    const status = new URL(String(input)).searchParams.get("status");
    if (status === "DEPARTURE") return Response.json({ message: "forbidden" }, { status: 403 });
    return Response.json({ code: 200, message: "OK", data: [] });
  };

  await assert.rejects(() => coupangSync.syncCoupangOrders({
    credentials: { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    repository,
    fetcher,
    now: new Date("2026-08-14T12:00:00.000Z"),
  }), /forbidden/);
  assert.equal(persisted, false);
  assert.equal(failed, true);
});
