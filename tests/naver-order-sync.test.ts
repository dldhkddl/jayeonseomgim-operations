import assert from "node:assert/strict";
import test from "node:test";

import {
  collectChangedProductOrders,
  fetchProductOrderDetails,
  normalizeNaverProductOrder,
  type NaverChangedOrder,
} from "../app/lib/orders/naver-order-api.ts";
import { syncNaverOrders, type OrderSyncRepository } from "../app/lib/orders/naver-order-sync.ts";
import { maskOrderForList } from "../app/lib/orders/order-privacy.ts";

test("collects every changed-order page using Naver's continuation values", async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (urls.length === 1) {
      return Response.json({
        data: {
          count: 1,
          lastChangeStatuses: [{ productOrderId: "P1", orderId: "O1", lastChangedDate: "2026-08-13T10:00:00+09:00", lastChangedType: "PAYED", productOrderStatus: "PAYED" }],
          more: { moreFrom: "2026-08-13T10:00:01+09:00", moreSequence: "P2" },
        },
      });
    }
    return Response.json({
      data: {
        count: 1,
        lastChangeStatuses: [{ productOrderId: "P2", orderId: "O2", lastChangedDate: "2026-08-13T10:00:01+09:00", lastChangedType: "PAYED", productOrderStatus: "PAYED" }],
      },
    });
  };

  const result = await collectChangedProductOrders("token", "2026-08-13T09:00:00+09:00", "2026-08-13T11:00:00+09:00", fetcher);

  assert.deepEqual(result.map((item) => item.productOrderId), ["P1", "P2"]);
  assert.match(urls[1], /lastChangedFrom=2026-08-13T10%3A00%3A01%2B09%3A00/);
  assert.match(urls[1], /moreSequence=P2/);
});

test("retries a temporarily rate-limited changed-order request", async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    if (attempts === 1) return Response.json({ message: "too many requests" }, { status: 429 });
    return Response.json({ data: { count: 0, lastChangeStatuses: [] } });
  };

  const result = await collectChangedProductOrders("token", "2026-08-13T09:00:00+09:00", "2026-08-13T11:00:00+09:00", fetcher);

  assert.deepEqual(result, []);
  assert.equal(attempts, 2);
});

test("fetches product-order details in batches of at most 300", async () => {
  const batchSizes: number[] = [];
  const ids = Array.from({ length: 301 }, (_, index) => `P${index + 1}`);
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { productOrderIds: string[]; quantityClaimCompatibility: boolean };
    batchSizes.push(body.productOrderIds.length);
    return Response.json({ data: body.productOrderIds.map((productOrderId) => ({ productOrder: { productOrderId }, order: {} })) });
  };

  const result = await fetchProductOrderDetails("token", ids, fetcher);

  assert.deepEqual(batchSizes, [300, 1]);
  assert.equal(result.length, 301);
});

test("normalizes fields needed by invoices, stock reservations, and claims", () => {
  const changed: NaverChangedOrder = {
    productOrderId: "P1",
    orderId: "O1",
    lastChangedDate: "2026-08-13T10:00:00+09:00",
    lastChangedType: "CLAIM_REQUESTED",
    productOrderStatus: "PAYED",
    claimType: "CANCEL",
    claimStatus: "CANCEL_REQUEST",
  };
  const normalized = normalizeNaverProductOrder(changed, {
    order: { orderId: "O1", orderDate: "2026-08-13T09:00:00+09:00", paymentDate: "2026-08-13T09:01:00+09:00", ordererName: "홍길동", ordererTel: "01000002668", ordererId: "buyer" },
    productOrder: {
      productOrderId: "P1",
      productName: "사과 5kg",
      productOption: "대과",
      quantity: 2,
      totalPaymentAmount: 45000,
      productOrderStatus: "PAYED",
      productId: "777",
      sellerProductCode: "APPLE-5",
      shippingAddress: { name: "김수취", tel1: "01000004657", tel2: "", zipCode: "12345", baseAddress: "서울시 중구", detailedAddress: "101호" },
      shippingMemo: "문 앞",
    },
  });

  assert.deepEqual(normalized, {
    channel: "naver",
    orderId: "O1",
    productOrderId: "P1",
    channelProductId: "777",
    sellerProductCode: "APPLE-5",
    productName: "사과 5kg",
    optionName: "대과",
    quantity: 2,
    paymentAmount: 45000,
    orderedAt: "2026-08-13T09:00:00+09:00",
    paidAt: "2026-08-13T09:01:00+09:00",
    lastChangedAt: "2026-08-13T10:00:00+09:00",
    orderStatus: "PAYED",
    claimType: "CANCEL",
    claimStatus: "CANCEL_REQUEST",
    buyerName: "홍길동",
    buyerPhone: "01000002668",
    buyerId: "buyer",
    recipientName: "김수취",
    recipientPhone1: "01000004657",
    recipientPhone2: "",
    zipCode: "12345",
    baseAddress: "서울시 중구",
    detailedAddress: "101호",
    deliveryMessage: "문 앞",
  });
});

