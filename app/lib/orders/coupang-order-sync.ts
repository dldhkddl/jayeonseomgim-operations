import { collectCoupangOrderSheets, normalizeCoupangOrderSheet, type CoupangOrderCredentials, type CoupangOrderSheet } from "./coupang-order-api.ts";
import type { StoredOrderInput } from "./naver-order-api";

export type SuccessfulCoupangOrderSync = {
  from: string;
  to: string;
  orders: StoredOrderInput[];
  sourcePayloads: Array<{ productOrderId: string; payload: CoupangOrderSheet }>;
};

export interface CoupangOrderSyncRepository {
  readCursor(): Promise<string | null>;
  persistSuccessfulSync(sync: SuccessfulCoupangOrderSync): Promise<void>;
  recordFailedSync(input: { from: string; to: string; error: string }): Promise<void>;
}

function toKoreanIso(date: Date): string {
  const korean = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${korean.toISOString().slice(0, 16)}+09:00`;
}

export async function syncCoupangOrders(input: {
  credentials: CoupangOrderCredentials;
  repository: CoupangOrderSyncRepository;
  fetcher?: typeof fetch;
  now?: Date;
  historyDays?: number;
}) {
  const now = input.now ?? new Date();
  const cursor = await input.repository.readCursor();
  const requestedDays = input.historyDays == null ? null : Math.min(Math.max(Math.trunc(input.historyDays), 1), 31);
  const fromDate = requestedDays
    ? new Date(now.getTime() - requestedDays * 24 * 60 * 60 * 1000)
    : cursor ? new Date(cursor) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const from = toKoreanIso(fromDate);
  const to = toKoreanIso(now);

  try {
    const sheets = new Map<string, CoupangOrderSheet>();
    let windowFrom = new Date(fromDate);
    while (windowFrom < now) {
      const windowTo = new Date(Math.min(windowFrom.getTime() + (24 * 60 - 1) * 60 * 1000, now.getTime()));
      const batch = await collectCoupangOrderSheets(input.credentials, toKoreanIso(windowFrom), toKoreanIso(windowTo), input.fetcher);
      for (const sheet of batch) sheets.set(String(sheet.shipmentBoxId), sheet);
      windowFrom = windowTo;
    }

    const normalized = [...sheets.values()].flatMap(normalizeCoupangOrderSheet);
    const orders = [...new Map(normalized.map((order) => [order.productOrderId, order])).values()];
    const sheetByProductOrderId = new Map<string, CoupangOrderSheet>();
    for (const sheet of sheets.values()) {
      for (const order of normalizeCoupangOrderSheet(sheet)) sheetByProductOrderId.set(order.productOrderId, sheet);
    }
    const sync: SuccessfulCoupangOrderSync = {
      from,
      to,
      orders,
      sourcePayloads: orders.flatMap((order) => {
        const payload = sheetByProductOrderId.get(order.productOrderId);
        return payload ? [{ productOrderId: order.productOrderId, payload }] : [];
      }),
    };
    await input.repository.persistSuccessfulSync(sync);
    return { fetched: orders.length, from, to };
  } catch (error) {
    try {
      await input.repository.recordFailedSync({ from, to, error: error instanceof Error ? error.message : "알 수 없는 쿠팡 주문 수집 오류" });
    } catch (recordError) {
      console.error("쿠팡 주문 수집 실패 기록을 저장하지 못했습니다.", recordError);
    }
    throw error;
  }
}
