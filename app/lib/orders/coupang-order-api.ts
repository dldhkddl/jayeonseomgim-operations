import { buildAuthorization, CoupangApiError, type CoupangCredentials } from "../coupang.ts";
import type { StoredOrderInput } from "./naver-order-api";

const HOST = "https://api-gateway.coupang.com";
export const COUPANG_ORDER_STATUSES = ["ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY", "NONE_TRACKING"] as const;

type Money = { currencyCode?: string; units?: number; nanos?: number } | null;
type Contact = { name?: string; safeNumber?: string; ordererNumber?: string | null };
type Receiver = { name?: string; safeNumber?: string; receiverNumber?: string | null; addr1?: string; addr2?: string; postCode?: string };

export type CoupangOrderItem = {
  sequenceNo?: string;
  productId?: number;
  vendorItemId?: number;
  vendorItemName?: string;
  sellerProductId?: number;
  sellerProductName?: string;
  sellerProductItemName?: string;
  externalVendorSkuCode?: string;
  shippingCount?: number;
  cancelCount?: number;
  holdCountForCancel?: number;
  orderPrice?: Money;
  canceled?: boolean;
};

export type CoupangOrderSheet = {
  shipmentBoxId: number;
  orderId: number;
  orderedAt?: string;
  paidAt?: string;
  status?: string;
  orderer?: Contact;
  receiver?: Receiver;
  parcelPrintMessage?: string;
  invoiceNumberUploadDate?: string;
  inTrasitDateTime?: string;
  deliveredDate?: string;
  orderItems?: CoupangOrderItem[];
};

export type CoupangOrderCredentials = CoupangCredentials & { vendorId: string };

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRateLimitRetry(url: URL, init: RequestInit, fetcher: typeof fetch) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetcher(url, init);
    if (response.status !== 429 || attempt === 3) return response;
    const retryAfter = Number(response.headers.get("Retry-After"));
    const delay = Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter * 1000, 0), 10_000) : 500 * 2 ** attempt;
    await wait(delay);
  }
  throw new Error("쿠팡 주문 조회 재시도에 실패했습니다.");
}

export async function collectCoupangOrderSheets(
  credentials: CoupangOrderCredentials,
  from: string,
  to: string,
  fetcher: typeof fetch = fetch,
): Promise<CoupangOrderSheet[]> {
  const vendorId = credentials.vendorId.trim();
  if (!/^A\d+$/.test(vendorId)) throw new CoupangApiError("쿠팡 업체코드가 올바르지 않습니다.", 400, { vendorId });
  const path = `/v2/providers/openapi/apis/api/v5/vendors/${encodeURIComponent(vendorId)}/ordersheets`;
  const collected = new Map<string, CoupangOrderSheet>();

  for (const status of COUPANG_ORDER_STATUSES) {
    const url = new URL(`${HOST}${path}`);
    url.searchParams.set("createdAtFrom", from);
    url.searchParams.set("createdAtTo", to);
    url.searchParams.set("searchType", "timeFrame");
    url.searchParams.set("status", status);
    const query = url.searchParams.toString();
    const authorization = await buildAuthorization(credentials.accessKey, credentials.secretKey, "GET", path, query);
    const response = await fetchWithRateLimitRetry(url, { method: "GET", headers: { Authorization: authorization, "Content-Type": "application/json;charset=UTF-8" } }, fetcher);
    const payload = await response.json().catch(() => null) as { code?: number | string; message?: string; data?: CoupangOrderSheet[] } | null;
    if (!response.ok) throw new CoupangApiError(payload?.message || "쿠팡 주문 조회에 실패했습니다.", response.status, payload);
    for (const sheet of payload?.data ?? []) collected.set(String(sheet.shipmentBoxId), sheet);
    if (status !== COUPANG_ORDER_STATUSES.at(-1)) await wait(150);
  }
  return [...collected.values()];
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeCoupangOrderSheet(sheet: CoupangOrderSheet): StoredOrderInput[] {
  const orderer = sheet.orderer ?? {};
  const receiver = sheet.receiver ?? {};
  const lastChangedAt = sheet.deliveredDate || sheet.inTrasitDateTime || sheet.invoiceNumberUploadDate || sheet.paidAt || sheet.orderedAt || "";
  return (sheet.orderItems ?? []).map((item, index) => ({
    channel: "coupang",
    orderId: text(sheet.orderId),
    productOrderId: `${text(sheet.shipmentBoxId)}-${item.sequenceNo || String(index + 1).padStart(3, "0")}`,
    channelProductId: text(item.vendorItemId),
    sellerProductCode: text(item.externalVendorSkuCode),
    productName: text(item.sellerProductName || item.vendorItemName),
    optionName: text(item.sellerProductItemName),
    quantity: number(item.shippingCount),
    paymentAmount: number(item.orderPrice?.units),
    orderedAt: text(sheet.orderedAt),
    paidAt: text(sheet.paidAt),
    lastChangedAt,
    orderStatus: text(sheet.status),
    claimType: "",
    claimStatus: item.canceled ? "CANCELED" : "",
    buyerName: text(orderer.name),
    buyerPhone: text(orderer.safeNumber || orderer.ordererNumber),
    buyerId: "",
    recipientName: text(receiver.name),
    recipientPhone1: text(receiver.safeNumber || receiver.receiverNumber),
    recipientPhone2: "",
    zipCode: text(receiver.postCode),
    baseAddress: text(receiver.addr1),
    detailedAddress: text(receiver.addr2),
    deliveryMessage: text(sheet.parcelPrintMessage),
  }));
}
