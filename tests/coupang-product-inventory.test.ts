import assert from "node:assert/strict";
import test from "node:test";

import * as coupang from "../app/lib/coupang.ts";

const productDetail = {
  sellerProductId: 1001,
  sellerProductName: "복숭아 선물세트",
  statusName: "승인완료",
  items: [
    {
      sellerProductItemId: 2001,
      vendorItemId: 3001,
      itemName: "4kg 대과",
      externalVendorSku: "PEACH-4-L",
      images: [{ imageOrder: 0, imageType: "REPRESENTATION", cdnPath: "vendor_inventory/peach.jpg" }],
    },
    {
      sellerProductItemId: 2002,
      vendorItemId: 3002,
      itemName: "4kg 특대과",
      externalVendorSku: "PEACH-4-XL",
      images: [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: "https://example.com/peach-xl.jpg" }],
    },
  ],
};

test("normalizes Coupang options into inventory cards keyed by vendorItemId", () => {
  const normalize = (coupang as Record<string, unknown>).normalizeCoupangInventoryProduct;
  assert.equal(typeof normalize, "function");
  if (typeof normalize !== "function") return;

  const result = normalize(productDetail, new Map([
    ["3001", { amountInStock: 7, salePrice: 35000, onSale: true }],
    ["3002", { amountInStock: 0, salePrice: 39000, onSale: false }],
  ]));

  assert.deepEqual(result, [
    {
      channel: "coupang",
      channelProductNo: "3001",
      originProductNo: "1001",
      imageUrl: "https://image.coupangcdn.com/image/vendor_inventory/peach.jpg",
      productName: "복숭아 선물세트",
      sellerProductCode: "PEACH-4-L",
      options: ["4kg 대과"],
      collectedOrderCount: 0,
      collectedQuantity: 0,
      statusType: "SALE",
      stockQuantity: 7,
    },
    {
      channel: "coupang",
      channelProductNo: "3002",
      originProductNo: "1001",
      imageUrl: "https://example.com/peach-xl.jpg",
      productName: "복숭아 선물세트",
      sellerProductCode: "PEACH-4-XL",
      options: ["4kg 특대과"],
      collectedOrderCount: 0,
      collectedQuantity: 0,
      statusType: "SUSPENSION",
      stockQuantity: 0,
    },
  ]);
});

test("marks an on-sale Coupang option with zero stock as sold out", () => {
  const normalize = (coupang as Record<string, unknown>).normalizeCoupangInventoryProduct;
  assert.equal(typeof normalize, "function");
  if (typeof normalize !== "function") return;

  const result = normalize(
    { ...productDetail, items: [productDetail.items[0]] },
    new Map([["3001", { amountInStock: 0, salePrice: 35000, onSale: true }]]),
  ) as Array<{ statusType: string }>;

  assert.equal(result[0]?.statusType, "OUTOFSTOCK");
});

test("collects every Coupang product page, detail, and option inventory", async () => {
  const collect = (coupang as Record<string, unknown>).collectCoupangInventory;
  assert.equal(typeof collect, "function");
  if (typeof collect !== "function") return;

  const requested: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(`${url.pathname}?${url.searchParams.toString()}`);

    if (url.pathname.endsWith("/seller-products")) {
      if (url.searchParams.get("nextToken") === "2") {
        return Response.json({ code: "SUCCESS", message: "", nextToken: "", data: [{ sellerProductId: 1002, sellerProductName: "사과" }] });
      }
      return Response.json({ code: "SUCCESS", message: "", nextToken: "2", data: [{ sellerProductId: 1001, sellerProductName: "복숭아" }] });
    }
    if (url.pathname.endsWith("/seller-products/1001")) return Response.json({ code: "SUCCESS", data: productDetail });
    if (url.pathname.endsWith("/seller-products/1002")) {
      return Response.json({ code: "SUCCESS", data: { sellerProductId: 1002, sellerProductName: "사과", statusName: "승인완료", items: [] } });
    }
    if (url.pathname.endsWith("/vendor-items/3001/inventories")) {
      return Response.json({ code: "SUCCESS", data: { sellerItemId: 3001, amountInStock: 7, salePrice: 35000, onSale: true } });
    }
    if (url.pathname.endsWith("/vendor-items/3002/inventories")) {
      return Response.json({ code: "SUCCESS", data: { sellerItemId: 3002, amountInStock: 0, salePrice: 39000, onSale: false } });
    }
    return Response.json({ message: "unexpected request" }, { status: 500 });
  };

  const result = await collect(
    { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    fetcher,
  ) as Array<{ channelProductNo: string }>;

  assert.deepEqual(result.map((item) => item.channelProductNo), ["3001", "3002"]);
  assert.equal(requested.filter((value) => value.includes("/seller-products?")).length, 2);
  assert.equal(requested.some((value) => value.includes("vendorId=A01755825")), true);
  assert.equal(requested.some((value) => value.includes("maxPerPage=100")), true);
  assert.equal(requested.some((value) => value.includes("nextToken=2")), true);
});

