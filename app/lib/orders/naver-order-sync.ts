import {
  collectChangedProductOrders,
  fetchProductOrderDetails,
  normalizeNaverProductOrder,
  type NaverChangedOrder,
  type NaverProductOrderDetail,
  type StoredOrderInput,
} from "./naver-order-api.ts";

export type SuccessfulOrderSync = {
  from: string;
  to: string;
  changed: NaverChangedOrder[];
  orders: StoredOrderInput[];
  sourcePayloads: Array<{ productOrderId: string; payload: NaverProductOrderDetail }>;
};

export interface OrderSyncRepository {
  readCursor(): Promise<string | null>;
  persistSuccessfulSync(sync: SuccessfulOrderSync): Promise<void>;
  recordFailedSync(input: { from: string; to: string; error: string }): Promise<void>;
}

export async function syncNaverOrders(input: {
  accessToken: string;
  repository: OrderSyncRepository;
  fetcher?: typeof fetch;
  now?: Date;
  historyDays?: number;
}) {
  const now = input.now ?? new Date();
  const to = now.toISOString();
  const cursor = await input.repository.readCursor();
  const requestedDays = input.historyDays == null ? null : Math.min(Math.max(Math.trunc(input.historyDays), 1), 31);
  const from = requestedDays
    ? new Date(now.getTime() - requestedDays * 24 * 60 * 60 * 1000).toISOString()
    : cursor ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const changed: NaverChangedOrder[] = [];
    let windowFrom = new Date(from);
    while (windowFrom < now) {
      const windowTo = new Date(Math.min(windowFrom.getTime() + 24 * 60 * 60 * 1000, now.getTime()));
      changed.push(...await collectChangedProductOrders(input.accessToken, windowFrom.toISOString(), windowTo.toISOString(), input.fetcher));
      windowFrom = windowTo;
    }
    const uniqueEvents = [...new Map(changed.map((item) => [
      [item.productOrderId, item.lastChangedDate, item.lastChangedType, item.claimStatus ?? ""].join(":"),
      item,
    ])).values()];
    const details = await fetchProductOrderDetails(input.accessToken, [...new Set(uniqueEvents.map((item) => item.productOrderId))], input.fetcher);
    const byId = new Map(details.map((detail) => [String(detail.productOrder.productOrderId ?? ""), detail]));
    const latestByProductOrder = new Map<string, NaverChangedOrder>();
    for (const item of uniqueEvents) {
      const current = latestByProductOrder.get(item.productOrderId);
      if (!current || new Date(item.lastChangedDate).getTime() >= new Date(current.lastChangedDate).getTime()) latestByProductOrder.set(item.productOrderId, item);
    }
    const matched = [...latestByProductOrder.values()].flatMap((item) => {
      const detail = byId.get(item.productOrderId);
      return detail ? [{ item, detail }] : [];
    });
    const sync: SuccessfulOrderSync = {
      from,
      to,
      changed: uniqueEvents,
      orders: matched.map(({ item, detail }) => normalizeNaverProductOrder(item, detail)),
      sourcePayloads: matched.map(({ item, detail }) => ({ productOrderId: item.productOrderId, payload: detail })),
    };
    await input.repository.persistSuccessfulSync(sync);
    return { fetched: sync.orders.length, from, to };
  } catch (error) {
    await input.repository.recordFailedSync({ from, to, error: error instanceof Error ? error.message : "알 수 없는 주문 수집 오류" });
    throw error;
  }
}
