import assert from "node:assert/strict";
import test from "node:test";

import * as naver from "../app/lib/naver.ts";
import * as matcher from "../app/lib/invoice/matcher.ts";

test("allows fulfillment mutations only from the local app", () => {
  assert.equal(typeof naver.isTrustedLocalOperationUrl, "function");
  if (typeof naver.isTrustedLocalOperationUrl !== "function") return;
  assert.equal(naver.isTrustedLocalOperationUrl("http://localhost:3000/api/naver/inventory"), true);
  assert.equal(naver.isTrustedLocalOperationUrl("http://127.0.0.1:3000/api/naver/inventory"), true);
  assert.equal(naver.isTrustedLocalOperationUrl("https://temporary.trycloudflare.com/api/naver/inventory"), false);
});

test("requires a same-origin browser request for a local product mutation", () => {
  assert.equal(typeof naver.isTrustedLocalMutationRequest, "function");
  if (typeof naver.isTrustedLocalMutationRequest !== "function") return;
  assert.equal(naver.isTrustedLocalMutationRequest(new Request("http://localhost:3000/api/naver/products/status", { method: "POST", headers: {
    Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json",
  } })), true);
  assert.equal(naver.isTrustedLocalMutationRequest(new Request("http://localhost:3000/api/naver/products/status", { method: "POST", headers: {
    Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json",
  } })), false);
  assert.equal(naver.isTrustedLocalMutationRequest(new Request("http://localhost:3000/api/naver/products/status", { method: "POST", headers: {
    "Content-Type": "application/json",
  } })), false);
  assert.equal(naver.isTrustedLocalMutationRequest(new Request("https://temporary.trycloudflare.com/api/naver/products/status", { method: "POST", headers: {
    Origin: "https://temporary.trycloudflare.com", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json",
  } })), false);
});

test("builds Naver's dispatch request and returns per-order results", async () => {
  assert.equal(typeof naver.dispatchProductOrders, "function");
  if (typeof naver.dispatchProductOrders !== "function") return;

  let request: { url: string; init?: RequestInit } | undefined;
  const result = await naver.dispatchProductOrders("token", [{
    productOrderId: "2026081312345678",
    deliveryMethod: "DELIVERY",
    deliveryCompanyCode: "KGB",
    trackingNumber: "1234567890",
  }], async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ data: { successProductOrderIds: ["2026081312345678"], failProductOrderInfos: [] } }), { status: 200 });
  });

  assert.equal(request?.url, "https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/dispatch");
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { dispatchProductOrders: [{
    productOrderId: "2026081312345678",
    deliveryMethod: "DELIVERY",
    deliveryCompanyCode: "KGB",
    trackingNumber: "1234567890",
  }] });
  assert.deepEqual(result, { successProductOrderIds: ["2026081312345678"], failProductOrderInfos: [] });
});

test("rejects an unsafe dispatch batch before calling Naver", async () => {
  assert.equal(typeof naver.dispatchProductOrders, "function");
  if (typeof naver.dispatchProductOrders !== "function") return;
  const rows = Array.from({ length: 31 }, (_, index) => ({
    productOrderId: String(index + 1), deliveryMethod: "DELIVERY" as const, deliveryCompanyCode: "KGB", trackingNumber: String(1000 + index),
  }));
  await assert.rejects(() => naver.dispatchProductOrders("token", rows, async () => { throw new Error("호출되면 안 됨"); }), /최대 30건/);
});

test("reads inventory by channel product number", async () => {
  assert.equal(typeof naver.readNaverInventory, "function");
  if (typeof naver.readNaverInventory !== "function") return;
  let body: unknown;
  const result = await naver.readNaverInventory("token", "987654321", async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ contents: [{
      originProductNo: 123456,
      channelProducts: [{ channelProductNo: 987654321, name: "복숭아", sellerManagementCode: "PEACH-01", statusType: "SALE", stockQuantity: 17 }],
    }] }), { status: 200 });
  });
  assert.deepEqual(body, { searchKeywordType: "CHANNEL_PRODUCT_NO", channelProductNos: [987654321], page: 1, size: 1 });
  assert.deepEqual(result, { channelProductNo: "987654321", originProductNo: "123456", name: "복숭아", sellerManagementCode: "PEACH-01", statusType: "SALE", stockQuantity: 17 });
});

