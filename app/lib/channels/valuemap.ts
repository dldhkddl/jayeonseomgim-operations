/**
 * 채널별 값 변환 대조표
 *
 * 컬럼 위치가 맞아도 **값의 표기**가 다르면 채널이 받아주지 않는다.
 *   - 카테고리: 채널마다 코드 체계가 완전히 다르다 (스토어 50000159 ↔ 쿠팡 자체 코드)
 *   - 배송비 유형: "무료배송" ↔ "FREE" ↔ "무료"
 *   - 부가세: "면세" ↔ "면세상품" ↔ "Y"
 *
 * 특히 카테고리는 **틀려도 에러가 안 난다.** 엉뚱한 분류로 등록되거나 나중에 반려된다.
 * 그래서 대조표에 값이 없으면 임의로 만들지 않고 원본을 그대로 두면서 경고를 띄운다.
 *
 * 대조표는 사용자 데이터다. 채널 관리자에서 코드를 한 번 복사해 넣으면 그 뒤로는 자동이다.
 */

import type { CanonicalRow } from "./canonical";

export type ValueRule = {
  id: string;
  /** 어떤 항목을 바꿀 것인가 (공통 스키마 필드 id) */
  fieldId: string;
  /** 사람이 알아볼 이름 (예: "사과", "무료배송") */
  label: string;
  /** 이 단어들이 상품에서 발견되면 규칙이 걸린다 */
  keywords: string[];
  /** 채널별로 넣을 값. 비어 있으면 바꾸지 않는다 */
  byChannel: Record<string, string>;
};

/** 카테고리 판정에 함께 훑을 항목들 (상품명에만 품목이 적힌 경우가 많다) */
const SEARCH_FIELDS = ["category", "productName", "variety", "weightSpec", "feature"];

const KEY = "damda.valueRules.v1";

// ── 기본 규칙 ─────────────────────────────────────────────────────────────

const cat = (label: string, keywords: string[]): ValueRule => ({
  id: `cat-${label}`,
  fieldId: "category",
  label,
  keywords,
  // 카테고리 코드는 추측해서 넣으면 안 된다. 사용자가 채널에서 확인해 채운다.
  byChannel: {},
});

/**
 * 농산물 판매자가 자주 쓰는 품목.
 * 카테고리 값은 일부러 비워 둔다 — 지어내면 조용히 틀린 분류로 등록된다.
 */
export const DEFAULT_RULES: ValueRule[] = [
  cat("사과", ["사과", "부사", "홍로", "엔비", "시나노"]),
  cat("포도·샤인머스캣", ["샤인머스캣", "포도", "거봉", "캠벨"]),
  cat("복숭아", ["복숭아", "백도", "황도", "천도"]),
  cat("배", ["배", "신고배", "원황"]),
  cat("감·곶감", ["곶감", "감말랭이", "단감", "홍시"]),
  cat("귤·감귤", ["귤", "감귤", "한라봉", "천혜향"]),
  {
    id: "delivery-free",
    fieldId: "deliveryFeeType",
    label: "무료배송",
    keywords: ["무료"],
    byChannel: { smartstore: "무료", coupang: "무료배송", cafe24: "무료배송", "11st": "무료" },
  },
  {
    id: "tax-free",
    fieldId: "taxType",
    label: "면세",
    keywords: ["면세"],
    byChannel: { smartstore: "면세", coupang: "면세", cafe24: "면세", "11st": "면세" },
  },
  {
    id: "sale-on",
    fieldId: "saleStatus",
    label: "판매중",
    keywords: ["판매중", "판매"],
    byChannel: { smartstore: "판매중", coupang: "판매중", cafe24: "Y", "11st": "판매중" },
  },
];

// ── 적용 ──────────────────────────────────────────────────────────────────

function haystack(row: CanonicalRow, fieldId: string): string {
  const fields = fieldId === "category" ? SEARCH_FIELDS : [fieldId];
  return fields.map((f) => String(row[f] ?? "")).join(" ").toLowerCase();
}

export type RuleHit = {
  rule: ValueRule;
  /** 채널 값이 비어 있어서 바꾸지 못했다 */
  missing: boolean;
};

