// 변경 결과 -> 사람이 읽는 리포트(md) + 마켓 업로드용 목록(csv)
// 초기 버전은 '목록만' 생성한다. 자동 반영(API push)은 검증 후 별도 단계.
import { suggestAll } from "./pricing.mjs";

const won = (n) => (n == null ? "-" : n.toLocaleString("ko-KR") + "원");
const pct = (n) => (n == null ? "-" : (n >= 0 ? "+" : "") + n.toFixed(1) + "%");

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 마크다운 리포트 */
export function buildMarkdown(diff, config, dateLabel) {
  const s = diff.summary;
  const L = [];
  L.push(`# 주단가 변동 리포트 (${dateLabel})`);
  L.push("");
  L.push(
    `전주 ${s.prevCount}품목 → 금주 ${s.currCount}품목 · ` +
    `공급가변동 ${s.priceChanged} · 신규 ${s.new} · 단종 ${s.removed} · ` +
    `품절 ${s.soldOut} · 재입고 ${s.restocked} · 재고부족 ${s.lowStock}`
  );
  L.push("");

  if (diff.soldOut.length) {
    L.push(`## 🔴 품절 (즉시 판매중지 권장) — ${diff.soldOut.length}건`);
    L.push("");
    L.push("| 코드 | 상품명 | 규격 | 전주재고 | 사유 |");
    L.push("|---|---|---|---:|---|");
    for (const it of diff.soldOut)
      L.push(`| ${it.code ?? "-"} | ${it.name ?? "-"} | ${it.spec ?? "-"} | ${it.oldStock ?? "-"} | ${it.reason ?? "품절"} |`);
    L.push("");
  }

  if (diff.priceChanges.length) {
    const mkeys = Object.keys(config.pricing.markets);
    const mlabels = mkeys.map((k) => config.pricing.markets[k].label);
    L.push(`## 💰 공급가 변동 → 판매가 조정 — ${diff.priceChanges.length}건`);
    L.push("");
    L.push(`| 코드 | 상품명 | 전주공급가 | 금주공급가 | 변동 | ${mlabels.map((l) => `${l} 권장가`).join(" | ")} |`);
    L.push(`|---|---|---:|---:|---:|${mkeys.map(() => "---:").join("|")}|`);
    for (const it of diff.priceChanges) {
      const sug = suggestAll(it.newSupply, config);
      const cells = mkeys.map((k) => (sug[k] ? won(sug[k].sell) : "-"));
      L.push(
        `| ${it.code ?? "-"} | ${it.name ?? "-"} | ${won(it.oldSupply)} | ${won(it.newSupply)} | ` +
        `${won(it.delta)} (${pct(it.deltaPct)}) | ${cells.join(" | ")} |`
      );
    }
    L.push("");
  }

  if (diff.newItems.length) {
    L.push(`## 🆕 신규 품목 — ${diff.newItems.length}건`);
    L.push("");
    L.push("| 코드 | 상품명 | 규격 | 공급가 | 재고 |");
    L.push("|---|---|---|---:|---:|");
    for (const it of diff.newItems)
      L.push(`| ${it.code ?? "-"} | ${it.name ?? "-"} | ${it.spec ?? "-"} | ${won(it.supply)} | ${it.stock ?? "-"} |`);
    L.push("");
  }

  if (diff.restocked.length) {
    L.push(`## 🟢 재입고 (판매재개 가능) — ${diff.restocked.length}건`);
    L.push("");
    L.push("| 코드 | 상품명 | 금주재고 |");
    L.push("|---|---|---:|");
    for (const it of diff.restocked)
      L.push(`| ${it.code ?? "-"} | ${it.name ?? "-"} | ${it.stock ?? "-"} |`);
    L.push("");
  }

  if (diff.removedItems.length) {
    L.push(`## ⚫ 금주 목록에서 사라짐 (확인 필요) — ${diff.removedItems.length}건`);
    L.push("");
    L.push("| 코드 | 상품명 | 전주재고 |");
    L.push("|---|---|---:|");
    for (const it of diff.removedItems)
      L.push(`| ${it.code ?? "-"} | ${it.name ?? "-"} | ${it.stock ?? "-"} |`);
    L.push("");
  }

  if (diff.lowStockItems.length) {
    L.push(`## 🟡 재고 부족 경고 (임계치 ${config.lowStockThreshold} 이하) — ${diff.lowStockItems.length}건`);
    L.push("");
    L.push("| 코드 | 상품명 | 재고 |");
    L.push("|---|---|---:|");
    for (const it of diff.lowStockItems)
      L.push(`| ${it.code ?? "-"} | ${it.name ?? "-"} | ${it.stock ?? "-"} |`);
    L.push("");
  }

  L.push("---");
  L.push("_이 리포트는 '변경 목록'만 제공합니다. 마켓 자동 반영은 검증 후 별도 단계로 전환합니다._");
  return L.join("\n");
}

/** 가격 반영용 CSV: 공급가 변동 + 신규 품목 (마켓별 권장가 포함) */
export function buildPriceCsv(diff, config) {
  const mkeys = Object.keys(config.pricing.markets);
  const header = [
    "구분", "상품코드", "상품명", "규격",
    "전주공급가", "금주공급가",
    ...mkeys.flatMap((k) => {
      const l = config.pricing.markets[k].label;
      return [`${l}_권장판매가`, `${l}_예상마진`];
    }),
  ];
  const lines = [header.map(csvCell).join(",")];

  const push = (kind, it, oldSupply, supply) => {
    const sug = suggestAll(supply, config);
    const row = [kind, it.code ?? "", it.name ?? "", it.spec ?? "", oldSupply ?? "", supply ?? ""];
    for (const k of mkeys) row.push(sug[k]?.sell ?? "", sug[k]?.profit ?? "");
    lines.push(row.map(csvCell).join(","));
  };

  for (const it of diff.priceChanges) push("가격변동", it, it.oldSupply, it.newSupply);
  for (const it of diff.newItems) push("신규", it, "", it.supply);
  return lines.join("\n");
}

/** 품절 처리용 CSV: 판매중지/재개 대상 */
export function buildStockCsv(diff) {
  const header = ["처리", "상품코드", "상품명", "규격", "재고", "사유"];
  const lines = [header.map(csvCell).join(",")];
  for (const it of diff.soldOut)
    lines.push(["판매중지", it.code ?? "", it.name ?? "", it.spec ?? "", it.stock ?? 0, it.reason ?? "품절"].map(csvCell).join(","));
  for (const it of diff.restocked)
    lines.push(["판매재개", it.code ?? "", it.name ?? "", it.spec ?? "", it.stock ?? "", "재입고"].map(csvCell).join(","));
  return lines.join("\n");
}
