/**
 * 마진 계산
 *
 * 판매가에서 무엇이 빠져나가는지 순서대로 계산한다.
 *
 *   판매가
 *     − 채널 수수료 (판매가 × 수수료율)
 *     − 수수료 부가세 (수수료 × 10%)   ← 대부분의 채널이 수수료에 VAT 별도
 *     − 건당 고정비 (있는 경우)
 *   = 정산액 (실제로 통장에 들어오는 돈)
 *     − 매출 부가세 (과세 상품만. 면세 농산물은 0)
 *     − 원가 (매입가 + 포장비 + 택배비 + 기타)
 *   = 마진
 *
 * 주의: 수수료율은 채널·카테고리·판매자 등급마다 달라진다.
 *       기본값은 참고용이고 반드시 정산 내역으로 확인해야 한다.
 */

export type CostInput = {
  /** 매입가 (사입 원가) */
  supply: number;
  /** 포장비 (박스·완충재·스티커) */
  packaging: number;
  /** 택배비 (무료배송이면 판매자 부담분) */
  shipping: number;
  /** 기타 (수수료 외 광고비 등 건당 배분) */
  other: number;
};

export type FeeInput = {
  /** 채널 판매 수수료 (%) */
  rate: number;
  /** 수수료에 부가세 10%가 별도로 붙는가 */
  feeVat: boolean;
  /** 건당 고정비 (원) */
  fixed: number;
};

export type MarginResult = {
  price: number;
  fee: number;
  feeVatAmount: number;
  fixed: number;
  /** 정산액 = 판매가 − 수수료 − 수수료VAT − 고정비 */
  settlement: number;
  /** 매출 부가세 (면세면 0) */
  salesVat: number;
  totalCost: number;
  /** 마진 (원) */
  margin: number;
  /** 마진율 = 마진 / 판매가 */
  marginRate: number;
};

export const ZERO_COST: CostInput = { supply: 0, packaging: 0, shipping: 0, other: 0 };

/** SSR과 브라우저의 첫 렌더가 항상 같도록 저장소와 무관한 초기값을 만든다. */
export function initialMarginState(): { cost: CostInput; fees: Record<string, FeeInput> } {
  return { cost: { ...ZERO_COST }, fees: {} };
}

export function totalCost(cost: CostInput): number {
  return (cost.supply || 0) + (cost.packaging || 0) + (cost.shipping || 0) + (cost.other || 0);
}

/**
 * 과세 상품의 매출 부가세.
 * 판매가는 부가세 포함 가격이라는 국내 관행을 따른다. (판매가 11,000원 → 부가세 1,000원)
 */
function salesVatOf(price: number, taxFree: boolean): number {
  return taxFree ? 0 : price / 11;
}

export function calcMargin(price: number, cost: CostInput, fee: FeeInput, taxFree: boolean): MarginResult {
  const p = Math.max(0, price || 0);
  const feeAmount = p * ((fee.rate || 0) / 100);
  const feeVatAmount = fee.feeVat ? feeAmount * 0.1 : 0;
  const fixed = fee.fixed || 0;
  const settlement = p - feeAmount - feeVatAmount - fixed;
  const salesVat = salesVatOf(p, taxFree);
  const c = totalCost(cost);
  const margin = settlement - salesVat - c;

  return {
    price: p,
    fee: feeAmount,
    feeVatAmount,
    fixed,
    settlement,
    salesVat,
    totalCost: c,
    margin,
    marginRate: p > 0 ? margin / p : 0,
  };
}

/**
 * 목표 마진율을 만족하는 판매가를 역산한다.
 *
 *   margin = P − P·f·(1+v) − fixed − P·vatRate − C  이고  margin = m·P 이므로
 *   P·(1 − f(1+v) − vatRate − m) = C + fixed
 *   P = (C + fixed) / (1 − f(1+v) − vatRate − m)
 *
 * 분모가 0 이하면 그 마진율은 수학적으로 달성 불가능하다(수수료만으로 다 나감).
 */
