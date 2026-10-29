import assert from "node:assert/strict";
import test from "node:test";

import * as inventory from "../app/lib/inventory/channel-inventory.ts";

test("groups collected orders into one inventory product per channel product number", () => {
  assert.equal(typeof inventory.groupCollectedInventoryProducts, "function");
  if (typeof inventory.groupCollectedInventoryProducts !== "function") return;
  const result = inventory.groupCollectedInventoryProducts([
    { channel: "naver", channelProductId: "100", sellerProductCode: "PEACH", productName: "복숭아 4kg", optionName: "11과", quantity: 1 },
    { channel: "naver", channelProductId: "100", sellerProductCode: "PEACH", productName: "복숭아 4kg", optionName: "13과", quantity: 2 },
    { channel: "naver", channelProductId: "200", sellerProductCode: "APPLE", productName: "사과 5kg", optionName: "", quantity: 1 },
  ]);
  assert.deepEqual(result, [
    { channel: "naver", channelProductNo: "100", sellerProductCode: "PEACH", productName: "복숭아 4kg", options: ["11과", "13과"], collectedOrderCount: 2, collectedQuantity: 3 },
    { channel: "naver", channelProductNo: "200", sellerProductCode: "APPLE", productName: "사과 5kg", options: [], collectedOrderCount: 1, collectedQuantity: 1 },
  ]);
});

test("summarizes distinct channel inventory without counting duplicate orders", () => {
  assert.equal(typeof inventory.summarizeChannelInventory, "function");
  if (typeof inventory.summarizeChannelInventory !== "function") return;
  assert.deepEqual(inventory.summarizeChannelInventory([
    { channel: "naver", channelProductNo: "100", stockQuantity: 15, statusType: "SALE" },
    { channel: "naver", channelProductNo: "200", stockQuantity: 0, statusType: "OUTOFSTOCK" },
  ]), { productCount: 2, totalStockQuantity: 15, unknownStockProductCount: 0, saleProductCount: 1, soldOutProductCount: 1, suspendedProductCount: 0 });
});

test("excludes unknown stock from the total instead of presenting it as zero stock", () => {
  assert.deepEqual(inventory.summarizeChannelInventory([
    { channel: "naver", channelProductNo: "100", stockQuantity: null, statusType: "SALE" },
  ]), { productCount: 1, totalStockQuantity: 0, unknownStockProductCount: 1, saleProductCount: 1, soldOutProductCount: 0, suspendedProductCount: 0 });
});

test("counts suspended products separately from products on sale", () => {
  assert.deepEqual(inventory.summarizeChannelInventory([
    { channel: "naver", channelProductNo: "100", stockQuantity: 10, statusType: "SALE" },
    { channel: "naver", channelProductNo: "200", stockQuantity: 8, statusType: "SUSPENSION" },
  ]), { productCount: 2, totalStockQuantity: 18, unknownStockProductCount: 0, saleProductCount: 1, soldOutProductCount: 0, suspendedProductCount: 1 });
});

test("summarizes status counts for only the selected sales channel", () => {
  const summarizeForChannel = (inventory as Record<string, unknown>).summarizeInventoryForChannel;
  assert.equal(typeof summarizeForChannel, "function");
  if (typeof summarizeForChannel !== "function") return;

  const items = [
    { channel: "naver", channelProductNo: "N1", stockQuantity: 4, statusType: "SALE" },
    { channel: "naver", channelProductNo: "N2", stockQuantity: 0, statusType: "OUTOFSTOCK" },
    { channel: "coupang", channelProductNo: "C1", stockQuantity: 8, statusType: "SUSPENSION" },
  ];

  assert.deepEqual(summarizeForChannel(items, "naver"), {
    productCount: 2,
    totalStockQuantity: 4,
    unknownStockProductCount: 0,
    saleProductCount: 1,
    soldOutProductCount: 1,
    suspendedProductCount: 0,
  });
  assert.deepEqual(summarizeForChannel(items, "coupang"), {
    productCount: 1,
    totalStockQuantity: 8,
    unknownStockProductCount: 0,
    saleProductCount: 0,
    soldOutProductCount: 0,
    suspendedProductCount: 1,
  });
});

