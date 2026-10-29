import * as XLSX from "xlsx";

import { normalizeIdentifier } from "./normalize.ts";
import { sample_store_ORIGIN_ADDRESS } from "./workbook.ts";
import type { NaverOrder, SupplierRow } from "./types.ts";

const HEADER_ALIASES = {
  sequence: ["번호"],
  bundleId: ["묶음배송번호"],
  orderId: ["주문번호"],
  carrier: ["택배사"],
  trackingNumber: ["운송장번호"],
  productName: ["노출상품명(옵션명)", "등록상품명"],
  quantity: ["구매수(수량)"],
  buyerName: ["구매자"],
  buyerPhone: ["구매자전화번호"],
  recipientName: ["수취인이름"],
  recipientPhone: ["수취인전화번호"],
  address: ["수취인 주소"],
  deliveryMessage: ["배송메세지", "배송메시지"],
} as const;

const COUPANG_SUPPLIER_HEADERS = [
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
  "쿠팡원본행키",
  "쿠팡묶음배송번호",
  "쿠팡주문번호",
] as const;

type ColumnKey = keyof typeof HEADER_ALIASES;

export type CoupangOrder = NaverOrder & { sourceOrderKey: string };

export type CoupangDispatchSheet = {
  sourceBytes: Uint8Array;
  sheetName: string;
  headerRowIndex: number;
  columnIndex: Record<ColumnKey, number>;
  rowIndexByProductOrderId: Record<string, number>;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function cleanHeader(value: unknown): string {
  return clean(value).replace(/\s+/g, "");
}

function findColumn(headerRow: unknown[], names: readonly string[]): number {
  const targets = names.map(cleanHeader);
  return headerRow.findIndex((cell) => targets.includes(cleanHeader(cell)));
}

function quantity(value: unknown): number {
  const parsed = Number(clean(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function bytesOf(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input.slice(0));
}

export function parseCoupangOrderWorkbook(input: ArrayBuffer | Uint8Array): { sheet: CoupangDispatchSheet; orders: CoupangOrder[] } {
  const sourceBytes = bytesOf(input);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(sourceBytes, { type: "array", raw: true, cellText: false, cellStyles: true });
  } catch {
    throw new Error("쿠팡 주문 엑셀을 읽지 못했습니다. XLS 또는 XLSX 파일인지 확인해 주세요.");
  }
  const sheetName = workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!worksheet) throw new Error("쿠팡 주문 엑셀에 읽을 수 있는 시트가 없습니다.");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false, defval: "" });
  const headerRowIndex = rows.findIndex((row) => findColumn(row, HEADER_ALIASES.bundleId) >= 0 && findColumn(row, HEADER_ALIASES.orderId) >= 0);
  if (headerRowIndex < 0) {
    throw new Error("쿠팡 주문 엑셀에서 '묶음배송번호'와 '주문번호' 열을 찾지 못했습니다.");
  }
  const headerRow = rows[headerRowIndex];
  const columnIndex = {} as Record<ColumnKey, number>;
  for (const key of Object.keys(HEADER_ALIASES) as ColumnKey[]) {
    const index = findColumn(headerRow, HEADER_ALIASES[key]);
    if (index < 0) throw new Error(`쿠팡 주문 엑셀에서 '${HEADER_ALIASES[key][0]}' 열을 찾지 못했습니다.`);
    columnIndex[key] = index;
  }

  const orders: CoupangOrder[] = [];
  const rowIndexByProductOrderId: Record<string, number> = {};
  const sourceKeys = new Set<string>();
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row.some((value) => clean(value))) continue;
    const bundleId = normalizeIdentifier(row[columnIndex.bundleId]);
    const orderId = normalizeIdentifier(row[columnIndex.orderId]);
    if (!bundleId || !orderId) continue;
    const sequence = normalizeIdentifier(row[columnIndex.sequence]) || String(rowIndex - headerRowIndex);
    const sourceOrderKey = `쿠팡:${bundleId}:${orderId}:${sequence}`;
    if (sourceKeys.has(sourceOrderKey)) throw new Error(`중복된 쿠팡 주문 식별자가 있습니다: ${bundleId} / ${orderId} / ${sequence}`);
    sourceKeys.add(sourceOrderKey);
    const productOrderId = `${sequence}:${bundleId}`;
    if (rowIndexByProductOrderId[productOrderId] !== undefined) throw new Error(`중복된 쿠팡 원본 행이 있습니다: ${productOrderId}`);
    rowIndexByProductOrderId[productOrderId] = rowIndex;
    orders.push({
      productOrderId,
      sourceOrderKey,
      productName: clean(row[columnIndex.productName]),
      quantity: quantity(row[columnIndex.quantity]),
      buyerName: clean(row[columnIndex.buyerName]),
      recipientName: clean(row[columnIndex.recipientName]),
      address: clean(row[columnIndex.address]),
      phone1: clean(row[columnIndex.recipientPhone]),
      phone2: "",
      deliveryMessage: clean(row[columnIndex.deliveryMessage]),
      buyerPhone: clean(row[columnIndex.buyerPhone]),
      sellerId: bundleId,
      buyerId: orderId,
      status: "배송준비",
    });
  }

  return {
    sheet: { sourceBytes, sheetName, headerRowIndex, columnIndex, rowIndexByProductOrderId },
    orders,
  };
}