/** 이 상품에 걸리는 규칙들을 찾는다 */
export function matchRules(row: CanonicalRow, rules: ValueRule[], channelId: string): RuleHit[] {
  const hits: RuleHit[] = [];
  const usedFields = new Set<string>();

  for (const rule of rules) {
    // 같은 항목에 여러 규칙이 걸리면 먼저 나온 것만 쓴다 (표의 위쪽이 우선)
    if (usedFields.has(rule.fieldId)) continue;
    const text = haystack(row, rule.fieldId);
    if (!text.trim()) continue;
    if (!rule.keywords.some((k) => k.trim() && text.includes(k.toLowerCase()))) continue;

    usedFields.add(rule.fieldId);
    hits.push({ rule, missing: !String(rule.byChannel[channelId] ?? "").trim() });
  }
  return hits;
}

/** 대조표를 적용한 행을 돌려준다. 값이 없는 규칙은 원본을 건드리지 않는다. */
export function applyValueRules(rows: CanonicalRow[], rules: ValueRule[], channelId: string): CanonicalRow[] {
  if (!rules.length) return rows;
  return rows.map((row) => {
    const next = { ...row };
    for (const { rule, missing } of matchRules(row, rules, channelId)) {
      if (missing) continue;
      next[rule.fieldId] = rule.byChannel[channelId];
    }
    return next;
  });
}

const DOMESTIC_ORIGIN_BY_CHANNEL: Record<string, string> = {
  smartstore: "00",
  coupang: "국산",
  cafe24: "국산",
  "11st": "국산",
};

/** 내부 상세 산지는 보존하고 채널에 전달하는 원산지 값만 국내산 형식으로 통일한다. */
export function applyDomesticOriginFormat(rows: CanonicalRow[], channelId: string): CanonicalRow[] {
  const origin = DOMESTIC_ORIGIN_BY_CHANNEL[channelId];
  if (!origin) return rows;
  return rows.map((row) => ({ ...row, origin }));
}

export type ValueMapIssue = { level: "warn" | "error"; message: string };

/** 대조표에 값이 비어 채널로 그대로 나가는 항목을 알려준다 */
export function inspectValueRules(
  rows: CanonicalRow[],
  rules: ValueRule[],
  channelId: string,
  channelLabel: string,
): ValueMapIssue[] {
  const missing = new Map<string, number>();
  for (const row of rows) {
    for (const { rule, missing: isMissing } of matchRules(row, rules, channelId)) {
      if (isMissing) missing.set(rule.label, (missing.get(rule.label) ?? 0) + 1);
    }
  }
  if (!missing.size) return [];
  const hasCategory = [...missing.keys()].some((l) => rules.find((r) => r.label === l)?.fieldId === "category");
  // 내보내기를 막지는 않는다. 값을 못 채웠어도 원본 값으로 나가는 편이 아무것도 못 하는 것보다 낫다.
  // 다만 카테고리는 틀려도 에러가 안 나는 항목이라 문구를 강하게 쓴다.
  return [
    {
      level: "warn",
      message:
        `${channelLabel} 대조표가 비어 있습니다: ${[...missing.entries()].map(([l, n]) => `${l}(${n}건)`).join(", ")}. ` +
        (hasCategory
          ? "카테고리는 틀려도 오류가 안 나고 조용히 잘못 등록됩니다. 대조표에 채널 코드를 넣어 주세요."
          : "원본 값이 그대로 나갑니다."),
    },
  ];
}

// ── 저장 ──────────────────────────────────────────────────────────────────

export function loadRules(): ValueRule[] {
  if (typeof window === "undefined") return DEFAULT_RULES;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_RULES;
    const parsed = JSON.parse(raw) as ValueRule[];
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveRules(rules: ValueRule[]): void {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(rules));
}

export function newRule(fieldId = "category"): ValueRule {
  return { id: `r-${Date.now().toString(36)}`, fieldId, label: "", keywords: [], byChannel: {} };
}

/** 대조표에서 값을 채운 칸 수 (진행 상황 표시용) */
export function filledCount(rules: ValueRule[], channelIds: string[]): { filled: number; total: number } {
  let filled = 0;
  for (const r of rules) for (const c of channelIds) if (String(r.byChannel[c] ?? "").trim()) filled += 1;
  return { filled, total: rules.length * channelIds.length };
}
