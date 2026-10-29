import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCentralInventoryOverview,
  buildCentralInventoryQuantityChanges,
  buildCentralInventorySyncChanges,
  buildManualNaverMasterMapping,
  buildMappingReviewGroups,
  buildStoredMappingReviewGroups,
  buildNaverMasterMappings,
  explainUnmappedInventoryItem,
  findCentralInventoryIdForChannelItem,
  listUnmappedChannelItems,
  reconcileInventoryReservations,
} from "../app/lib/inventory/central-inventory.ts";

test("summarizes each connected product once and keeps channel-specific status differences", () => {
  assert.equal(typeof buildCentralInventoryOverview, "function");
  if (typeof buildCentralInventoryOverview !== "function") return;

  const result = buildCentralInventoryOverview([
    { channel: "naver", channelProductNo: "N1", originProductNo: "NO1", sellerProductCode: "APPLE", productName: "네이버 사과", stockQuantity: 10, statusType: "SALE" },
    { channel: "coupang", channelProductNo: "C1", originProductNo: "CO1", sellerProductCode: "APPLE", productName: "쿠팡 사과", stockQuantity: 10, statusType: "SALE" },
    { channel: "naver", channelProductNo: "N2", originProductNo: "NO2", sellerProductCode: "", productName: "선물세트", stockQuantity: 0, statusType: "OUTOFSTOCK" },
    { channel: "coupang", channelProductNo: "C2", originProductNo: "CO2", sellerProductCode: "NV-N2", productName: "선물세트", stockQuantity: 0, statusType: "SUSPENSION" },
    { channel: "coupang", channelProductNo: "C3", originProductNo: "CO3", sellerProductCode: "ONLY-C", productName: "쿠팡 전용", stockQuantity: 3, statusType: "SALE" },
  ], [
    { id: "APPLE", source: "auto", masterKey: "naver:N1", targetKeys: ["coupang:C1"] },
    { id: "NAVER-N2", source: "manual", masterKey: "naver:N2", targetKeys: ["coupang:C2"] },
  ]);

  assert.deepEqual(result, {
    productCount: 3,
    totalStockQuantity: 13,
    unknownStockProductCount: 0,
    saleProductCount: 2,
    soldOutProductCount: 1,
    suspendedProductCount: 0,
    connectedProductCount: 2,
    standaloneProductCount: 1,
    codeCleanupCount: 1,
    codeCleanupProducts: [{ id: "NAVER-N2", productName: "선물세트", channels: ["naver", "coupang"] }],
  });
});

test("builds only unambiguous one-to-one mappings from the Naver seller code", () => {
  const result = buildNaverMasterMappings([
    { channel: "naver", channelProductNo: "N1", originProductNo: "NO1", sellerProductCode: " peach-4kg ", productName: "복숭아", stockQuantity: 10 },
    { channel: "coupang", channelProductNo: "C1", originProductNo: "CO1", sellerProductCode: "PEACH-4KG", productName: "복숭아", stockQuantity: 7 },
    { channel: "naver", channelProductNo: "N2", originProductNo: "NO2", sellerProductCode: "DUP", productName: "중복1", stockQuantity: 4 },
    { channel: "naver", channelProductNo: "N3", originProductNo: "NO3", sellerProductCode: "dup", productName: "중복2", stockQuantity: 5 },
    { channel: "coupang", channelProductNo: "C2", originProductNo: "CO2", sellerProductCode: "DUP", productName: "중복", stockQuantity: 5 },
    { channel: "coupang", channelProductNo: "C3", originProductNo: "CO3", sellerProductCode: "ONLY-C", productName: "쿠팡만", stockQuantity: 2 },
  ]);

  assert.deepEqual(result.groups, [{
    id: "PEACH-4KG",
    sellerProductCode: "PEACH-4KG",
    productName: "복숭아",
    availableQuantity: 10,
    master: { channel: "naver", channelProductNo: "N1", originProductNo: "NO1", stockQuantity: 10 },
    targets: [{ channel: "coupang", channelProductNo: "C1", originProductNo: "CO1", stockQuantity: 7 }],
  }]);
  assert.deepEqual(result.conflictCodes, ["DUP"]);
  assert.equal(result.unmatchedNaverCount, 0);
  assert.equal(result.unmatchedChannelCount, 1);
});

test("reserves each new paid order once and never double-decrements it", () => {
  const orders = [{
    id: "coupang:ORDER-1",
    sellerProductCode: "PEACH-4KG",
    quantity: 2,
    orderStatus: "ACCEPT",
    claimStatus: "",
  }];

  const first = reconcileInventoryReservations(10, orders, []);
  assert.equal(first.availableQuantity, 8);
  assert.deepEqual(first.upserts, [{ id: "coupang:ORDER-1", quantity: 2, status: "reserved" }]);

  const second = reconcileInventoryReservations(8, orders, first.upserts);
  assert.equal(second.availableQuantity, 8);
  assert.deepEqual(second.upserts, []);
});