test("retries a rate-limited Coupang product-list request", async () => {
  const collect = (coupang as Record<string, unknown>).collectCoupangInventory;
  assert.equal(typeof collect, "function");
  if (typeof collect !== "function") return;

  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return Response.json({ code: "ERROR", message: "rate limited" }, { status: 429, headers: { "Retry-After": "0" } });
    }
    return Response.json({ code: "SUCCESS", message: "", nextToken: "", data: [] });
  };

  const result = await collect(
    { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    fetcher,
  ) as unknown[];

  assert.deepEqual(result, []);
  assert.equal(attempts, 2);
});

test("lists only temporarily saved Coupang products as approval candidates", async () => {
  const listCandidates = (coupang as Record<string, unknown>).listCoupangApprovalCandidates;
  assert.equal(typeof listCandidates, "function");
  if (typeof listCandidates !== "function") return;

  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname.endsWith("/seller-products"), true);
    return Response.json({
      code: "SUCCESS",
      nextToken: "",
      data: [
        { sellerProductId: 1001, sellerProductName: "임시 사과", statusName: "임시저장" },
        { sellerProductId: 1002, sellerProductName: "승인 복숭아", statusName: "승인완료" },
      ],
    });
  };

  const result = await listCandidates(
    { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    fetcher,
  );

  assert.deepEqual(result, [{ sellerProductId: "1001", sellerProductName: "임시 사과", statusName: "임시저장" }]);
});

test("requests approval with PUT and no request body", async () => {
  const requestApproval = (coupang as Record<string, unknown>).requestCoupangProductApproval;
  assert.equal(typeof requestApproval, "function");
  if (typeof requestApproval !== "function") return;

  let requestMethod = "";
  let requestBody: BodyInit | null | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname.endsWith("/seller-products/1001/approvals"), true);
    requestMethod = init?.method ?? "";
    requestBody = init?.body;
    return Response.json({ code: "SUCCESS", message: "승인 요청되었습니다.", data: "1001" });
  };

  const result = await requestApproval(
    { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    "1001",
    fetcher,
  );

  assert.equal(requestMethod, "PUT");
  assert.equal(requestBody, undefined);
  assert.deepEqual(result, { sellerProductId: "1001", message: "승인 요청되었습니다." });
});

