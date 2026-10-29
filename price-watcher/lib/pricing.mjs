// 공급가(주단가) -> 마켓별 권장 판매가/마진 계산.
//
// 공식(비유: 물가에 세금과 이윤을 얹어 최종가를 역산):
//   판매가 * (1 - 수수료율 - 목표마진율) = 공급가 + 배송비
//   => 판매가 = (공급가 + 배송비) / (1 - 수수료율 - 목표마진율)
// 즉 "수수료를 떼고, 목표 마진을 남기고도" 공급가+배송비를 커버하는 최소 판매가.

function roundTo(value, unit, mode) {
  if (!unit || unit <= 1) return Math.round(value);
  if (mode === "down") return Math.floor(value / unit) * unit;
  if (mode === "nearest") return Math.round(value / unit) * unit;
  return Math.ceil(value / unit) * unit; // 기본: 올림
}

/** 단일 마켓 권장가 계산 */
export function suggestPrice(supply, market, roundUnit, roundMode) {
  if (supply == null) return null;
  const denom = 1 - (market.feeRate || 0) - (market.marginRate || 0);
  if (denom <= 0) {
    throw new Error(`수수료율+마진율이 100% 이상입니다 (${market.label}). config를 확인하세요.`);
  }
  const rawPrice = (supply + (market.shipping || 0)) / denom;
  const sell = roundTo(rawPrice, roundUnit, roundMode);
  const fee = Math.round(sell * (market.feeRate || 0));
  const profit = sell - fee - supply - (market.shipping || 0);
  return {
    market: market.label,
    sell,
    fee,
    profit,
    marginPct: sell ? (profit / sell) * 100 : null,
  };
}

/** 모든 마켓에 대해 계산 */
export function suggestAll(supply, config) {
  const { roundTo: unit, roundMode } = config.pricing;
  const out = {};
  for (const [id, market] of Object.entries(config.pricing.markets)) {
    out[id] = suggestPrice(supply, market, unit, roundMode);
  }
  return out;
}
