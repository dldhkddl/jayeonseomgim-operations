import type { GarakPriceQuery } from "./types";

type BuildGarakPriceQueriesInput = {
  now: Date;
  itemNames: string[];
  categoryCode: string;
  marketCode: string;
  days?: number;
};

function ymd(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function buildGarakPriceQueries(input: BuildGarakPriceQueriesInput): GarakPriceQuery[] {
  const itemNames = [...new Set(input.itemNames.map((item) => item.trim()).filter(Boolean))];
  if (itemNames.length === 0) throw new Error("조회할 과일 품목명을 입력해 주세요.");

  const requestedDays = Number.isFinite(input.days) ? input.days! : 1;
  const days = Math.max(1, Math.min(Math.trunc(requestedDays), 30));
  return Array.from({ length: days }, (_, dayOffset) => {
    const searchDay = new Date(input.now.getTime() - dayOffset * 86_400_000);
    const previousDay = new Date(searchDay.getTime() - 86_400_000);
    return itemNames.map((itemName) => ({
      searchDate: ymd(searchDay),
      previousDate: ymd(previousDay),
      categoryCode: input.categoryCode,
      marketCode: input.marketCode,
      itemName,
    }));
  }).flat();
}

type GarakQueryCollector<T> = {
  fetch(query: GarakPriceQuery): Promise<T[]>;
  persist(rows: T[], query: GarakPriceQuery): Promise<void>;
  onFailure?(query: GarakPriceQuery, error: unknown): Promise<void>;
};

export async function collectGarakPriceQueries<T>(queries: GarakPriceQuery[], collector: GarakQueryCollector<T>) {
  let fetched = 0;
  const completedDates: string[] = [];
  const failedDates: string[] = [];
  for (const query of queries) {
    try {
      const rows = await collector.fetch(query);
      await collector.persist(rows, query);
      fetched += rows.length;
      completedDates.push(query.searchDate);
    } catch (error) {
      failedDates.push(query.searchDate);
      await collector.onFailure?.(query, error);
    }
  }
  return { fetched, completedDates, failedDates };
}
