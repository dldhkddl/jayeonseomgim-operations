import assert from "node:assert/strict";
import test from "node:test";

import { coupangInvoiceWorkflowState, invoiceWorkflowState } from "../app/lib/invoice/workflow.ts";

test("keeps the supplier area waiting for a real supplier workbook", () => {
  assert.deepEqual(invoiceWorkflowState(false, false), {
    canCreateSupplierInvoice: false,
    canMatch: false,
    supplierStatus: "기본양식 대기 · 공급처 송장을 올리면 대조할 수 있습니다.",
  });
  assert.deepEqual(invoiceWorkflowState(true, false), {
    canCreateSupplierInvoice: true,
    canMatch: false,
    supplierStatus: "기본양식 대기 · 공급처 송장을 올리면 대조할 수 있습니다.",
  });
});

test("enables matching only after both workbooks are selected", () => {
  assert.deepEqual(invoiceWorkflowState(true, true), {
    canCreateSupplierInvoice: true,
    canMatch: true,
    supplierStatus: "공급처 송장 선택됨 · 자동 대조할 수 있습니다.",
  });
});

test("쿠팡 주문은 검수가 끝나기 전 공급처 파일을 만들 수 없다", () => {
  assert.deepEqual(coupangInvoiceWorkflowState({
    hasOrderFile: true,
    reviewComplete: false,
    hasSupplierFile: false,
    readyMatches: 0,
    pendingMatches: 0,
  }), {
    canReview: true,
    canCreateSupplierInvoice: false,
    canMatch: false,
    canCreateCoupangDispatch: false,
  });
});

test("쿠팡 발송처리는 검수 완료와 공급처 파일이 모두 있어야 대조할 수 있다", () => {
  assert.deepEqual(coupangInvoiceWorkflowState({
    hasOrderFile: true,
    reviewComplete: true,
    hasSupplierFile: true,
    readyMatches: 1,
    pendingMatches: 0,
  }), {
    canReview: true,
    canCreateSupplierInvoice: true,
    canMatch: true,
    canCreateCoupangDispatch: true,
  });
});

test("확인 필요 송장이 남으면 쿠팡 발송처리 파일 생성을 막는다", () => {
  assert.equal(coupangInvoiceWorkflowState({
    hasOrderFile: true,
    reviewComplete: true,
    hasSupplierFile: true,
    readyMatches: 1,
    pendingMatches: 1,
  }).canCreateCoupangDispatch, false);
});
