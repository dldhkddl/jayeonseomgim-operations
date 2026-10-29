import * as XLSX from "xlsx";

import { normalizeIdentifier } from "./normalize.ts";
import type { DispatchRow, NaverOrder, SupplierRow } from "./types.ts";

type CellValue = string | number | boolean | Date | null | undefined;
type RecordRow = Record<string, CellValue>;

const aliases = {
  productOrderId: ["상품주문번호", "상품 주문 번호"],
  productName: ["상품명", "품목명", "주문상품명"],
  quantity: ["수량", "주문수량", "상품수량"],
  buyerName: ["구매자명", "구매자", "주문자명"],
  recipientName: ["수취인명", "수취인", "받는분", "받는사람"],
  address: ["통합배송지", "배송지", "주소", "수취인주소"],
  phone1: ["수취인연락처1", "수취인 연락처1", "연락처1", "전화번호"],
  phone2: ["수취인연락처2", "수취인 연락처2", "연락처2"],
  deliveryMessage: ["배송메시지", "배송메세지", "배송 요청사항", "배송요청사항"],
  buyerPhone: ["구매자연락처", "구매자 연락처", "주문자연락처", "주문자 연락처"],
  sellerId: ["판매자ID", "판매자아이디", "판매자 ID"],
  buyerId: ["구매자ID", "구매자아이디", "구매자 ID"],
  status: ["상품주문상태", "주문상태", "상태"],
  trackingNumber: ["송장번호", "운송장번호", "송장 번호", "운송장 번호", "로젠택배"],
  carrier: ["택배사", "택배사명", "배송업체"],
  phone: ["전화번호", "연락처", "수취인연락처", "수취인 연락처", "휴대전화", "휴대폰번호"],
} as const;

export const sample_store_ORIGIN_ADDRESS = "가상시 예시구 테스트로 300";

const SUPPLIER_INVOICE_HEADERS = [
  "로젠택배송장번호",
  "상품명",
  "수량",
  "구매자명",
  "수취인명",
  "수취인연락처",
  "통합배송지",
  "배송메세지",
  "출고지",
  "구매자연락처",
] as const;

function cleanHeader(value: unknown): string {
  return String(value ?? "").replace(/[\s\r\n]+/g, "").trim();
}

function headerMatches(value: unknown, names: readonly string[]): boolean {
  const header = cleanHeader(value);
  const targets = names.map(cleanHeader);
  if (targets.includes(header)) return true;
  const isTrackingHeader = targets.includes("송장번호") || targets.includes("운송장번호");
  return isTrackingHeader && /(?:운송장|송장)번호$/.test(header);
}

function headerFor(row: RecordRow, names: readonly string[]): string | undefined {
  return Object.keys(row).find((header) => headerMatches(header, names));
}

function valueFor(row: RecordRow, names: readonly string[]): CellValue {
  const header = headerFor(row, names);
  return header ? row[header] : undefined;
}