test("restores a reservation only after cancellation completes", () => {
  const existing = [{ id: "naver:ORDER-2", quantity: 3, status: "reserved" as const }];
  const requested = reconcileInventoryReservations(7, [{
    id: "naver:ORDER-2", sellerProductCode: "PEACH-4KG", quantity: 3,
    orderStatus: "PAYED", claimStatus: "CANCEL_REQUEST",
  }], existing);
  assert.equal(requested.availableQuantity, 7);
  assert.deepEqual(requested.upserts, []);

  const completed = reconcileInventoryReservations(7, [{
    id: "naver:ORDER-2", sellerProductCode: "PEACH-4KG", quantity: 3,
    orderStatus: "CANCELED", claimStatus: "CANCEL_DONE",
  }], existing);
  assert.equal(completed.availableQuantity, 10);
  assert.deepEqual(completed.upserts, [{ id: "naver:ORDER-2", quantity: 3, status: "released" }]);
});

test("never lets order reservations reduce available stock below zero", () => {
  const result = reconcileInventoryReservations(1, [{
    id: "coupang:ORDER-3", sellerProductCode: "PEACH-4KG", quantity: 4,
    orderStatus: "ACCEPT", claimStatus: "",
  }], []);
  assert.equal(result.availableQuantity, 0);
  assert.equal(result.shortageQuantity, 3);
});

test("plans updates for every channel whose stock differs from central availability", () => {
  const changes = buildCentralInventorySyncChanges({
    id: "PEACH-4KG",
    sellerProductCode: "PEACH-4KG",
    productName: "복숭아",
    availableQuantity: 8,
    master: { channel: "naver", channelProductNo: "N1", originProductNo: "NO1", stockQuantity: 9 },
    targets: [
      { channel: "coupang", channelProductNo: "C1", originProductNo: "CO1", stockQuantity: 7 },
      { channel: "cafe24", channelProductNo: "F1", originProductNo: "FO1", stockQuantity: 8 },
    ],
  });

  assert.deepEqual(changes, [
    { centralInventoryId: "PEACH-4KG", sellerProductCode: "PEACH-4KG", productName: "복숭아", channel: "naver", channelProductNo: "N1", originProductNo: "NO1", previousQuantity: 9, newQuantity: 8 },
    { centralInventoryId: "PEACH-4KG", sellerProductCode: "PEACH-4KG", productName: "복숭아", channel: "coupang", channelProductNo: "C1", originProductNo: "CO1", previousQuantity: 7, newQuantity: 8 },
  ]);
});

test("resolves the same central product from either linked channel card", () => {
  const groups = [{
    id: "PEACH-4KG",
    source: "auto" as const,
    masterKey: "naver:N1",
    targetKeys: ["coupang:C1"],
  }];

  assert.equal(findCentralInventoryIdForChannelItem(groups, "naver", "N1"), "PEACH-4KG");
  assert.equal(findCentralInventoryIdForChannelItem(groups, "coupang", "C1"), "PEACH-4KG");
  assert.equal(findCentralInventoryIdForChannelItem(groups, "coupang", "C404"), null);
});

test("plans the requested central quantity for every linked sales channel", () => {
  const changes = buildCentralInventoryQuantityChanges({
    id: "PEACH-4KG",
    sellerProductCode: "PEACH-4KG",
    productName: "복숭아",
    availableQuantity: 10,
    master: { channel: "naver", channelProductNo: "N1", originProductNo: "NO1", stockQuantity: 10 },
    targets: [
      { channel: "coupang", channelProductNo: "C1", originProductNo: "CO1", stockQuantity: 10 },
    ],
  }, 7);

  assert.deepEqual(changes, [
    { centralInventoryId: "PEACH-4KG", sellerProductCode: "PEACH-4KG", productName: "복숭아", channel: "naver", channelProductNo: "N1", originProductNo: "NO1", previousQuantity: 10, newQuantity: 7 },
    { centralInventoryId: "PEACH-4KG", sellerProductCode: "PEACH-4KG", productName: "복숭아", channel: "coupang", channelProductNo: "C1", originProductNo: "CO1", previousQuantity: 10, newQuantity: 7 },
  ]);
});

test("creates a manual mapping with the Naver seller code as the central identity", () => {
  const result = buildManualNaverMasterMapping([
    { channel: "naver", channelProductNo: "N10", originProductNo: "NO10", sellerProductCode: " apple-3kg ", productName: "네이버 사과", stockQuantity: 12 },
    { channel: "coupang", channelProductNo: "C10", originProductNo: "CO10", sellerProductCode: "OLD-CODE", productName: "쿠팡 사과", stockQuantity: 5 },
  ], "N10", "C10");

  assert.deepEqual(result, {
    id: "APPLE-3KG",
    sellerProductCode: "APPLE-3KG",
    productName: "네이버 사과",
    availableQuantity: 12,
    master: { channel: "naver", channelProductNo: "N10", originProductNo: "NO10", stockQuantity: 12 },
    targets: [{ channel: "coupang", channelProductNo: "C10", originProductNo: "CO10", stockQuantity: 5 }],
  });
});