test("keeps channel in the inventory identity for future Coupang and Cafe24 products", () => {
  assert.equal(typeof inventory.groupCollectedInventoryProducts, "function");
  if (typeof inventory.groupCollectedInventoryProducts !== "function") return;
  const result = inventory.groupCollectedInventoryProducts([
    { channel: "naver", channelProductId: "100", sellerProductCode: "P", productName: "복숭아", optionName: "", quantity: 1 },
    { channel: "coupang", channelProductId: "100", sellerProductCode: "P", productName: "복숭아", optionName: "", quantity: 1 },
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.channel), ["naver", "coupang"]);
});

test("adds image overlays only for sold-out and suspended products", () => {
  assert.equal(typeof inventory.getInventoryImageOverlay, "function");
  if (typeof inventory.getInventoryImageOverlay !== "function") return;
  assert.equal(inventory.getInventoryImageOverlay("SALE"), null);
  assert.deepEqual(inventory.getInventoryImageOverlay("OUTOFSTOCK"), { label: "품절", tone: "soldout" });
  assert.deepEqual(inventory.getInventoryImageOverlay("SUSPENSION"), { label: "판매중지", tone: "suspended" });
});

test("offers a safe resume action only when a suspended product has stock", () => {
  assert.equal(typeof inventory.getInventoryStatusAction, "function");
  if (typeof inventory.getInventoryStatusAction !== "function") return;

  assert.deepEqual(inventory.getInventoryStatusAction("SUSPENSION", 3), {
    targetStatus: "SALE",
    label: "판매중으로 변경",
    enabled: true,
    disabledLabel: "",
  });
  assert.deepEqual(inventory.getInventoryStatusAction("SUSPENSION", 0), {
    targetStatus: "SALE",
    label: "판매중으로 변경",
    enabled: false,
    disabledLabel: "재고 1개 이상 필요",
  });
});

test("offers suspension for sellable states and no action for unsupported states", () => {
  assert.equal(typeof inventory.getInventoryStatusAction, "function");
  if (typeof inventory.getInventoryStatusAction !== "function") return;

  assert.deepEqual(inventory.getInventoryStatusAction("SALE", 5), {
    targetStatus: "SUSPENSION",
    label: "판매중지로 변경",
    enabled: true,
    disabledLabel: "",
  });
  assert.equal(inventory.getInventoryStatusAction("CLOSE", 5), null);
});

test("merges collected Coupang order counts into the matching live option inventory", () => {
  const merge = (inventory as Record<string, unknown>).mergeCollectedInventoryMetrics;
  assert.equal(typeof merge, "function");
  if (typeof merge !== "function") return;

  const result = merge([
    {
      channel: "coupang", channelProductNo: "3001", originProductNo: "1001", imageUrl: "image.jpg",
      productName: "복숭아 선물세트", sellerProductCode: "PEACH", options: ["4kg 대과"],
      collectedOrderCount: 0, collectedQuantity: 0, statusType: "SALE", stockQuantity: 7,
    },
  ], [
    {
      channel: "coupang", channelProductNo: "3001", sellerProductCode: "PEACH", productName: "복숭아 선물세트",
      options: ["4kg 대과", "선물포장"], collectedOrderCount: 2, collectedQuantity: 3,
    },
  ]);

  assert.deepEqual(result[0], {
    channel: "coupang", channelProductNo: "3001", originProductNo: "1001", imageUrl: "image.jpg",
    productName: "복숭아 선물세트", sellerProductCode: "PEACH", options: ["4kg 대과", "선물포장"],
    collectedOrderCount: 2, collectedQuantity: 3, statusType: "SALE", stockQuantity: 7,
  });
});

test("builds a channel-preserving inventory snapshot record", () => {
  const build = (inventory as Record<string, unknown>).buildInventorySnapshotRecord;
  assert.equal(typeof build, "function");
  if (typeof build !== "function") return;

  assert.deepEqual(build({
    channel: "coupang", channelProductNo: "3001", originProductNo: "1001", imageUrl: "image.jpg",
    productName: "복숭아 선물세트", sellerProductCode: "PEACH", options: ["4kg 대과"],
    collectedOrderCount: 2, collectedQuantity: 3, statusType: "SALE", stockQuantity: 7,
  }, "2026-08-14T00:00:00.000Z"), {
    id: "coupang:3001", channel: "coupang", channelProductNo: "3001", originProductNo: "1001",
    productName: "복숭아 선물세트", sellerManagementCode: "PEACH", statusType: "SALE", stockQuantity: 7,
    fetchedAt: "2026-08-14T00:00:00.000Z",
  });
});
