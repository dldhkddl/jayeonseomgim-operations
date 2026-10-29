const BASE_URL = "https://api.commerce.naver.com/external/v1/pay-order/seller";

export type NaverChangedOrder = {
  orderId: string;
  productOrderId: string;
  lastChangedDate: string;
  lastChangedType: string;
  productOrderStatus: string;
  claimType?: string;
  claimStatus?: string;
};

export type NaverProductOrderDetail = {
  order: Record<string, unknown>;
  productOrder: Record<string, unknown>;
};

export type StoredOrderInput = {
  channel: "naver" | "coupang" | "cafe24";
  orderId: string;
  productOrderId: string;
  channelProductId: string;
  sellerProductCode: string;
  productName: string;
  optionName: string;
  quantity: number;
  paymentAmount: number;
  orderedAt: string;
  paidAt: string;
  lastChangedAt: string;
  orderStatus: string;
  claimType: string;
  claimStatus: string;
  buyerName: string;
  buyerPhone: string;
  buyerId: string;
  recipientName: string;
  recipientPhone1: string;
  recipientPhone2: string;
  zipCode: string;
  baseAddress: string;
  detailedAddress: string;
  deliveryMessage: string;
};

export class NaverOrderApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new NaverOrderApiError(response.status, data?.message || "네이버 주문 API 요청에 실패했습니다.", data);
  return data as Record<string, unknown>;
}

async function requestWithRetry(fetcher: typeof fetch, input: RequestInfo | URL, init?: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetcher(input, init);
    if ((response.status !== 429 && response.status < 500) || attempt === 2) return response;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error("네이버 주문 API 재시도에 실패했습니다.");
}

export async function collectChangedProductOrders(
  accessToken: string,
  from: string,
  to: string,
  fetcher: typeof fetch = fetch,
): Promise<NaverChangedOrder[]> {
  const collected: NaverChangedOrder[] = [];
  let nextFrom = from;
  let moreSequence = "";
  do {
    const url = new URL(`${BASE_URL}/product-orders/last-changed-statuses`);
    url.searchParams.set("lastChangedFrom", nextFrom);
    url.searchParams.set("lastChangedTo", to);
    url.searchParams.set("limitCount", "300");
    if (moreSequence) url.searchParams.set("moreSequence", moreSequence);
    const response = await requestWithRetry(fetcher, url, { headers: { Accept: "application/json;charset=UTF-8", Authorization: `Bearer ${accessToken}` } });
    const payload = await readJson(response) as { data?: { lastChangeStatuses?: NaverChangedOrder[]; more?: { moreFrom?: string; moreSequence?: string } } };
    collected.push(...(payload.data?.lastChangeStatuses ?? []));
    const more = payload.data?.more;
    nextFrom = more?.moreFrom ?? "";
    moreSequence = more?.moreSequence ?? "";
  } while (nextFrom && moreSequence);
  return collected;
}

export async function fetchProductOrderDetails(
  accessToken: string,
  productOrderIds: string[],
  fetcher: typeof fetch = fetch,
): Promise<NaverProductOrderDetail[]> {
  const details: NaverProductOrderDetail[] = [];
  for (let offset = 0; offset < productOrderIds.length; offset += 300) {
    const ids = productOrderIds.slice(offset, offset + 300);
    const response = await requestWithRetry(fetcher, `${BASE_URL}/product-orders/query`, {
      method: "POST",
      headers: { Accept: "application/json;charset=UTF-8", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ productOrderIds: ids, quantityClaimCompatibility: true }),
    });
    const payload = await readJson(response) as { data?: NaverProductOrderDetail[] };
    details.push(...(payload.data ?? []));
  }
  return details;
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeNaverProductOrder(changed: NaverChangedOrder, detail: NaverProductOrderDetail): StoredOrderInput {
  const order = detail.order;
  const product = detail.productOrder;
  const address = (product.shippingAddress ?? {}) as Record<string, unknown>;
  return {
    channel: "naver",
    orderId: text(order.orderId || changed.orderId),
    productOrderId: text(product.productOrderId || changed.productOrderId),
    channelProductId: text(product.productId),
    sellerProductCode: text(product.sellerProductCode),
    productName: text(product.productName),
    optionName: text(product.productOption),
    quantity: number(product.quantity),
    paymentAmount: number(product.totalPaymentAmount),
    orderedAt: text(order.orderDate),
    paidAt: text(order.paymentDate),
    lastChangedAt: changed.lastChangedDate,
    orderStatus: text(product.productOrderStatus || changed.productOrderStatus),
    claimType: text(changed.claimType),
    claimStatus: text(changed.claimStatus),
    buyerName: text(order.ordererName),
    buyerPhone: text(order.ordererTel),
    buyerId: text(order.ordererId),
    recipientName: text(address.name),
    recipientPhone1: text(address.tel1),
    recipientPhone2: text(address.tel2),
    zipCode: text(address.zipCode),
    baseAddress: text(address.baseAddress),
    detailedAddress: text(address.detailedAddress),
    deliveryMessage: text(product.shippingMemo),
  };
}
