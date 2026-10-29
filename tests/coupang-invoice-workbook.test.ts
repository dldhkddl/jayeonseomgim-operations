import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import {
  buildCoupangDispatchWorkbook,
  coupangSupplierInvoiceRows,
  parseCoupangOrderWorkbook,
  parseCoupangSupplierRows,
} from "../app/lib/invoice/coupang-workbook.ts";
import { groupSupplierRowsByTracking, matchShipments } from "../app/lib/invoice/matcher.ts";

const HEADERS = [
  "번호", "묶음배송번호", "주문번호", "택배사", "운송장번호", "분리배송 Y/N",
  "분리배송 출고예정일", "주문시 출고예정일", "출고일(발송일)", "주문일",
  "등록상품명", "등록옵션명", "노출상품명(옵션명)", "노출상품ID", "옵션ID",
  "최초등록등록상품명/옵션명", "업체상품코드", "바코드", "결제액", "배송비구분",
  "배송비", "도서산간 추가배송비", "구매수(수량)", "옵션판매가(판매단가)",
  "구매자", "구매자전화번호", "수취인이름", "수취인전화번호", "우편번호",
  "수취인 주소", "배송메세지", "상품별 추가메시지", "주문자 추가메시지",
  "배송완료일", "구매확정일자", "개인통관번호(PCCC)", "통관용수취인전화번호",
  "기타", "결제위치", "배송유형", "쿠팡 원 딜리버리",
];

function coupangRow(overrides: Record<number, string | number> = {}): Array<string | number> {
  const row: Array<string | number> = Array.from({ length: HEADERS.length }, () => "");
  const values: Record<number, string | number> = {
    0: 1,
    1: "700000000000001",
    2: "30000000000001",
    3: "",
    4: "",
    10: "말랑이 복숭아 4kg",
    12: "말랑이 복숭아 4kg, 1박스",
    22: 1,
    24: "김구매",
    25: "0504-1111-2222",
    26: "김수취",
    27: "0504-3333-4444",
    28: "12345",
    29: "서울특별시 중구 1 101호",
    30: "문 앞",
    38: "PC",
    39: "판매자 배송",
  };
  for (const [index, value] of Object.entries({ ...values, ...overrides })) row[Number(index)] = value;
  return row;
}

function workbookBytes(rows: Array<Array<string | number>>, sheetName = "Delivery"): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("쿠팡 실제 열 구조에서 주문 식별자와 배송정보를 행별로 읽는다", () => {
  const parsed = parseCoupangOrderWorkbook(workbookBytes([
    HEADERS,
    coupangRow(),
    coupangRow({ 0: 2, 1: "700000000000002", 2: "30000000000002", 26: "박수취", 27: "0504-9999-0000", 29: "부산광역시 중구 2" }),
  ]));

  assert.equal(parsed.sheet.sheetName, "Delivery");
  assert.equal(parsed.orders.length, 2);
  assert.deepEqual(parsed.orders.map((order) => ({
    productOrderId: order.productOrderId,
    sourceOrderKey: order.sourceOrderKey,
    sellerId: order.sellerId,
    buyerId: order.buyerId,
    recipientName: order.recipientName,
  })), [
    { productOrderId: "1:700000000000001", sourceOrderKey: "쿠팡:700000000000001:30000000000001:1", sellerId: "700000000000001", buyerId: "30000000000001", recipientName: "김수취" },
    { productOrderId: "2:700000000000002", sourceOrderKey: "쿠팡:700000000000002:30000000000002:2", sellerId: "700000000000002", buyerId: "30000000000002", recipientName: "박수취" },
  ]);
});

test("쿠팡 공급처 기본양식에 원본행키와 주문번호를 함께 기록한다", () => {
  const { orders } = parseCoupangOrderWorkbook(workbookBytes([HEADERS, coupangRow()]));
  const rows = coupangSupplierInvoiceRows(orders);

  assert.deepEqual(rows[0].slice(-3), ["쿠팡원본행키", "쿠팡묶음배송번호", "쿠팡주문번호"]);
  assert.deepEqual(rows[1].slice(-3), ["쿠팡:700000000000001:30000000000001:1", "700000000000001", "30000000000001"]);
});

