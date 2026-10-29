import assert from "node:assert/strict";
import test from "node:test";
import { CHANNEL_CAPABILITIES, DASHBOARD_FEATURES } from "../app/lib/dashboard.ts";

test("dashboard exposes every primary Damda AI workflow as a separate route", () => {
  // Catches the root page hiding a requested workflow or linking back to the old monolithic screen.
  assert.deepEqual(
    DASHBOARD_FEATURES.map(({ title, href }) => [title, href]),
    [
      ["상품등록", "/products"],
      ["주문 수집", "/orders"],
      ["재고 관리", "/inventory"],
      ["채널 엑셀 변환", "/product-converter"],
      ["송장 자동변환", "/invoice-converter"],
      ["가락시장 시세", "/market-prices"],
      ["마진 계산기", "/margin-calculator"],
      ["매입단가 확인", "/price-watcher"],
      ["API 연결 확인", "/connections"],
    ],
  );
});

test("connection details distinguish authentication from implemented channel features", () => {
  // Catches a green authentication badge incorrectly implying that orders, stock, and invoices are connected.
  assert.deepEqual(CHANNEL_CAPABILITIES, {
    naver: { auth: "live", product: "implemented", order: "implemented", inventory: "implemented", invoice: "implemented" },
    cafe24: { auth: "live", product: "implemented", order: "not_implemented", inventory: "not_implemented", invoice: "not_implemented" },
    coupang: { auth: "live", product: "partial", order: "implemented", inventory: "not_implemented", invoice: "not_implemented" },
  });
});
