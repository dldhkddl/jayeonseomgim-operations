/**
 * 채널 등록부 + 저장된 양식(매핑) 관리 + 상품 → 공통 행 변환
 */

import type { CanonicalRow } from "./canonical";
import type { TemplateAnalysis } from "./mapping";

export type Channel = {
  id: string;
  label: string;
  hint: string;
};

export const CHANNELS: Channel[] = [
  { id: "smartstore", label: "스마트스토어", hint: "판매자센터 › 상품관리 › 상품 일괄등록 › 엑셀 양식 다운로드" },
  { id: "coupang", label: "쿠팡", hint: "Wing › 상품관리 › 상품 일괄등록 › 엑셀 양식 다운로드" },
  { id: "cafe24", label: "카페24", hint: "관리자 › 상품관리 › 상품 엑셀 관리 › 엑셀 양식 다운로드" },
  { id: "11st", label: "11번가", hint: "셀러오피스 › 상품관리 › 대량등록 › 엑셀 양식 다운로드" },
];

// ── 저장 (브라우저 localStorage) ──────────────────────────────────────────

const STORE_KEY = "damda.channelTemplates.v1";
/** 양식 원본을 base64로 들고 있으므로 채널당 상한을 둔다 */
const MAX_TEMPLATE_BYTES = 2_000_000;

export type TemplateStore = Record<string, TemplateAnalysis>;

export function loadTemplates(): TemplateStore {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}") as TemplateStore;
  } catch {
    return {};
  }
}

export function saveTemplate(analysis: TemplateAnalysis): { ok: boolean; message?: string } {
  if (typeof window === "undefined") return { ok: false, message: "브라우저에서만 저장됩니다." };
  if (analysis.templateBase64.length > MAX_TEMPLATE_BYTES) {
    return { ok: false, message: "양식 파일이 너무 큽니다(2MB 초과). 안내 시트를 지운 뒤 다시 올려 주세요." };
  }
  try {
    const store = loadTemplates();
    store[analysis.channelId] = analysis;
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return { ok: true };
  } catch {
    return { ok: false, message: "브라우저 저장 공간이 부족합니다. 사용하지 않는 채널 양식을 삭제해 주세요." };
  }
}

export function removeTemplate(channelId: string): void {
  if (typeof window === "undefined") return;
  const store = loadTemplates();
  delete store[channelId];
  window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

/** 매핑만 따로 백업/공유할 때 (양식 원본 제외) */
export function exportMappingJson(analysis: TemplateAnalysis): string {
  const rest: Record<string, unknown> = { ...analysis };
  delete rest.templateBase64;
  return JSON.stringify(rest, null, 2);
}

// ── 상품 입력값 → 공통 스키마 행 ──────────────────────────────────────────

export type EditorProduct = {
  name: string;
  variety: string;
  origin: string;
  weight: string;
  price: string;
  stock: string;
  shipping: string;
  producer: string;
  storage: string;
  feature: string;
};

export type OptionInput = {
  /** 예: "1kg", "3kg 선물세트" */
  label: string;
  price?: string;
  stock?: string;
};

export type BuildRowsInput = {
  product: EditorProduct;
  /** AI가 만든 상품명·요약 */
  copy?: { title?: string; summary?: string; points?: string[] };
  images?: string[];
  /** 용량별 옵션. 비어 있으면 단일 행 */
  options?: OptionInput[];
  /** 코드 접두어. 예: "PB" → PB-0001 */
  codePrefix?: string;
  /** 채널·상품 공통 기본값 (출고지, A/S 전화 등) */
  defaults?: Partial<CanonicalRow>;
};

function slugCode(prefix: string, index: number): string {
  return `${prefix || "PB"}-${String(index + 1).padStart(3, "0")}`;
}

function onlyDigits(v: string | undefined): string {
  return String(v ?? "").replace(/[^0-9.-]/g, "");
}

/**
 * 화면 입력값을 공통 스키마 행으로 변환한다.
 * 옵션(용량)이 여러 개면 옵션 수만큼 행을 만든다.
 */
export function buildCanonicalRows(input: BuildRowsInput): CanonicalRow[] {
  const { product, copy, images = [], options = [], codePrefix = "PB", defaults = {} } = input;

  const base: CanonicalRow = {
    productName: copy?.title?.trim() || product.name,
    variety: product.variety,
    origin: product.origin,
    manufacturer: product.producer,
    weightSpec: product.weight,
    price: onlyDigits(product.price),
    stock: onlyDigits(product.stock),
    storage: product.storage,
    feature: product.feature,
    detailContent: [copy?.summary, ...(copy?.points ?? [])].filter(Boolean).join("\n") || product.feature,
    mainImage: images[0] ?? "",
    extraImages: images.slice(1).join(","),
    deliveryFeeType: product.shipping,
    deliveryType: "택배",
    taxType: "면세",
    productCondition: "신상품",
    minorPurchase: "구매 가능",
    saleStatus: "판매중",
    channelExpose: "노출함",
    infoNoticeGroup: "농수축산물",
    keywords: [product.variety, product.origin, product.name].filter(Boolean).join(","),
    ...defaults,
  };

  if (!options.length) {
    return [{ ...base, sellerProductCode: base.sellerProductCode ?? slugCode(codePrefix, 0) }];
  }

  return options.map((opt, i) => ({
    ...base,
    sellerProductCode: slugCode(codePrefix, i),
    productName: `${base.productName}${opt.label ? ` ${opt.label}` : ""}`,
    optionName: "중량",
    optionValue: opt.label,
    weightSpec: opt.label || base.weightSpec,
    price: onlyDigits(opt.price) || base.price,
    stock: onlyDigits(opt.stock) || base.stock,
    optionStock: onlyDigits(opt.stock) || base.stock,
  }));
}
