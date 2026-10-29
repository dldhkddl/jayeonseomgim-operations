import assert from "node:assert/strict";
import test from "node:test";

import { groupSupplierRowsByTracking, matchShipments } from "../app/lib/invoice/matcher.ts";
import type { NaverOrder, SupplierRow } from "../app/lib/invoice/types.ts";

const baseOrder = (overrides: Partial<NaverOrder> = {}): NaverOrder => ({
  productOrderId: "202608121234567890",
  productName: "햇 복숭아 4.5kg",
  quantity: 1,
  buyerName: "구매자",
  recipientName: "홍길동",
  address: "가상시 예시구 테스트로 100",
  phone1: "010-0000-2668",
  phone2: "02-123-4567",
  deliveryMessage: "",
  buyerPhone: "010-0000-4657",
  sellerId: "seller-a",
  buyerId: "buyer-a",
  status: "배송준비",
  ...overrides,
});

test("groups multiple supplier product rows by tracking number before matching", () => {
  const rows: SupplierRow[] = [
    { trackingNumber: "123456789012345678", carrier: "CJ대한통운", productName: "복숭아", quantity: 1, recipientName: "홍길동", phone: "01000002668", address: "가상시 예시구 테스트로 100" },
    { trackingNumber: "123456789012345678", carrier: "CJ대한통운", productName: "자두", quantity: 2, recipientName: "홍길동", phone: "01000002668", address: "가상시 예시구 테스트로 100" },
  ];
  const grouped = groupSupplierRowsByTracking(rows);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].items.map((item) => [item.productName, item.quantity]), [["복숭아", 1], ["자두", 2]]);
});

test("auto matches a unique order and never assigns one order twice", () => {
  const orders = [baseOrder()];
  const shipments = groupSupplierRowsByTracking([
    { trackingNumber: "111", carrier: "CJ대한통운", productName: "햇복숭아 4.5kg", quantity: 1, recipientName: "홍길동", phone: "01000002668", address: "가상시 예시구 테스트로 100" },
    { trackingNumber: "222", carrier: "CJ대한통운", productName: "햇복숭아 4.5kg", quantity: 1, recipientName: "홍길동", phone: "01000002668", address: "가상시 예시구 테스트로 100" },
  ]);
  const result = matchShipments(orders, shipments);
  assert.equal(result[0].status, "auto_matched");
  assert.equal(result[1].status, "review_required");
});

test("excludes already dispatched orders", () => {
  const result = matchShipments(
    [baseOrder({ status: "배송중" })],
    groupSupplierRowsByTracking([{ trackingNumber: "111", carrier: "CJ대한통운", productName: "햇복숭아 4.5kg", quantity: 1, recipientName: "홍길동", phone: "01000002668", address: "가상시 예시구 테스트로 100" }]),
  );
  assert.equal(result[0].status, "review_required");
  assert.match(result[0].reason, /발송 가능한 주문/);
});

test("only combines orders when every Naver combined-shipping identity field matches", () => {
  const orders = [baseOrder(), baseOrder({ productOrderId: "202608121234567891", productName: "자두 2kg", phone2: "010-0000-6138" })];
  const shipment = groupSupplierRowsByTracking([
    { trackingNumber: "111", carrier: "CJ대한통운", productName: "복숭아", quantity: 1, recipientName: "홍길동", phone: "01000002668", address: "가상시 예시구 테스트로 100" },
    { trackingNumber: "111", carrier: "CJ대한통운", productName: "자두", quantity: 1, recipientName: "홍길동", phone: "01000002668", address: "가상시 예시구 테스트로 100" },
  ]);
  const result = matchShipments(orders, shipment);
  assert.equal(result[0].status, "review_required");
  assert.match(result[0].reason, /묶음배송 기준/);
});
