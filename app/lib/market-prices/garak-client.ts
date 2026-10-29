import type { GarakMarketPrice, GarakPriceQuery } from "./types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type GarakClientOptions = {
  apiKey?: string;
  apiId?: string;
  apiPassword?: string;
  dataId?: string;
  endpoint: string;
  fetch?: FetchLike;
};

type RawRecord = Record<string, unknown>;

// Garak's issued public-data URLs use plain HTTP. Keep this aligned with the
// URL shown in the approved usage instructions; HTTPS is not available on
// this legacy endpoint.
export const DEFAULT_GARAK_PRICE_ENDPOINT = "http://www.garak.co.kr/homepage/publicdata/dataJsonOpen.do";
export const DEFAULT_GARAK_JSON_DATA_ID = "data36";

export type GarakPriceEnvironment = {
  GARAK_API_KEY?: string;
  GARAK_API_ID?: string;
  GARAK_API_PASSWORD?: string;
  GARAK_DATA_ID?: string;
  GARAK_PRICE_API_URL?: string;
};

/** Client for the Seoul Agro-Fisheries & Food Corporation major-item price API. */
export class GarakClient {
  private readonly apiId: string;
  private readonly apiPassword: string;
  private readonly dataId: string;
  private readonly legacyApiKey: string;
  private readonly endpoint: string;
  private readonly fetcher: FetchLike;

  constructor(options: GarakClientOptions) {
    this.apiId = options.apiId ?? "";
    this.apiPassword = options.apiPassword ?? options.apiKey ?? "";
    this.dataId = options.dataId ?? DEFAULT_GARAK_JSON_DATA_ID;
    this.legacyApiKey = options.apiId ? "" : options.apiKey ?? "";
    this.endpoint = options.endpoint;
    this.fetcher = options.fetch ?? fetch;
  }

  static fromEnvironment(env: GarakPriceEnvironment, fetcher?: FetchLike): GarakClient {
    if (!(env.GARAK_API_ID?.trim() && env.GARAK_API_PASSWORD?.trim()) && !env.GARAK_API_KEY?.trim()) throw new Error("GARAK_API_ID and GARAK_API_PASSWORD are required to fetch Garak market prices");
    return new GarakClient({
      apiId: env.GARAK_API_ID,
      apiPassword: env.GARAK_API_PASSWORD ?? env.GARAK_API_KEY,
      dataId: env.GARAK_DATA_ID,
      endpoint: env.GARAK_PRICE_API_URL?.trim() || DEFAULT_GARAK_PRICE_ENDPOINT,
      fetch: fetcher,
    });
  }

  async fetchPrices(query: GarakPriceQuery): Promise<GarakMarketPrice[]> {
    const url = new URL(this.endpoint);
    if (this.legacyApiKey) {
      url.searchParams.set("serviceKey", this.legacyApiKey);
      url.searchParams.set("searchDate", query.searchDate);
      url.searchParams.set("previousDate", query.previousDate);
      url.searchParams.set("categoryCode", query.categoryCode);
      url.searchParams.set("marketCode", query.marketCode);
      url.searchParams.set("itemName", query.itemName);
    } else {
      url.searchParams.set("id", this.apiId);
      url.searchParams.set("passwd", this.apiPassword);
      url.searchParams.set("dataid", this.dataId);
      url.searchParams.set("pagesize", "100");
      url.searchParams.set("pageidx", "1");
      url.searchParams.set("s_date", query.searchDate);
      url.searchParams.set("s_date_p", query.previousDate);
      url.searchParams.set("s_date_p7", daysBefore(query.searchDate, 7));
      url.searchParams.set("p_pos_gubun", query.marketCode);
      url.searchParams.set("s_pum_nm", query.categoryCode);
      url.searchParams.set("s_pummok", query.itemName);
      url.searchParams.set("portal.templet", "false");
    }

    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`Garak price API request failed with ${response.status}`);

    let payload: unknown;
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("json") || this.dataId === "data36") payload = await response.json();
      else throw new Error("Garak price API returned XML; use data36 JSON endpoint");
    } catch {
      throw new Error("Garak price API returned invalid JSON");
    }
    return rawItems(payload).map((item) => normalizeGarakPrice(item, query));
  }
}

export function normalizeGarakPrice(item: RawRecord, query: GarakPriceQuery): GarakMarketPrice {
  const itemName = text(item, ["PUM_NM", "itemName", "item_name"]);
  const itemCode = optionalText(item, ["PUM_CODE", "itemCode", "item_code"]) ?? itemName;
  const grade = text(item, ["GRADE_NM", "G_NAME", "GRAD_NM", "GRADE", "grade"]);
  const unitLabel = text(item, ["U_NAME", "UNIT_NM", "UNIT_NAME", "unitName", "UNIT_QTY", "unitQuantity", "unit_quantity"]);
  const unitQuantity = Number.parseFloat(unitLabel.replaceAll(",", "")) || 1;
  const price = {
    priceDate: query.searchDate,
    marketCode: query.marketCode,
    categoryCode: query.categoryCode,
    itemCode,
    grade,
    unitQuantity,
  };

  return {
    id: [price.priceDate, price.marketCode, price.categoryCode, price.itemCode, price.grade, price.unitQuantity].join(":"),
    source: "garak",
    ...price,
    previousDate: query.previousDate,
    itemName,
    tradeQuantity: optionalNumber(item, ["TOT_QTY", "TRADE_QTY", "tradeQuantity", "trade_quantity"]) ?? 0,
    averagePrice: number(item, ["AV_P", "AVG_PRC", "AVG_PRICE", "averagePrice", "average_price"], "average price"),
    previousDayChangeRate: optionalNumber(item, ["FLUC", "DPR1", "CHANGE_RATE", "previousDayChangeRate", "previous_day_change_rate"]),
  };
}

function rawItems(payload: unknown): RawRecord[] {
  const object = record(payload);
  const candidates = [
    object.resultData,
    object.items,
    record(object.response).body,
    record(record(object.response).body).items,
    record(object.data).items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(record);
    const nested = record(candidate);
    if (Array.isArray(nested.item)) return nested.item.map(record);
    if (Array.isArray(nested.items)) return nested.items.map(record);
  }
  throw new Error("Garak price API response did not contain price items");
}

function record(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function text(item: RawRecord, keys: string[]): string {
  const value = optionalText(item, keys);
  if (value !== null) return value;
  throw new Error(`Garak price item is missing ${keys[0]}`);
}

function optionalText(item: RawRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function number(item: RawRecord, keys: string[], label: string): number {
  const value = optionalNumber(item, keys);
  if (value === null) throw new Error(`Garak price item is missing ${label}`);
  return value;
}

function optionalNumber(item: RawRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replaceAll(",", "").trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function daysBefore(ymd: string, days: number): string {
  const date = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}
