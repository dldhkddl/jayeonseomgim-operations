export type GarakPriceQuery = {
  searchDate: string;
  previousDate: string;
  categoryCode: string;
  marketCode: string;
  itemName: string;
};

export type GarakMarketPrice = {
  id: string;
  source: "garak";
  priceDate: string;
  previousDate: string;
  categoryCode: string;
  marketCode: string;
  itemCode: string;
  itemName: string;
  grade: string;
  tradeQuantity: number;
  unitQuantity: number;
  averagePrice: number;
  previousDayChangeRate: number | null;
};

export type MarketPriceHistoryFilter = {
  itemCode?: string;
  marketCode?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type MarketPriceIngestionRun = {
  id: string;
  source: "garak";
  query: GarakPriceQuery;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  fetchedCount: number;
  persistedCount: number;
  error: string | null;
};

export function garakPriceId(input: Pick<GarakMarketPrice, "priceDate" | "marketCode" | "categoryCode" | "itemCode" | "grade" | "unitQuantity">): string {
  return [input.priceDate, input.marketCode, input.categoryCode, input.itemCode, input.grade, input.unitQuantity].join(":");
}
