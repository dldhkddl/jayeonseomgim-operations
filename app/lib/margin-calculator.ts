export type MarginChannel = "naver" | "coupang" | "cafe24";

export type MarginInput = {
  sellingPrice: number;
  productCost: number;
  customerShippingFee: number;
  actualShippingCost: number;
  packagingCost: number;
  advertisingCost: number;
  otherCost: number;
  taxable: boolean;
};

export type ChannelFeeRates = Record<MarginChannel, number>;

export type ChannelMarginResult = {
  channel: MarginChannel;
  feeRate: number;
  revenue: number;
  fixedCost: number;
  platformFee: number;
  estimatedVat: number;
  totalCost: number;
  profit: number;
  marginRate: number;
  roi: number;
  breakEvenSellingPrice: number;
  profitGap: number;
  isBest: boolean;
};

// 수정 가능한 참고 시작값입니다. 실제 정산 요율은 판매자 등급·카테고리·PG 계약에 따라 달라집니다.
export const DEFAULT_CHANNEL_FEES: ChannelFeeRates = { naver: 5.63, coupang: 10.8, cafe24: 3.85 };

const CHANNELS: MarginChannel[] = ["naver", "coupang", "cafe24"];

function safeAmount(value: number) {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

function safeFeeRate(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
}

function roundRate(value: number) {
  return Math.round(value * 100) / 100;
}

export function sellingPriceForTargetProductMargin(
  productCost: number,
  targetMarginPercent: number,
  roundUnit = 100,
): number | null {
  const cost = safeAmount(productCost);
  if (
    cost <= 0
    || !Number.isFinite(targetMarginPercent)
    || targetMarginPercent < 0
    || targetMarginPercent >= 100
  ) {
    return null;
  }

  const unit = Number.isFinite(roundUnit) && roundUnit > 0 ? roundUnit : 100;
  const exactPrice = cost / (1 - targetMarginPercent / 100);
  return Math.ceil(exactPrice / unit) * unit;
}

export function calculateChannelMargins(input: MarginInput, feeRates: ChannelFeeRates): ChannelMarginResult[] {
  const sellingPrice = safeAmount(input.sellingPrice);
  const customerShippingFee = safeAmount(input.customerShippingFee);
  const revenue = sellingPrice + customerShippingFee;
  const fixedCost = [input.productCost, input.actualShippingCost, input.packagingCost, input.advertisingCost, input.otherCost]
    .reduce((sum, value) => sum + safeAmount(value), 0);
  const estimatedVat = input.taxable ? Math.round(revenue / 11) : 0;

  const calculated = CHANNELS.map((channel) => {
    const feeRate = safeFeeRate(feeRates[channel]);
    const platformFee = Math.round(revenue * feeRate / 100);
    const totalCost = fixedCost + platformFee + estimatedVat;
    const profit = revenue - totalCost;
    const marginRate = revenue > 0 ? roundRate(profit / revenue * 100) : 0;
    const roi = fixedCost > 0 ? roundRate(profit / fixedCost * 100) : 0;
    const variableRate = feeRate / 100 + (input.taxable ? 1 / 11 : 0);
    const breakEvenRevenue = variableRate < 1 ? fixedCost / (1 - variableRate) : 0;

    return {
      channel,
      feeRate,
      revenue,
      fixedCost,
      platformFee,
      estimatedVat,
      totalCost,
      profit,
      marginRate,
      roi,
      breakEvenSellingPrice: Math.round(Math.max(breakEvenRevenue - customerShippingFee, 0)),
      profitGap: 0,
      isBest: false,
    };
  });

  const bestProfit = Math.max(...calculated.map((result) => result.profit));
  return calculated.map((result) => ({
    ...result,
    profitGap: bestProfit - result.profit,
    isBest: result.profit === bestProfit,
  }));
}