export function priceForTargetMargin(
  targetRate: number,
  cost: CostInput,
  fee: FeeInput,
  taxFree: boolean,
): number | null {
  const m = targetRate;
  const f = (fee.rate || 0) / 100;
  const v = fee.feeVat ? 1.1 : 1;
  const vatRate = taxFree ? 0 : 1 / 11;

  const denominator = 1 - f * v - vatRate - m;
  if (denominator <= 0.0001) return null;

  const price = (totalCost(cost) + (fee.fixed || 0)) / denominator;
  return price > 0 ? price : null;
}

/** 손익분기 판매가 (마진 0이 되는 가격) */
export function breakEvenPrice(cost: CostInput, fee: FeeInput, taxFree: boolean): number | null {
  return priceForTargetMargin(0, cost, fee, taxFree);
}

/** 10원 단위 등으로 올림. 가격표에 900원처럼 끝을 맞추고 싶을 때 씀 */
export function roundPrice(price: number, unit = 10, mode: "up" | "nearest" = "up"): number {
  if (unit <= 1) return Math.round(price);
  return mode === "up" ? Math.ceil(price / unit) * unit : Math.round(price / unit) * unit;
}

// ── 채널별 수수료 기본값 ──────────────────────────────────────────────────

export type ChannelFeeConfig = FeeInput & { note: string };

/**
 * 참고용 기본값. 실제 요율은 카테고리·판매자 등급·계약에 따라 다르다.
 * 반드시 각 채널 정산 화면에서 확인하고 고쳐 쓸 것.
 */
export const DEFAULT_FEES: Record<string, ChannelFeeConfig> = {
  smartstore: {
    rate: 5.63,
    feeVat: false,
    fixed: 0,
    note: "주문관리 수수료 약 3.63% + 판매(연동) 수수료. 매출 규모·업력에 따라 1.98~3.63% 구간이 달라집니다.",
  },
  coupang: {
    rate: 10.6,
    feeVat: true,
    fixed: 0,
    note: "식품 카테고리 기준. 카테고리별 4~10.9%. 월 매출 100만원 초과 시 월 55,000원 이용료 별도(건당 아님).",
  },
  cafe24: {
    rate: 3.4,
    feeVat: true,
    fixed: 0,
    note: "자사몰은 판매 수수료가 없고 결제대행(PG) 수수료가 붙습니다. 계약 PG사 요율로 바꿔 쓰세요.",
  },
  "11st": {
    rate: 12,
    feeVat: true,
    fixed: 0,
    note: "카테고리별로 크게 다릅니다. 셀러오피스 요율을 확인해 주세요.",
  },
};

export function feeFor(channelId: string): ChannelFeeConfig {
  return DEFAULT_FEES[channelId] ?? { rate: 10, feeVat: true, fixed: 0, note: "요율을 직접 확인해 주세요." };
}

// ── 저장 ──────────────────────────────────────────────────────────────────

const COST_KEY = "damda.margin.cost.v1";
const FEE_KEY = "damda.margin.fees.v1";

export function loadCost(): CostInput {
  if (typeof window === "undefined") return { ...ZERO_COST };
  try {
    return { ...ZERO_COST, ...(JSON.parse(window.localStorage.getItem(COST_KEY) ?? "{}") as Partial<CostInput>) };
  } catch {
    return { ...ZERO_COST };
  }
}

export function saveCost(cost: CostInput): void {
  if (typeof window !== "undefined") window.localStorage.setItem(COST_KEY, JSON.stringify(cost));
}

export function loadFees(): Record<string, FeeInput> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(FEE_KEY) ?? "{}") as Record<string, FeeInput>;
  } catch {
    return {};
  }
}

export function saveFees(fees: Record<string, FeeInput>): void {
  if (typeof window !== "undefined") window.localStorage.setItem(FEE_KEY, JSON.stringify(fees));
}

export const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
