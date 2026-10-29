/**
 * 판매자 기본값 (Seller Defaults)
 *
 * 상품마다 바뀌지 않는 값들 — 출고지, A/S 전화, 반품비, 고시 상품군 등.
 * 한 번 입력해두면 모든 상품·모든 채널 엑셀에 자동으로 들어간다.
 *
 * 규칙: 기본값은 "빈 칸만" 채운다. 상품에 이미 값이 있으면 절대 덮어쓰지 않는다.
 *       (덮어쓰면 개별 상품의 예외 설정이 조용히 사라진다)
 */

import { CANONICAL_BY_ID } from "./canonical";

export type SellerDefaults = Record<string, string>;

/** 기본값으로 두는 게 타당한 필드만 추린 목록. 상품마다 달라지는 값(상품명·가격·재고)은 제외. */
export const DEFAULT_GROUPS: { title: string; hint: string; fieldIds: string[] }[] = [
  {
    title: "배송",
    hint: "택배사·배송비 정책은 상품이 바뀌어도 그대로인 경우가 대부분입니다.",
    fieldIds: ["deliveryType", "deliveryCompany", "deliveryFeeType", "deliveryFee", "shipFromAddress"],
  },
  {
    title: "반품·교환",
    hint: "채널 대부분이 필수로 요구합니다. 비어 있으면 등록이 반려됩니다.",
    fieldIds: ["returnFee", "exchangeFee", "returnAddress"],
  },
  {
    title: "고객 응대",
    hint: "상품정보제공고시의 소비자상담 항목으로도 쓰입니다.",
    fieldIds: ["asPhone", "asGuide"],
  },
  {
    title: "판매 조건",
    hint: "미가공 농산물은 보통 면세입니다.",
    fieldIds: ["taxType", "productCondition", "minorPurchase", "saleStatus", "channelExpose", "purchaseLimit"],
  },
  {
    title: "표시·고시",
    hint: "품목이 바뀌면 고시 상품군도 바뀔 수 있으니 확인하세요(생과일 vs 가공식품).",
    fieldIds: ["infoNoticeGroup", "brand", "manufacturer", "certification"],
  },
  {
    title: "기본 분류",
    hint: "상품별로 다르면 비워두고 상품 쪽에서 채우세요.",
    fieldIds: ["category"],
  },
];

export const DEFAULT_FIELD_IDS = DEFAULT_GROUPS.flatMap((g) => g.fieldIds);

/** 농산물 판매자가 대체로 그대로 쓰는 값. 주소·전화처럼 사람마다 다른 건 비워둔다. */
export const AGRI_PRESET: SellerDefaults = {
  deliveryType: "택배",
  deliveryFeeType: "무료배송",
  deliveryFee: "0",
  returnFee: "4000",
  exchangeFee: "8000",
  taxType: "면세",
  productCondition: "신상품",
  minorPurchase: "구매 가능",
  saleStatus: "판매중",
  channelExpose: "노출함",
  infoNoticeGroup: "농수축산물",
};

/** 이게 비면 대부분의 채널에서 등록이 막히는 항목 */
export const DEFAULT_REQUIRED_IDS = ["deliveryCompany", "shipFromAddress", "returnAddress", "asPhone", "infoNoticeGroup"];

// ── 저장 ──────────────────────────────────────────────────────────────────

const KEY = "damda.sellerDefaults.v1";

export function loadSellerDefaults(): SellerDefaults {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as SellerDefaults;
    // 스키마에서 사라진 필드는 버린다
    return Object.fromEntries(Object.entries(raw).filter(([k]) => CANONICAL_BY_ID[k]));
  } catch {
    return {};
  }
}

export function saveSellerDefaults(value: SellerDefaults): void {
  if (typeof window === "undefined") return;
  const clean = Object.fromEntries(Object.entries(value).filter(([, v]) => String(v ?? "").trim() !== ""));
  window.localStorage.setItem(KEY, JSON.stringify(clean));
}

export function countFilled(value: SellerDefaults): number {
  return Object.values(value).filter((v) => String(v ?? "").trim() !== "").length;
}

/** 아직 안 채운 필수 기본값 */
export function missingRequired(value: SellerDefaults): string[] {
  return DEFAULT_REQUIRED_IDS.filter((id) => String(value[id] ?? "").trim() === "");
}