function readRows(input: ArrayBuffer | Uint8Array, headerAliases: readonly string[]): RecordRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(input, { type: "array", raw: true, cellText: false });
  } catch {
    throw new Error("엑셀 파일을 읽지 못했습니다. XLS 또는 XLSX 파일인지 확인해 주세요.");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("엑셀에 읽을 수 있는 시트가 없습니다.");
  const matrix = XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, raw: true, defval: "" });
  const headerIndex = matrix.findIndex((row) => row.some((cell) => headerMatches(cell, headerAliases)));
  if (headerIndex < 0) throw new Error("엑셀에 데이터가 없습니다.");
  const headers = matrix[headerIndex].map((cell) => String(cell ?? "").trim());
  return matrix.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function requireHeader(rows: RecordRow[], names: readonly string[], label: string): void {
  if (!rows.length || !headerFor(rows[0], names)) throw new Error(`엑셀에서 '${label}' 열을 찾지 못했습니다.`);
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function quantity(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function inferCarrierFromTrackingHeader(row: RecordRow): string {
  const header = cleanHeader(headerFor(row, aliases.trackingNumber));
  if (/로젠/.test(header)) return "로젠택배";
  if (/CJ|대한통운/i.test(header)) return "CJ대한통운";
  if (/롯데|현대/.test(header)) return "롯데택배";
  if (/한진/.test(header)) return "한진택배";
  if (/우체국/.test(header)) return "우체국택배";
  return "";
}

export function parseNaverOrders(input: ArrayBuffer | Uint8Array): NaverOrder[] {
  const rows = readRows(input, aliases.productOrderId);
  requireHeader(rows, aliases.productOrderId, "상품주문번호");
  requireHeader(rows, aliases.productName, "상품명");
  requireHeader(rows, aliases.status, "상품주문상태");
  return rows.map((row) => ({
    productOrderId: normalizeIdentifier(valueFor(row, aliases.productOrderId)),
    productName: text(valueFor(row, aliases.productName)),
    quantity: quantity(valueFor(row, aliases.quantity)),
    buyerName: text(valueFor(row, aliases.buyerName)),
    recipientName: text(valueFor(row, aliases.recipientName)),
    address: text(valueFor(row, aliases.address)),
    phone1: text(valueFor(row, aliases.phone1)),
    phone2: text(valueFor(row, aliases.phone2)),
    deliveryMessage: text(valueFor(row, aliases.deliveryMessage)),
    buyerPhone: text(valueFor(row, aliases.buyerPhone)),
    sellerId: text(valueFor(row, aliases.sellerId)),
    buyerId: text(valueFor(row, aliases.buyerId)),
    status: text(valueFor(row, aliases.status)),
  })).filter((order) => order.productOrderId);
}

export function supplierInvoiceRows(orders: NaverOrder[]): Array<Array<string | number>> {
  return [
    [...SUPPLIER_INVOICE_HEADERS],
    ...orders.map((order) => [
      "",
      order.productName,
      order.quantity,
      order.buyerName,
      order.recipientName,
      order.phone1 || order.phone2,
      order.address,
      order.deliveryMessage,
      sample_store_ORIGIN_ADDRESS,
      order.buyerPhone,
    ]),
  ];
}

export function supplierInvoiceFilename(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `샘플상점${values.year}.${values.month}.${values.day}.xlsx`;
}

export async function writeSupplierInvoiceWorkbook(orders: NaverOrder[]): Promise<Uint8Array> {
  const xlsxPopulateModule = await import("xlsx-populate/browser/xlsx-populate.js");
  const workbook = await xlsxPopulateModule.default.fromBlankAsync();
  const sheet = workbook.sheet(0).name("Sheet1");
  const rows = supplierInvoiceRows(orders);
  const lastRow = rows.length;
  const thinBorder = {
    top: "thin",
    bottom: "thin",
    left: "thin",
    right: "thin",
  };

  sheet.range(`A1:J${lastRow}`).value(rows);
  sheet.range("A1:A1").style({
    fill: "FFF200",
    bold: true,
    horizontalAlignment: "center",
    verticalAlignment: "center",
    border: thinBorder,
  });
  sheet.range("B1:J1").style({
    fill: "C9C9F6",
    bold: true,
    horizontalAlignment: "center",
    verticalAlignment: "center",
    border: thinBorder,
  });
  if (lastRow >= 2) {
    sheet.range(`A2:A${lastRow}`).style({ fill: "FFF200", numberFormat: "@", border: thinBorder });
    sheet.range(`B2:J${lastRow}`).style({ border: thinBorder, verticalAlignment: "center" });
    sheet.range(`F2:F${lastRow}`).style({ numberFormat: "@" });
    sheet.range(`J2:J${lastRow}`).style({ numberFormat: "@" });
  }

  sheet.row(1).height(28);
  const widths: Record<string, number> = {
    A: 22,
    B: 52,
    C: 9,
    D: 15,
    E: 15,
    F: 20,
    G: 58,
    H: 26,
    I: 52,
    J: 20,
  };
  for (const [column, width] of Object.entries(widths)) sheet.column(column).width(width);
  sheet.freezePanes(1, 0);

  return workbook.outputAsync({ type: "uint8array" });
}

export function parseSupplierRows(input: ArrayBuffer | Uint8Array): SupplierRow[] {
  const rows = readRows(input, aliases.trackingNumber);
  requireHeader(rows, aliases.trackingNumber, "송장번호");
  requireHeader(rows, aliases.productName, "상품명 또는 품목명");
  return rows.map((row) => ({
    trackingNumber: normalizeIdentifier(valueFor(row, aliases.trackingNumber)).replace(/[\s-]/g, ""),
    carrier: text(valueFor(row, aliases.carrier)) || inferCarrierFromTrackingHeader(row),
    productName: text(valueFor(row, aliases.productName)),
    quantity: quantity(valueFor(row, aliases.quantity)),
    recipientName: text(valueFor(row, aliases.recipientName)),
    phone: text(valueFor(row, aliases.phone)),
    address: text(valueFor(row, aliases.address)),
  })).filter((row) => row.trackingNumber);
}

export function buildDispatchWorkbook(rows: DispatchRow[]): XLSX.WorkBook {
  const data = [
    ["상품주문번호", "배송방법", "택배사", "송장번호"],
    ...rows.map((row) => [row.productOrderId, row.deliveryMethod, row.carrier, row.trackingNumber]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  for (let row = 2; row <= data.length; row += 1) {
    for (const column of ["A", "D"]) {
      const cell = sheet[`${column}${row}`];
      if (cell) {
        cell.t = "s";
        cell.v = String(cell.v);
        cell.z = "@";
      }
    }
  }
  sheet["!cols"] = [
    { wch: 25.07 },
    { wch: 31.64 },
    { wch: 29.79 },
    { wch: 29.5 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "발송처리");
  return workbook;
}

export function writeDispatchWorkbook(rows: DispatchRow[]): ArrayBuffer {
  return XLSX.write(buildDispatchWorkbook(rows), { type: "array", bookType: "xls" });
}