test("원본행키와 수취정보가 충돌하면 다른 주문 송장을 자동 연결하지 않는다", () => {
  const { orders } = parseCoupangOrderWorkbook(workbookBytes([
    HEADERS,
    coupangRow(),
    coupangRow({ 0: 2, 1: "700000000000002", 2: "30000000000002", 26: "박수취", 27: "0504-9999-0000", 29: "부산광역시 중구 2" }),
  ]));
  const supplierBytes = workbookBytes([
    ["로젠택배송장번호", "상품명", "수량", "수취인명", "수취인연락처", "통합배송지", "쿠팡원본행키", "쿠팡묶음배송번호", "쿠팡주문번호"],
    ["44911112222", "말랑이 복숭아 4kg", 1, "박수취", "0504-9999-0000", "부산광역시 중구 2", orders[0].sourceOrderKey, orders[0].sellerId, orders[0].buyerId],
  ]);
  const supplierRows = parseCoupangSupplierRows(supplierBytes);
  const matches = matchShipments(orders, groupSupplierRowsByTracking(supplierRows));

  assert.equal(matches[0].status, "review_required");
  assert.deepEqual(matches[0].orders, []);
});

test("오늘 받은 로젠 공급처 양식을 읽고 구매자 전화번호로 정확한 주문만 연결한다", () => {
  const { orders } = parseCoupangOrderWorkbook(workbookBytes([
    HEADERS,
    coupangRow(),
    coupangRow({ 0: 2, 1: "700000000000002", 2: "30000000000002", 24: "박구매", 25: "0504-9999-0000", 26: "박수취", 27: "0504-8888-0000", 29: "부산광역시 중구 2" }),
  ]));
  const legacySupplier = workbookBytes([
    ["로젠택배", "등록상품명", "수량", "구매자", "수취인이름", "구매자전화번호", "수취인 주소", "배송메세지"],
    ["44900001111", "말랑이 복숭아 4kg", 1, "박구매", "박수취", "0504-9999-0000", "부산광역시 중구 2", "문 앞"],
  ]);

  const supplierRows = parseCoupangSupplierRows(legacySupplier);
  const matches = matchShipments(orders, groupSupplierRowsByTracking(supplierRows));

  assert.equal(supplierRows.length, 1);
  assert.equal(matches[0].status, "auto_matched");
  assert.equal(matches[0].orders[0].sellerId, "700000000000002");
});

test("주문키 없는 로젠 공급처 양식에서 필수 대조값이 비면 자동 연결하지 않는다", () => {
  const { orders } = parseCoupangOrderWorkbook(workbookBytes([HEADERS, coupangRow()]));
  const legacySupplier = workbookBytes([
    ["로젠택배", "등록상품명", "수량", "구매자", "수취인이름", "구매자전화번호", "수취인 주소", "배송메세지"],
    ["44900001111", "말랑이 복숭아 4kg", 1, "김구매", "김수취", "", "서울특별시 중구 1 101호", "문 앞"],
  ]);

  const matches = matchShipments(orders, groupSupplierRowsByTracking(parseCoupangSupplierRows(legacySupplier)));
  assert.equal(matches[0].status, "review_required");
  assert.deepEqual(matches[0].orders, []);
});

test("쿠팡 발송처리 파일은 선택된 원본 행의 택배사와 운송장번호만 바꾼다", () => {
  const input = workbookBytes([
    HEADERS,
    coupangRow(),
    coupangRow({ 0: 2, 1: "700000000000002", 2: "30000000000002", 26: "박수취" }),
  ]);
  const { sheet } = parseCoupangOrderWorkbook(input);
  const output = buildCoupangDispatchWorkbook(sheet, new Map([
    ["1:700000000000001", { carrier: "로젠택배", trackingNumber: "44911112222" }],
  ]));
  const original = XLSX.read(input, { type: "array", raw: true });
  const written = output;
  const originalRows = XLSX.utils.sheet_to_json<unknown[]>(original.Sheets.Delivery, { header: 1, raw: true, defval: "" });
  const writtenRows = XLSX.utils.sheet_to_json<unknown[]>(written.Sheets.Delivery, { header: 1, raw: true, defval: "" });

  assert.equal(writtenRows[1][3], "로젠택배");
  assert.equal(writtenRows[1][4], "44911112222");
  assert.deepEqual(writtenRows[1].filter((_, index) => index !== 3 && index !== 4), originalRows[1].filter((_, index) => index !== 3 && index !== 4));
  assert.deepEqual(writtenRows[2], originalRows[2]);
});

test("쿠팡 원본에서 중복된 주문 행 식별자를 거부한다", () => {
  const duplicate = coupangRow();
  assert.throws(
    () => parseCoupangOrderWorkbook(workbookBytes([HEADERS, coupangRow(), duplicate])),
    /중복된 쿠팡 주문 식별자/,
  );
});