test("uses a stable Naver product identity when its seller code is blank", () => {
  const result = buildManualNaverMasterMapping([
    { channel: "naver", channelProductNo: "N20", originProductNo: "NO20", sellerProductCode: "", productName: "네이버 배", stockQuantity: 4 },
    { channel: "coupang", channelProductNo: "C20", originProductNo: "CO20", sellerProductCode: "PEAR", productName: "쿠팡 배", stockQuantity: 4 },
  ], "N20", "C20");
  assert.equal(result.id, "NAVER-N20");
  assert.equal(result.sellerProductCode, "NAVER-N20");
});

test("rejects a manual mapping unless one Naver item and one Coupang item are selected", () => {
  assert.throws(() => buildManualNaverMasterMapping([
    { channel: "naver", channelProductNo: "N1", originProductNo: "NO1", sellerProductCode: "A", productName: "A", stockQuantity: 1 },
  ], "N1", "C1"), /쿠팡/);
});

test("explains blank, duplicate, and cross-channel product-code mismatches", () => {
  const items = [
    { channel: "naver", channelProductNo: "N1", originProductNo: "NO1", sellerProductCode: "", productName: "코드 없음", stockQuantity: 1 },
    { channel: "naver", channelProductNo: "N2", originProductNo: "NO2", sellerProductCode: "DUP", productName: "중복 1", stockQuantity: 1 },
    { channel: "naver", channelProductNo: "N3", originProductNo: "NO3", sellerProductCode: "dup", productName: "중복 2", stockQuantity: 1 },
    { channel: "coupang", channelProductNo: "C2", originProductNo: "CO2", sellerProductCode: "DUP", productName: "중복 대상", stockQuantity: 1 },
    { channel: "coupang", channelProductNo: "C3", originProductNo: "CO3", sellerProductCode: "ONLY-C", productName: "상대 없음", stockQuantity: 1 },
  ];

  assert.match(explainUnmappedInventoryItem(items, items[0]), /상품코드가 비어/);
  assert.match(explainUnmappedInventoryItem(items, items[1]), /네이버에 같은 코드가 2개/);
  assert.match(explainUnmappedInventoryItem(items, items[4]), /네이버에 같은 코드가 없어/);
});

test("explains when an exact unique pair exists but has not been connected yet", () => {
  const items = [
    { channel: "naver", channelProductNo: "N1", originProductNo: "NO1", sellerProductCode: "PAIR", productName: "네이버", stockQuantity: 1 },
    { channel: "coupang", channelProductNo: "C1", originProductNo: "CO1", sellerProductCode: "pair", productName: "쿠팡", stockQuantity: 1 },
  ];
  assert.match(explainUnmappedInventoryItem(items, items[0]), /같은 코드 상품이 있지만/);
});

test("builds image-review pairs and marks only user-created mappings as manual", () => {
  const groups = [
    {
      id: "AUTO", sellerProductCode: "AUTO", productName: "자동", availableQuantity: 1,
      master: { channel: "naver" as const, channelProductNo: "N1", originProductNo: "NO1", stockQuantity: 1 },
      targets: [{ channel: "coupang", channelProductNo: "C1", originProductNo: "CO1", stockQuantity: 1 }],
    },
    {
      id: "MANUAL", sellerProductCode: "MANUAL", productName: "수동", availableQuantity: 2,
      master: { channel: "naver" as const, channelProductNo: "N2", originProductNo: "NO2", stockQuantity: 2 },
      targets: [{ channel: "coupang", channelProductNo: "C2", originProductNo: "CO2", stockQuantity: 3 }],
    },
  ];
  assert.deepEqual(buildMappingReviewGroups(groups, ["MANUAL"]), [
    { id: "AUTO", source: "auto", masterKey: "naver:N1", targetKeys: ["coupang:C1"] },
    { id: "MANUAL", source: "manual", masterKey: "naver:N2", targetKeys: ["coupang:C2"] },
  ]);
});

test("keeps stored review pairs visible even when a live Naver product is missing", () => {
  const result = buildStoredMappingReviewGroups(
    [{ id: "MISSING-N", mappingSource: "manual" }],
    [
      { centralInventoryId: "MISSING-N", channel: "naver", channelProductNo: "N404" },
      { centralInventoryId: "MISSING-N", channel: "coupang", channelProductNo: "C1" },
    ],
  );
  assert.deepEqual(result, [{
    id: "MISSING-N", source: "manual", masterKey: "naver:N404", targetKeys: ["coupang:C1"],
  }]);
});

test("separates live products that exist only as unmapped Naver or Coupang items", () => {
  const items = [
    { channel: "naver", channelProductNo: "N1" },
    { channel: "naver", channelProductNo: "N2" },
    { channel: "coupang", channelProductNo: "C1" },
    { channel: "coupang", channelProductNo: "C2" },
  ];
  const result = listUnmappedChannelItems(items, ["naver:N1", "coupang:C1"]);
  assert.deepEqual(result.naver, [items[1]]);
  assert.deepEqual(result.coupang, [items[3]]);
});