test("rejects a mismatched Naver search result instead of changing the first product", async () => {
  await assert.rejects(() => naver.readNaverInventory("token", "987654321", async () => new Response(JSON.stringify({
    contents: [{
      originProductNo: 111111,
      channelProducts: [{ channelProductNo: 123456789, name: "다른 상품", statusType: "OUTOFSTOCK", stockQuantity: 0 }],
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } })), /찾지 못했습니다/);
});

test("does not turn a missing Naver search stock field into zero", async () => {
  const result = await naver.readNaverInventory("token", "987654321", async () => new Response(JSON.stringify({
    contents: [{
      originProductNo: 123456,
      channelProducts: [{ channelProductNo: 987654321, name: "복숭아", statusType: "SALE" }],
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  assert.equal(result.stockQuantity, null);
});

test("reads current stock from Naver origin-product details", () => {
  assert.equal(naver.extractNaverStockQuantity({ originProduct: { stockQuantity: 92 } }), 92);
  assert.equal(naver.extractNaverStockQuantity({
    originProduct: { optionInfo: { optionCombinations: [{ stockQuantity: 3 }, { stockQuantity: 4 }] } },
  }), 7);
  assert.equal(naver.extractNaverStockQuantity({ originProduct: {} }), null);
});

test("changes Naver stock through the multi-product stock endpoint", async () => {
  assert.equal(typeof naver.changeNaverStock, "function");
  if (typeof naver.changeNaverStock !== "function") return;
  let request: { url: string; body: unknown } | undefined;
  await naver.changeNaverStock("token", "123456", 0, async (url, init) => {
    request = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ code: "SUCCESS", message: "성공", data: {} }), { status: 200 });
  });
  assert.equal(request?.url, "https://api.commerce.naver.com/external/v1/products/origin-products/multi-update");
  assert.deepEqual(request?.body, {
    multiProductUpdateRequestVos: [{ originProductNo: 123456, multiUpdateTypes: ["STOCK"], stockQuantity: 0 }],
  });
});

test("collects every SmartStore product across Naver catalog pages", async () => {
  assert.equal(typeof naver.searchAllNaverProducts, "function");
  if (typeof naver.searchAllNaverProducts !== "function") return;
  const bodies: unknown[] = [];
  const result = await naver.searchAllNaverProducts("token", async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const page = Number(body.page);
    return new Response(JSON.stringify({
      contents: page === 1 ? [{
        originProductNo: 10,
        channelProducts: [
          { channelServiceType: "STOREFARM", channelProductNo: 100, name: "복숭아", sellerManagementCode: "PEACH", statusType: "SALE", stockQuantity: 12, representativeImage: { url: "https://img.example/peach.jpg" } },
          { channelServiceType: "WINDOW", channelProductNo: 101, name: "윈도 복숭아", statusType: "SALE", stockQuantity: 12 },
        ],
      }] : [{
        originProductNo: 20,
        channelProducts: [{ channelServiceType: "STOREFARM", channelProductNo: 200, name: "사과", statusType: "SUSPENSION", stockQuantity: 4 }],
      }],
      page,
      size: 500,
      totalPages: 2,
      last: page === 2,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  assert.deepEqual(bodies, [{ page: 1, size: 500, orderType: "NO" }, { page: 2, size: 500, orderType: "NO" }]);
  assert.deepEqual(result, [
    { channelProductNo: "100", originProductNo: "10", name: "복숭아", sellerManagementCode: "PEACH", statusType: "SALE", stockQuantity: 12, imageUrl: "https://img.example/peach.jpg" },
    { channelProductNo: "200", originProductNo: "20", name: "사과", sellerManagementCode: "", statusType: "SUSPENSION", stockQuantity: 4, imageUrl: "" },
  ]);
});

test("changes only a validated Naver origin product to suspension", async () => {
  assert.equal(typeof naver.suspendNaverProduct, "function");
  if (typeof naver.suspendNaverProduct !== "function") return;
  let request: { url: string; body: unknown } | undefined;
  await naver.suspendNaverProduct("token", "123456", async (url, init) => {
    request = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ code: "SUCCESS", message: "성공" }), { status: 200 });
  });
  assert.equal(request?.url, "https://api.commerce.naver.com/external/v1/products/origin-products/123456/change-status");
  assert.deepEqual(request?.body, { statusType: "SUSPENSION" });
  await assert.rejects(() => naver.suspendNaverProduct("token", "wrong-id", async () => { throw new Error("호출되면 안 됨"); }), /원상품번호/);
});

test("resumes a suspended Naver product without sending a stock quantity", async () => {
  assert.equal(typeof naver.resumeNaverProduct, "function");
  if (typeof naver.resumeNaverProduct !== "function") return;
  let request: { url: string; body: unknown } | undefined;
  await naver.resumeNaverProduct("token", "123456", async (url, init) => {
    request = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ code: "SUCCESS", message: "성공" }), { status: 200 });
  });
  assert.equal(request?.url, "https://api.commerce.naver.com/external/v1/products/origin-products/123456/change-status");
  assert.deepEqual(request?.body, { statusType: "SALE" });
});

test("dispatches only supported Naver product status changes", async () => {
  assert.equal(typeof naver.changeNaverProductStatus, "function");
  if (typeof naver.changeNaverProductStatus !== "function") return;
  const bodies: unknown[] = [];
  const fetcher = async (_url: URL | RequestInfo, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ code: "SUCCESS" }), { status: 200 });
  };

  await naver.changeNaverProductStatus("token", "123456", "SUSPENSION", fetcher);
  await naver.changeNaverProductStatus("token", "123456", "SALE", fetcher);
  assert.deepEqual(bodies, [{ statusType: "SUSPENSION" }, { statusType: "SALE" }]);
  await assert.rejects(
    () => naver.changeNaverProductStatus("token", "123456", "OUTOFSTOCK" as "SALE", fetcher),
    /지원하지 않는 판매 상태/,
  );
});

