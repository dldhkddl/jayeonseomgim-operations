import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import XlsxPopulate from "xlsx-populate";

import { decryptOfficeWorkbook } from "../app/lib/invoice/decrypt.ts";
import { buildDispatchWorkbook, parseNaverOrders, parseSupplierRows, sample_store_ORIGIN_ADDRESS, supplierInvoiceFilename, supplierInvoiceRows, writeDispatchWorkbook, writeSupplierInvoiceWorkbook } from "../app/lib/invoice/workbook.ts";
import type { NaverOrder } from "../app/lib/invoice/types.ts";

function workbookBytes(rows: unknown[][], sheetName = "Sheet1"): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("parses Naver and supplier workbooks using Korean header aliases", () => {
  const orders = parseNaverOrders(workbookBytes([
    ["상품주문번호", "상품명", "수량", "구매자명", "수취인명", "배송지", "수취인연락처1", "수취인연락처2", "배송메시지", "구매자연락처", "판매자ID", "구매자ID", "상품주문상태"],
    ["202608121234567890", "복숭아 4.5kg", 1, "김구매", "홍길동", "서울 강남구 1", "010-0000-2668", "010-0000-8125", "문 앞", "010-0000-4657", "seller", "buyer", "배송준비"],
  ]));
  const supplier = parseSupplierRows(workbookBytes([
    ["운송장번호", "택배사", "품목명", "수량", "받는분", "전화번호", "주소"],
    ["123456789012345678", "CJ대한통운", "복숭아 4.5kg", 1, "홍길동", "01000002668", "서울 강남구 1"],
  ]));
  assert.equal(orders[0].productOrderId, "202608121234567890");
  assert.equal(orders[0].buyerName, "김구매");
  assert.equal(orders[0].deliveryMessage, "문 앞");
  assert.equal(orders[0].buyerPhone, "010-0000-4657");
  assert.equal(supplier[0].trackingNumber, "123456789012345678");
});

test("maps Naver orders into the sample_store supplier columns with blank tracking numbers", () => {
  const rows = supplierInvoiceRows([order({
    productName: "복숭아 4kg",
    quantity: 2,
    buyerName: "구매자",
    recipientName: "수취인",
    phone1: "010-0000-2668",
    address: "서울 강남구 1",
    deliveryMessage: "문 앞",
    buyerPhone: "010-0000-4657",
  })]);

  assert.deepEqual(rows, [
    ["로젠택배송장번호", "상품명", "수량", "구매자명", "수취인명", "수취인연락처", "통합배송지", "배송메세지", "출고지", "구매자연락처"],
    ["", "복숭아 4kg", 2, "구매자", "수취인", "010-0000-2668", "서울 강남구 1", "문 앞", sample_store_ORIGIN_ADDRESS, "010-0000-4657"],
  ]);
});

test("keeps optional supplier values blank and falls back to the second recipient phone", () => {
  const rows = supplierInvoiceRows([order({ phone1: "", phone2: "010-0000-8125", buyerName: "", buyerPhone: "", deliveryMessage: "" })]);

  assert.equal(rows[1][0], "");
  assert.equal(rows[1][3], "");
  assert.equal(rows[1][5], "010-0000-8125");
  assert.equal(rows[1][7], "");
  assert.equal(rows[1][9], "");
});

test("uses the Korean calendar date in the supplier filename", () => {
  assert.equal(supplierInvoiceFilename(new Date("2026-08-12T15:30:00Z")), "샘플상점2026.08.13.xlsx");
});

test("creates a reusable supplier workbook with blank tracking cells", async () => {
  const bytes = await writeSupplierInvoiceWorkbook([order({
    productName: "복숭아 4kg",
    quantity: 2,
    buyerName: "구매자",
    recipientName: "수취인",
    phone1: "010-0000-2668",
    address: "서울 강남구 1",
    deliveryMessage: "문 앞",
    buyerPhone: "010-0000-4657",
  })]);
  const workbook = XLSX.read(bytes, { type: "array", raw: true });
  const sheet = workbook.Sheets["Sheet1"];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });

  assert.deepEqual(rows[0], ["로젠택배송장번호", "상품명", "수량", "구매자명", "수취인명", "수취인연락처", "통합배송지", "배송메세지", "출고지", "구매자연락처"]);
  assert.deepEqual(rows[1], ["", "복숭아 4kg", 2, "구매자", "수취인", "010-0000-2668", "서울 강남구 1", "문 앞", sample_store_ORIGIN_ADDRESS, "010-0000-4657"]);

  sheet.A2 = { t: "s", v: "449-4217-7232" };
  const completed = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  assert.equal(parseSupplierRows(completed)[0].trackingNumber, "44942177232");
});

test("finds the real header row below spreadsheet title lines", () => {
  const orders = parseNaverOrders(workbookBytes([
    ["스마트스토어 주문 내역"],
    ["다운로드 일시", "2026-08-12"],
    ["상품주문번호", "상품명", "수량", "상품주문상태"],
    ["202608121234567890", "복숭아", 1, "배송준비"],
  ]));
  assert.equal(orders[0].productOrderId, "202608121234567890");
});

test("requires order status so already dispatched orders cannot be sent twice", () => {
  assert.throws(() => parseNaverOrders(workbookBytes([
    ["상품주문번호", "상품명", "수량"],
    ["202608121234567890", "복숭아", 1],
  ])), /상품주문상태/);
});