/** 이전 이름을 사용하는 화면 코드와의 호환용 별칭. */
export const parseCoupangDispatchWorkbook = parseCoupangOrderWorkbook;

export function coupangSupplierInvoiceRows(orders: CoupangOrder[]): Array<Array<string | number>> {
  return [
    [...COUPANG_SUPPLIER_HEADERS],
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
      order.sourceOrderKey,
      order.sellerId,
      order.buyerId,
    ]),
  ];
}

function trackingColumn(header: unknown[]): number {
  return header.findIndex((value) => /(?:(?:운송장|송장)번호|로젠택배)$/.test(cleanHeader(value)));
}

function supplierColumn(header: unknown[], names: string[]): number {
  const targets = names.map(cleanHeader);
  return header.findIndex((value) => targets.includes(cleanHeader(value)));
}

export function parseCoupangSupplierRows(input: ArrayBuffer | Uint8Array): SupplierRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(input, { type: "array", raw: true, cellText: false });
  } catch {
    throw new Error("쿠팡 공급처 송장 엑셀을 읽지 못했습니다.");
  }
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) throw new Error("쿠팡 공급처 송장 엑셀에 읽을 수 있는 시트가 없습니다.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false, defval: "" });
  const headerRowIndex = rows.findIndex((row) => trackingColumn(row) >= 0);
  if (headerRowIndex < 0) throw new Error("쿠팡 공급처 송장에서 송장번호 열을 찾지 못했습니다.");
  const header = rows[headerRowIndex];
  const columns = {
    tracking: trackingColumn(header),
    carrier: supplierColumn(header, ["택배사", "택배사명"]),
    product: supplierColumn(header, ["상품명", "품목명", "등록상품명"]),
    quantity: supplierColumn(header, ["수량"]),
    recipient: supplierColumn(header, ["수취인명", "수취인", "받는분", "수취인이름"]),
    phone: supplierColumn(header, ["수취인연락처", "전화번호", "연락처", "구매자전화번호"]),
    address: supplierColumn(header, ["통합배송지", "배송지", "주소", "수취인 주소"]),
    sourceOrderKey: supplierColumn(header, ["쿠팡원본행키"]),
  };
  for (const [key, index] of Object.entries(columns)) {
    if (key !== "carrier" && key !== "sourceOrderKey" && index < 0) throw new Error(`쿠팡 공급처 송장에서 필요한 열을 찾지 못했습니다: ${key}`);
  }
  const phoneHeader = cleanHeader(header[columns.phone]);
  const phoneRole = phoneHeader === cleanHeader("구매자전화번호") ? "buyer" as const : "recipient" as const;
  const hasSourceOrderKey = columns.sourceOrderKey >= 0;
  return rows.slice(headerRowIndex + 1).map((row) => ({
    trackingNumber: normalizeIdentifier(row[columns.tracking]).replace(/[\s-]/g, ""),
    carrier: columns.carrier >= 0 ? clean(row[columns.carrier]) : "로젠택배",
    productName: clean(row[columns.product]),
    quantity: quantity(row[columns.quantity]),
    recipientName: clean(row[columns.recipient]),
    phone: clean(row[columns.phone]),
    address: clean(row[columns.address]),
    sourceOrderKey: hasSourceOrderKey ? clean(row[columns.sourceOrderKey]) : undefined,
    phoneRole,
    strictIdentity: !hasSourceOrderKey,
  })).filter((row) => row.trackingNumber && (hasSourceOrderKey ? row.sourceOrderKey : true));
}