test("permanently deletes only a validated Naver origin product through the v2 endpoint", async () => {
  assert.equal(typeof naver.deleteNaverProduct, "function");
  if (typeof naver.deleteNaverProduct !== "function") return;
  let request: { url: string; method?: string; body?: BodyInit | null } | undefined;

  await naver.deleteNaverProduct("token", "123456", async (url, init) => {
    request = { url: String(url), method: init?.method, body: init?.body };
    return new Response(JSON.stringify({ code: "SUCCESS", data: {} }), { status: 200 });
  });

  assert.deepEqual(request, {
    url: "https://api.commerce.naver.com/external/v2/products/origin-products/123456",
    method: "DELETE",
    body: undefined,
  });
  await assert.rejects(
    () => naver.deleteNaverProduct("token", "wrong-id", async () => { throw new Error("호출되면 안 됨"); }),
    /원상품번호/,
  );
});

test("converts a stored order into the existing invoice matcher shape", () => {
  assert.equal(typeof matcher.storedOrderToInvoiceOrder, "function");
  if (typeof matcher.storedOrderToInvoiceOrder !== "function") return;
  assert.deepEqual(matcher.storedOrderToInvoiceOrder({
    productOrderId: "po-1", productName: "복숭아", quantity: 2, buyerName: "구매자", recipientName: "수취인",
    baseAddress: "서울시", detailedAddress: "101호", recipientPhone1: "010-0000-2668", recipientPhone2: "",
    deliveryMessage: "문 앞", buyerPhone: "010-0000-4657", buyerId: "buyer", orderStatus: "PAYED",
  }), {
    productOrderId: "po-1", productName: "복숭아", quantity: 2, buyerName: "구매자", recipientName: "수취인",
    address: "서울시 101호", phone1: "010-0000-2668", phone2: "", deliveryMessage: "문 앞",
    buyerPhone: "010-0000-4657", sellerId: "", buyerId: "buyer", status: "결제 완료",
  });
});