test("creates Naver's exact dispatch sheet with text identifiers", () => {
  const output = buildDispatchWorkbook([{ productOrderId: "202608121234567890", deliveryMethod: "택배,등기,소포", carrier: "CJ대한통운", trackingNumber: "123456789012345678" }]);
  assert.deepEqual(output.SheetNames, ["발송처리"]);
  const sheet = output.Sheets["발송처리"];
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }), [
    ["상품주문번호", "배송방법", "택배사", "송장번호"],
    ["202608121234567890", "택배,등기,소포", "CJ대한통운", "123456789012345678"],
  ]);
  assert.equal(sheet.A2.t, "s");
  assert.equal(sheet.D2.t, "s");
  assert.equal(sheet.A2.z, "@");
});

test("writes Naver's dispatch upload as a native xls workbook", () => {
  const bytes = new Uint8Array(writeDispatchWorkbook([{
    productOrderId: "202608121234567890",
    deliveryMethod: "택배,등기,소포",
    carrier: "로젠택배",
    trackingNumber: "44963281650",
  }]));

  assert.deepEqual([...bytes.slice(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

  const workbook = XLSX.read(bytes, { type: "array", raw: true });
  assert.deepEqual(workbook.SheetNames, ["발송처리"]);
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets["발송처리"], { header: 1, raw: true }), [
    ["상품주문번호", "배송방법", "택배사", "송장번호"],
    ["202608121234567890", "택배,등기,소포", "로젠택배", "44963281650"],
  ]);
  assert.equal(workbook.Sheets["발송처리"].A2.t, "s");
  assert.equal(workbook.Sheets["발송처리"].D2.t, "s");
});

test("decrypts a password-protected XLSX before parsing", async () => {
  const plain = workbookBytes([["상품주문번호"], ["202608121234567890"]]);
  const workbook = await XlsxPopulate.fromDataAsync(plain);
  const encrypted = await workbook.outputAsync({ type: "nodebuffer", password: "fruit123" });
  const decrypted = await decryptOfficeWorkbook(encrypted, "fruit123");
  const parsed = XLSX.read(decrypted, { type: "array" });
  assert.equal(parsed.Sheets[parsed.SheetNames[0]].A2.v, "202608121234567890");
});

test("returns a Korean error for a wrong workbook password", async () => {
  const workbook = await XlsxPopulate.fromDataAsync(workbookBytes([["테스트"]]));
  const encrypted = await workbook.outputAsync({ type: "nodebuffer", password: "right" });
  await assert.rejects(() => decryptOfficeWorkbook(encrypted, "wrong"), /비밀번호/);
});

test("does not mistake ordinary XLS cell text for an encryption marker", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["EncryptionInfo", "운송장번호"],
    ["일반 공급처 파일", "1234567890"],
  ]), "Sheet1");
  const plainXls = XLSX.write(workbook, { type: "buffer", bookType: "xls" });

  const result = await decryptOfficeWorkbook(plainXls, "");

  assert.deepEqual([...result], [...plainXls]);
});

test("names the workbook that actually needs a password", async () => {
  const workbook = await XlsxPopulate.fromDataAsync(workbookBytes([["테스트"]]));
  const encrypted = await workbook.outputAsync({ type: "nodebuffer", password: "right" });

  await assert.rejects(
    () => decryptOfficeWorkbook(encrypted, "", "공급처 송장 엑셀"),
    /공급처 송장 엑셀.*비밀번호/,
  );
});

test("parses a carrier-prefixed tracking header used by the real supplier workbook", () => {
  const rows = parseSupplierRows(workbookBytes([
    ["로젠택배송장번호", "상품명", "수량", "수취인명", "수취인연락처", "통합배송지"],
    ["449-4217-7232", "산지 직송 말랑이 복숭아 4kg", 1, "홍길동", "010-1234-5678", "서울특별시 강남구 1"],
  ], "Sheet1"));

  assert.deepEqual(rows, [{
    trackingNumber: "44942177232",
    carrier: "로젠택배",
    productName: "산지 직송 말랑이 복숭아 4kg",
    quantity: 1,
    recipientName: "홍길동",
    phone: "010-1234-5678",
    address: "서울특별시 강남구 1",
  }]);
});

test("parses a carrier-only Rosen header as the tracking number column", () => {
  const rows = parseSupplierRows(workbookBytes([
    ["로젠택배", "상품명", "수량", "수취인명", "수취인연락처", "통합배송지"],
    ["449-6328-1650", "복숭아 4kg", 1, "홍길동", "010-1234-5678", "서울특별시 강남구 1"],
  ]));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].trackingNumber, "44963281650");
  assert.equal(rows[0].carrier, "로젠택배");
});

function order(overrides: Partial<NaverOrder> = {}): NaverOrder {
  return {
    productOrderId: "202608121234567890",
    productName: "복숭아",
    quantity: 1,
    buyerName: "",
    recipientName: "홍길동",
    address: "서울 강남구 1",
    phone1: "010-0000-2668",
    phone2: "",
    deliveryMessage: "",
    buyerPhone: "",
    sellerId: "seller",
    buyerId: "buyer",
    status: "배송준비",
    ...overrides,
  };
}