export function buildCoupangDispatchWorkbook(sheet: CoupangDispatchSheet, filled: Map<string, { carrier: string; trackingNumber: string }>): XLSX.WorkBook {
  const workbook = XLSX.read(sheet.sourceBytes, { type: "array", raw: true, cellText: false, cellStyles: true });
  const worksheet = workbook.Sheets[sheet.sheetName];
  if (!worksheet) throw new Error("쿠팡 원본 시트를 다시 읽지 못했습니다.");
  for (const [productOrderId, values] of filled) {
    const rowIndex = sheet.rowIndexByProductOrderId[productOrderId];
    if (rowIndex === undefined) throw new Error(`쿠팡 원본에서 주문 행을 찾지 못했습니다: ${productOrderId}`);
    const carrierRef = XLSX.utils.encode_cell({ r: rowIndex, c: sheet.columnIndex.carrier });
    const trackingRef = XLSX.utils.encode_cell({ r: rowIndex, c: sheet.columnIndex.trackingNumber });
    worksheet[carrierRef] = { ...(worksheet[carrierRef] ?? {}), t: "s", v: values.carrier };
    worksheet[trackingRef] = { ...(worksheet[trackingRef] ?? {}), t: "s", v: normalizeIdentifier(values.trackingNumber), z: "@" };
  }
  return workbook;
}

export function writeCoupangDispatchWorkbook(sheet: CoupangDispatchSheet, filled: Map<string, { carrier: string; trackingNumber: string }>): ArrayBuffer {
  return XLSX.write(buildCoupangDispatchWorkbook(sheet, filled), { type: "array", bookType: "xlsx", cellStyles: true });
}

export async function writeCoupangSupplierInvoiceWorkbook(orders: CoupangOrder[]): Promise<Uint8Array> {
  const xlsxPopulateModule = await import("xlsx-populate/browser/xlsx-populate.js");
  const workbook = await xlsxPopulateModule.default.fromBlankAsync();
  const sheet = workbook.sheet(0).name("Sheet1");
  const rows = coupangSupplierInvoiceRows(orders);
  const lastRow = rows.length;
  const border = { top: "thin", bottom: "thin", left: "thin", right: "thin" };
  sheet.range(`A1:M${lastRow}`).value(rows).style({ border, verticalAlignment: "center" });
  sheet.range("A1:M1").style({ fill: "C9C9F6", bold: true, horizontalAlignment: "center" });
  sheet.range(`A1:A${lastRow}`).style({ fill: "FFF200", numberFormat: "@" });
  if (lastRow >= 2) sheet.range(`F2:M${lastRow}`).style({ numberFormat: "@" });
  const widths: Record<string, number> = { A: 22, B: 52, C: 9, D: 15, E: 15, F: 20, G: 58, H: 26, I: 52, J: 20, K: 48, L: 24, M: 24 };
  for (const [column, width] of Object.entries(widths)) sheet.column(column).width(width);
  sheet.row(1).height(28);
  sheet.freezePanes(1, 0);
  return workbook.outputAsync({ type: "uint8array" });
}
