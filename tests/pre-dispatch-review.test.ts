import assert from "node:assert/strict";
import test from "node:test";

import {
  dispatchableOrders,
  preDispatchItemState,
  reviewFingerprint,
  reviewPreDispatchOrders,
  summarizePreDispatchReview,
  type ReviewDecision,
} from "../app/lib/invoice/pre-dispatch-review.ts";
import type { NaverOrder } from "../app/lib/invoice/types.ts";

function order(overrides: Partial<NaverOrder> = {}): NaverOrder {
  return {
    productOrderId: "ORDER-1",
    productName: "복숭아 4kg",
    quantity: 1,
    buyerName: "김구매",
    recipientName: "홍길동",
    address: "가상시 예시구 테스트로 300",
    phone1: "010-1234-5678",
    phone2: "",
    deliveryMessage: "문 앞에 놓아주세요",
    buyerPhone: "010-0000-2852",
    sellerId: "seller",
    buyerId: "buyer",
    status: "배송준비",
    ...overrides,
  };
}

function issueCodes(reviewed: ReturnType<typeof reviewPreDispatchOrders>, index = 0) {
  return new Set(reviewed[index].issues.map((issue) => `${issue.severity}:${issue.code}`));
}

test("필수 배송정보 누락과 발송 불가 상태를 차단한다", () => {
  const reviewed = reviewPreDispatchOrders([
    order({ productOrderId: "", recipientName: "", phone1: "", phone2: "", address: "", productName: "", quantity: 0, status: "취소" }),
  ]);

  assert.deepEqual(issueCodes(reviewed), new Set([
    "blocking:missing_product_order_id",
    "blocking:missing_recipient_name",
    "blocking:missing_phone",
    "blocking:missing_address",
    "blocking:missing_product_name",
    "blocking:invalid_quantity",
    "blocking:not_dispatchable_status",
  ]));
});

test("중복 상품주문번호를 두 주문 모두 차단한다", () => {
  const reviewed = reviewPreDispatchOrders([
    order({ productOrderId: "DUPLICATE" }),
    order({ productOrderId: "DUPLICATE", recipientName: "김다른" }),
  ]);

  assert.equal(reviewed.every((item) => item.issues.some((issue) => issue.code === "duplicate_product_order_id" && issue.severity === "blocking")), true);
});

test("전화번호·짧은 주소·제주 배송지·특이 배송메시지를 확인 대상으로 만든다", () => {
  const reviewed = reviewPreDispatchOrders([
    order({ phone1: "12345", address: "제주 제주시", deliveryMessage: "도착 전 연락 부탁드립니다" }),
  ]);
  const codes = issueCodes(reviewed);

  assert.equal(codes.has("warning:invalid_phone_format"), true);
  assert.equal(codes.has("warning:short_address"), true);
  assert.equal(codes.has("warning:remote_area"), true);
  assert.equal(codes.has("warning:special_delivery_message"), true);
});

test("같은 배송지의 합포장 후보와 수취인 충돌을 표시한다", () => {
  const reviewed = reviewPreDispatchOrders([
    order({ productOrderId: "A" }),
    order({ productOrderId: "B", productName: "자두 2kg" }),
    order({ productOrderId: "C", recipientName: "김다른" }),
  ]);

  assert.equal(reviewed[0].issues.some((issue) => issue.code === "combined_shipping_candidate"), true);
  assert.equal(reviewed[0].issues.some((issue) => issue.code === "recipient_identity_conflict"), true);
  assert.equal(reviewed[2].issues.some((issue) => issue.code === "recipient_identity_conflict"), true);
});

test("미처리 경고와 차단 오류가 있으면 내보내기를 막고 확인·제외 후 허용한다", () => {
  const reviewed = reviewPreDispatchOrders([
    order({ productOrderId: "READY", deliveryMessage: "" }),
    order({ productOrderId: "WARN", recipientName: "김경고", phone1: "12345", address: "가상시 예시구 테스트로 300", deliveryMessage: "" }),
    order({ productOrderId: "BLOCK", address: "", deliveryMessage: "" }),
  ]);
  const initial = summarizePreDispatchReview(reviewed, {});
  assert.deepEqual(initial, { ready: 1, warning: 1, blocking: 1, excluded: 0, canExport: false });

  const decisions: Record<string, ReviewDecision> = { WARN: "confirmed", BLOCK: "excluded" };
  const resolved = summarizePreDispatchReview(reviewed, decisions);
  assert.deepEqual(resolved, { ready: 2, warning: 0, blocking: 0, excluded: 1, canExport: true });
  assert.deepEqual(dispatchableOrders(reviewed, decisions).map((item) => item.productOrderId), ["READY", "WARN"]);
});

test("차단 오류는 확인 완료 결정만으로 내보낼 수 없다", () => {
  const reviewed = reviewPreDispatchOrders([order({ productOrderId: "BLOCK", address: "", deliveryMessage: "" })]);
  const decisions: Record<string, ReviewDecision> = { BLOCK: "confirmed" };

  assert.equal(summarizePreDispatchReview(reviewed, decisions).canExport, false);
  assert.deepEqual(dispatchableOrders(reviewed, decisions), []);
  assert.equal(preDispatchItemState(reviewed[0], "confirmed"), "blocking");
});

test("배송정보가 바뀌면 검수 원본 지문이 바뀐다", () => {
  const before = reviewFingerprint([order()]);
  const sameContent = reviewFingerprint([order()]);
  const changed = reviewFingerprint([order({ address: "부산광역시 해운대구 1" })]);

  assert.equal(before, sameContent);
  assert.notEqual(before, changed);
});