test("persists one complete sync only after all detail requests succeed", async () => {
  let persisted = false;
  const repository: OrderSyncRepository = {
    readCursor: async () => null,
    persistSuccessfulSync: async () => { persisted = true; },
    recordFailedSync: async () => {},
  };
  const fetcher: typeof fetch = async (input) => {
    if (String(input).includes("last-changed-statuses")) {
      return Response.json({ data: { count: 1, lastChangeStatuses: [{ productOrderId: "P1", orderId: "O1", lastChangedDate: "2026-08-13T10:00:00+09:00", lastChangedType: "PAYED", productOrderStatus: "PAYED" }] } });
    }
    return Response.json({ message: "temporary failure" }, { status: 500 });
  };

  await assert.rejects(syncNaverOrders({ accessToken: "token", repository, fetcher, now: new Date("2026-08-13T11:00:00+09:00") }), /temporary failure/);
  assert.equal(persisted, false);
});

test("backfills seven days in daily windows even when a recent cursor exists", async () => {
  const changedUrls: URL[] = [];
  let persistedFrom = "";
  const repository: OrderSyncRepository = {
    readCursor: async () => "2026-08-13T10:00:00.000Z",
    persistSuccessfulSync: async (sync) => { persistedFrom = sync.from; },
    recordFailedSync: async () => {},
  };
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("last-changed-statuses")) changedUrls.push(url);
    return Response.json({ data: { count: 0, lastChangeStatuses: [] } });
  };

  await syncNaverOrders({ accessToken: "token", repository, fetcher, now: new Date("2026-08-13T12:00:00.000Z"), historyDays: 7 });

  assert.equal(persistedFrom, "2026-08-06T12:00:00.000Z");
  assert.equal(changedUrls.length, 7);
  assert.equal(changedUrls[0].searchParams.get("lastChangedFrom"), "2026-08-06T12:00:00.000Z");
  assert.equal(changedUrls.at(-1)?.searchParams.get("lastChangedTo"), "2026-08-13T12:00:00.000Z");
});

test("stores one current order while retaining repeated change events", async () => {
  let orderCount = 0;
  let eventCount = 0;
  const repository: OrderSyncRepository = {
    readCursor: async () => null,
    persistSuccessfulSync: async (sync) => { orderCount = sync.orders.length; eventCount = sync.changed.length; },
    recordFailedSync: async () => {},
  };
  let changedRequest = 0;
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes("last-changed-statuses")) {
      changedRequest += 1;
      return Response.json({ data: { count: 1, lastChangeStatuses: [{
        productOrderId: "P1", orderId: "O1", lastChangedDate: `2026-08-${String(changedRequest + 5).padStart(2, "0")}T10:00:00.000Z`, lastChangedType: changedRequest === 1 ? "PAYED" : "DISPATCHED", productOrderStatus: changedRequest === 1 ? "PAYED" : "DELIVERING",
      }] } });
    }
    const body = JSON.parse(String(init?.body)) as { productOrderIds: string[] };
    return Response.json({ data: body.productOrderIds.map((productOrderId) => ({ order: { orderId: "O1" }, productOrder: { productOrderId, productName: "복숭아", quantity: 1, productOrderStatus: "DELIVERING" } })) });
  };

  await syncNaverOrders({ accessToken: "token", repository, fetcher, now: new Date("2026-08-13T12:00:00.000Z"), historyDays: 7 });

  assert.equal(orderCount, 1);
  assert.equal(eventCount, 7);
});

test("masks phone numbers and detailed addresses in the default order list", () => {
  const masked = maskOrderForList({ recipientPhone1: "010-1234-5678", recipientPhone2: "010-0000-6412", detailedAddress: "101동 1203호" });
  assert.deepEqual(masked, { recipientPhone1: "010-****-5678", recipientPhone2: "02-***-9003", detailedAddress: "101동 ****" });
});