test("rejects an invalid Coupang seller product id before approval", async () => {
  const requestApproval = (coupang as Record<string, unknown>).requestCoupangProductApproval;
  assert.equal(typeof requestApproval, "function");
  if (typeof requestApproval !== "function") return;

  let called = false;
  await assert.rejects(
    () => requestApproval(
      { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
      "1001/approvals",
      async () => { called = true; return Response.json({ code: "SUCCESS" }); },
    ),
    /상품 ID/,
  );
  assert.equal(called, false);
});

test("rechecks every selected product is still a draft before approving any product", async () => {
  const approveDrafts = (coupang as Record<string, unknown>).approveCoupangDraftProducts;
  assert.equal(typeof approveDrafts, "function");
  if (typeof approveDrafts !== "function") return;

  let putCount = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    if (init?.method === "PUT") putCount += 1;
    return Response.json({
      code: "SUCCESS",
      nextToken: "",
      data: [{ sellerProductId: 1001, sellerProductName: "임시 사과", statusName: "임시저장" }],
    });
  };

  await assert.rejects(
    () => approveDrafts(
      { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
      ["1001", "1002"],
      "쿠팡 상품 승인요청",
      fetcher,
    ),
    /임시저장 상태가 아닌 상품/,
  );
  assert.equal(putCount, 0);
});

test("approves the selected drafts sequentially after exact confirmation", async () => {
  const approveDrafts = (coupang as Record<string, unknown>).approveCoupangDraftProducts;
  assert.equal(typeof approveDrafts, "function");
  if (typeof approveDrafts !== "function") return;

  const approved: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "PUT") {
      const id = url.pathname.split("/").at(-2) ?? "";
      approved.push(id);
      return Response.json({ code: "SUCCESS", message: `${id} 승인 요청`, data: id });
    }
    return Response.json({
      code: "SUCCESS",
      nextToken: "",
      data: [
        { sellerProductId: 1001, sellerProductName: "임시 사과", statusName: "임시저장" },
        { sellerProductId: 1002, sellerProductName: "임시 배", statusName: "임시저장" },
      ],
    });
  };

  await assert.rejects(
    () => approveDrafts(
      { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
      ["1001"],
      "쿠팡 상품 승인 요청",
      fetcher,
    ),
    /확인 문구/,
  );
  assert.deepEqual(approved, []);

  const result = await approveDrafts(
    { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    ["1002", "1001", "1002"],
    "쿠팡 상품 승인요청",
    fetcher,
  );
  assert.deepEqual(approved, ["1002", "1001"]);
  assert.deepEqual(result.map((item: { sellerProductId: string }) => item.sellerProductId), ["1002", "1001"]);
});

test("changes Coupang item stock through the vendor-item quantity endpoint", async () => {
  const changeStock = (coupang as Record<string, unknown>).changeCoupangStock;
  assert.equal(typeof changeStock, "function");
  if (typeof changeStock !== "function") return;

  let requested = "";
  let body: BodyInit | null | undefined;
  await changeStock(
    { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    "3001",
    27,
    async (input, init) => {
      requested = `${init?.method} ${new URL(String(input)).pathname}`;
      body = init?.body;
      return Response.json({ code: "SUCCESS", message: "재고 변경을 완료했습니다." });
    },
  );

  assert.equal(requested, "PUT /v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/3001/quantities/27");
  assert.equal(body, undefined);
  await assert.rejects(
    () => changeStock(
      { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
      "3001",
      -1,
      async () => { throw new Error("호출되면 안 됨"); },
    ),
    /재고/,
  );
});

test("waits until Coupang inventory reads back the changed quantity", async () => {
  const changeAndVerify = (coupang as Record<string, unknown>).changeCoupangStockAndVerify;
  assert.equal(typeof changeAndVerify, "function");
  if (typeof changeAndVerify !== "function") return;

  const reads = [0, 27];
  let readCount = 0;
  const result = await changeAndVerify(
    { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    "3001",
    27,
    async (_input, init) => {
      if (init?.method === "PUT") return Response.json({ code: "SUCCESS", message: "변경 접수" });
      const amountInStock = reads[Math.min(readCount, reads.length - 1)];
      readCount += 1;
      return Response.json({ code: "SUCCESS", data: { amountInStock, onSale: true } });
    },
    async () => {},
  );

  assert.equal(result.stockQuantity, 27);
  assert.equal(readCount, 2);
});

test("stops and resumes Coupang sales through the matching vendor-item endpoints", async () => {
  const changeStatus = (coupang as Record<string, unknown>).changeCoupangSalesStatus;
  assert.equal(typeof changeStatus, "function");
  if (typeof changeStatus !== "function") return;

  const requested: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requested.push(`${init?.method} ${new URL(String(input)).pathname}`);
    return Response.json({ code: "SUCCESS", message: "변경 완료" });
  };
  const credentials = { accessKey: "access", secretKey: "secret", vendorId: "A01755825" };
  await changeStatus(credentials, "3001", "SUSPENSION", fetcher);
  await changeStatus(credentials, "3001", "SALE", fetcher);

  assert.deepEqual(requested, [
    "PUT /v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/3001/sales/stop",
    "PUT /v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/3001/sales/resume",
  ]);
  await assert.rejects(() => changeStatus(credentials, "3001", "OUTOFSTOCK", fetcher), /판매 상태/);
});

test("permanently deletes a Coupang seller product through its product id", async () => {
  const deleteProduct = (coupang as Record<string, unknown>).deleteCoupangProduct;
  assert.equal(typeof deleteProduct, "function");
  if (typeof deleteProduct !== "function") return;

  let requested = "";
  await deleteProduct(
    { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
    "1001",
    async (input, init) => {
      requested = `${init?.method} ${new URL(String(input)).pathname}`;
      return Response.json({ code: "SUCCESS", message: "삭제되었습니다", data: "1001" });
    },
  );

  assert.equal(requested, "DELETE /v2/providers/seller_api/apis/api/v1/marketplace/seller-products/1001");
  await assert.rejects(
    () => deleteProduct(
      { accessKey: "access", secretKey: "secret", vendorId: "A01755825" },
      "1001/delete",
      async () => { throw new Error("호출되면 안 됨"); },
    ),
    /상품 ID/,
  );
});
