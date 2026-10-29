import type { GarakMarketPrice } from "./types";

export type MarketPriceSummary = {
  highest: GarakMarketPrice;
  lowest: GarakMarketPrice;
  spread: number;
};

export const UNKNOWN_MARKET_GRADE = "등급 미상";
const STANDARD_GRADE_ORDER = ["특", "상", "보통", "하"];

export function filterMarketPricesByQuery(rows: GarakMarketPrice[], query: string): GarakMarketPrice[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return rows.filter((row) => row.itemName.toLowerCase().includes(normalized) || row.itemCode.toLowerCase().includes(normalized));
}

export function formatMarketPackageUnit(unitQuantity: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(unitQuantity)}kg 포장`;
}

export function marketPackageOptions(rows: GarakMarketPrice[]): number[] {
  return [...new Set(rows.map((row) => row.unitQuantity).filter((unit) => unit > 0))].sort((left, right) => left - right);
}

export function marketGradeOptions(rows: GarakMarketPrice[]): string[] {
  return [...new Set(rows.map((row) => row.grade.trim() || UNKNOWN_MARKET_GRADE))].sort((left, right) => {
    const leftIndex = STANDARD_GRADE_ORDER.indexOf(left);
    const rightIndex = STANDARD_GRADE_ORDER.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) {
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    }
    if (left === UNKNOWN_MARKET_GRADE) return 1;
    if (right === UNKNOWN_MARKET_GRADE) return -1;
    return left.localeCompare(right, "ko");
  });
}

export function filterMarketPrices(
  rows: GarakMarketPrice[],
  filters: { unit: string; grade: string },
): GarakMarketPrice[] {
  return rows.filter((row) =>
    (filters.unit === "all" || row.unitQuantity === Number(filters.unit)) &&
    (filters.grade === "all" || (row.grade.trim() || UNKNOWN_MARKET_GRADE) === filters.grade)
  );
}

export function buildMarketPriceTrend(rows: GarakMarketPrice[], selected: GarakMarketPrice): GarakMarketPrice[] {
  const byDate = new Map<string, GarakMarketPrice>();
  for (const row of rows) {
    if (row.itemCode !== selected.itemCode || row.grade !== selected.grade || row.unitQuantity !== selected.unitQuantity) continue;
    if (row.averagePrice <= 0) continue;
    byDate.set(row.priceDate, row);
  }
  return [...byDate.values()].sort((left, right) => left.priceDate.localeCompare(right.priceDate));
}

export function summarizeMarketPriceTrend(rows: GarakMarketPrice[]) {
  if (rows.length === 0) return null;
  const latest = rows.at(-1)!;
  const previous = rows.at(-2) ?? null;
  if (!previous) return { previous, latest, change: null, changeRate: null };
  const change = latest.averagePrice - previous.averagePrice;
  const changeRate = previous.averagePrice > 0 ? Math.round(change / previous.averagePrice * 1000) / 10 : null;
  return { previous, latest, change, changeRate };
}

export function describeMarketTrendPoint(current: GarakMarketPrice, previous: GarakMarketPrice | null): string {
  const date = `${Number(current.priceDate.slice(4, 6))}/${Number(current.priceDate.slice(6, 8))}`;
  const price = `${new Intl.NumberFormat("ko-KR").format(current.averagePrice)}원`;
  if (!previous) return `${date} · ${price} · 첫 거래 데이터`;
  const change = current.averagePrice - previous.averagePrice;
  const changeRate = previous.averagePrice > 0 ? Math.round(change / previous.averagePrice * 1000) / 10 : null;
  const sign = change > 0 ? "+" : "";
  const rate = changeRate == null ? "비율 비교 불가" : `${changeRate > 0 ? "+" : ""}${changeRate}%`;
  return `${date} · ${price} · 직전 거래일 대비 ${sign}${new Intl.NumberFormat("ko-KR").format(change)}원 (${rate})`;
}

export function connectMarketTrend(rows: GarakMarketPrice[]): GarakMarketPrice[] {
  return [...rows];
}

export function summarizeMarketPrices(rows: GarakMarketPrice[]): MarketPriceSummary | null {
  const pricedRows = rows.filter((row) => row.averagePrice > 0);
  if (pricedRows.length === 0) return null;

  let highest = pricedRows[0];
  let lowest = pricedRows[0];
  for (const row of pricedRows.slice(1)) {
    if (row.averagePrice > highest.averagePrice) highest = row;
    if (row.averagePrice < lowest.averagePrice) lowest = row;
  }

  return { highest, lowest, spread: highest.averagePrice - lowest.averagePrice };
}
