// 전주(prev) vs 금주(curr) 비교 엔진.
// 상품코드(없으면 상품명) 기준으로 매칭해 변동을 분류한다.

/**
 * @param {Map} prev  parseWorkbook(...).rows
 * @param {Map} curr
 * @param {object} config
 */
export function diffWeeks(prev, curr, config) {
  const lowStock = config.lowStockThreshold ?? null;

  const newItems = [];      // 신규 등록
  const removedItems = [];  // 이번 주 사라짐(단종/누락)
  const priceChanges = [];  // 공급가 변동
  const soldOut = [];       // 판매중 -> 품절
  const restocked = [];     // 품절 -> 재입고
  const lowStockItems = []; // 재고 임계치 이하(품절 아님)
  const unchanged = [];

  // 신규 / 변동
  for (const [key, cur] of curr) {
    const old = prev.get(key);

    if (!old) {
      newItems.push(cur);
      if (cur.soldOut) soldOut.push({ ...cur, reason: "신규인데 품절" });
      else if (lowStock != null && cur.stock != null && cur.stock <= lowStock)
        lowStockItems.push(cur);
      continue;
    }

    let touched = false;

    // 공급가 변동
    if (cur.supply != null && old.supply != null && cur.supply !== old.supply) {
      const delta = cur.supply - old.supply;
      priceChanges.push({
        ...cur,
        oldSupply: old.supply,
        newSupply: cur.supply,
        delta,
        deltaPct: old.supply ? (delta / old.supply) * 100 : null,
      });
      touched = true;
    }

    // 품절/재입고 전환
    if (!old.soldOut && cur.soldOut) {
      soldOut.push({ ...cur, oldStock: old.stock, reason: "재고 소진/품절 전환" });
      touched = true;
    } else if (old.soldOut && !cur.soldOut) {
      restocked.push({ ...cur, oldStock: old.stock });
      touched = true;
    }

    // 재고 부족 경고(품절은 아니지만 임계치 이하)
    if (!cur.soldOut && lowStock != null && cur.stock != null && cur.stock <= lowStock) {
      lowStockItems.push(cur);
    }

    if (!touched) unchanged.push(cur);
  }

  // 단종/누락: 전주엔 있었는데 금주에 없음
  for (const [key, old] of prev) {
    if (!curr.has(key)) removedItems.push(old);
  }

  return {
    newItems,
    removedItems,
    priceChanges,
    soldOut,
    restocked,
    lowStockItems,
    unchanged,
    summary: {
      prevCount: prev.size,
      currCount: curr.size,
      new: newItems.length,
      removed: removedItems.length,
      priceChanged: priceChanges.length,
      soldOut: soldOut.length,
      restocked: restocked.length,
      lowStock: lowStockItems.length,
    },
  };
}
