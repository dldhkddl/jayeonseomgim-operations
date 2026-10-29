/**
 * 상품 저장소
 *
 * 화면의 중심은 "상품 하나"가 아니라 "상품 목록"이다.
 * 새로 만든 상품이든 엑셀에서 가져온 상품이든 전부 여기로 합류하고,
 * 내보내기는 목록에서 고른 것만 대상으로 한다.
 *
 * 저장 위치: 이 컴퓨터의 이 브라우저 (localStorage)
 *   설정이 필요 없어 바로 쓸 수 있다. 다른 기기와 공유하려면 나중에 서버 저장으로 바꾸면 되는데,
 *   그때도 이 파일의 함수 시그니처만 유지하면 화면 코드는 안 건드려도 된다.
 */

import type { CanonicalRow } from "./channels/canonical";
import type { DetailTheme } from "./premiumDetail";

export type ImageRole = "cover" | "detail";

export type Product = {
  id: string;
  /** 공통 스키마 값 (44개 항목 중 채워진 것) */
  data: CanonicalRow;
  /** 상품 사진. 업로드 전엔 blob:, 업로드 후엔 공개 URL */
  images: string[];
  /**
   * 사진별 역할(표지/상세) 태그. 키는 images 배열 안의 URL.
   * 태그가 없으면 첫 장만 표지이며 나머지는 채널 추가 이미지다.
   */
  imageRoles?: Partial<Record<string, ImageRole>>;
  /** 대표 사진에서 추출한 프리미엄 상세페이지 색상 */
  detailTheme?: DetailTheme;
  createdAt: string;
  updatedAt: string;
};

// ── 사진 역할(표지·상세) ─────────────────────────────────────────────────

/**
 * 표지·상세로 태그된 사진을 앞으로 오도록 정렬한다.
 * 태그가 하나도 없으면 원래 순서 그대로 (첫 장=표지, 둘째 장=상세라는 기존 규칙과 동일하게 동작).
 */
export function orderedImages(p: Pick<Product, "images" | "imageRoles">): string[] {
  const roles = p.imageRoles ?? {};
  const cover = p.images.find((src) => roles[src] === "cover");
  const details = p.images.filter((src) => roles[src] === "detail");
  if (!cover && !details.length) return p.images;
  const rest = p.images.filter((src) => src !== cover && !details.includes(src));
  return [cover, ...details, ...rest].filter((x): x is string => Boolean(x));
}

/** 사용자가 상세로 명시한 사진만 원래 순서대로 반환한다. */
export function productDetailImages(p: Pick<Product, "images" | "imageRoles">): string[] {
  return p.images.filter((src) => p.imageRoles?.[src] === "detail");
}

/** 자동 상세페이지에는 대표 이미지와 사용자가 상세로 고른 이미지만 넣는다. */
export function detailPageImages(p: Pick<Product, "images" | "imageRoles">): string[] {
  const representative = orderedImages(p)[0];
  return [...new Set([representative, ...productDetailImages(p)].filter((src): src is string => Boolean(src)))];
}

/** 대표는 한 장만, 상세는 사진마다 독립적으로 선택·해제한다. */
export function toggleProductImageRole(
  state: Pick<Product, "images" | "imageRoles">,
  src: string,
  role: ImageRole,
): Pick<Product, "images" | "imageRoles"> {
  const imageRoles = { ...(state.imageRoles ?? {}) };
  if (!state.images.includes(src)) return { images: [...state.images], imageRoles };

  if (role === "cover") {
    for (const key of Object.keys(imageRoles)) {
      if (imageRoles[key] === "cover") delete imageRoles[key];
    }
    imageRoles[src] = "cover";
  } else if (imageRoles[src] === "detail") {
    delete imageRoles[src];
  } else if (imageRoles[src] !== "cover") {
    imageRoles[src] = "detail";
  }

  return { images: [...state.images], imageRoles };
}

/** 사진 한 장을 배열 안의 새 위치로 옮긴다. URL 기반 역할 태그는 그대로 유지된다. */
export function moveProductImage(
  state: Pick<Product, "images" | "imageRoles">,
  fromIndex: number,
  toIndex: number,
): Pick<Product, "images" | "imageRoles"> {
  const images = [...state.images];
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= images.length || toIndex >= images.length || fromIndex === toIndex) {
    return { images, imageRoles: state.imageRoles ? { ...state.imageRoles } : undefined };
  }
  const [moved] = images.splice(fromIndex, 1);
  images.splice(toIndex, 0, moved);
  return { images, imageRoles: state.imageRoles ? { ...state.imageRoles } : undefined };
}

/** 새로 고른 사진을 앞에 놓고 첫 장을 대표로 지정한다. 기존 상세 역할은 유지한다. */
export function addProductImages(
  state: Pick<Product, "images" | "imageRoles">,
  sources: string[],
  maxImages = 10,
): Pick<Product, "images" | "imageRoles"> {
  const availableSlots = Math.max(0, maxImages - state.images.length);
  const added = sources.filter(Boolean).slice(0, availableSlots);
  if (!added.length) {
    return {
      images: [...state.images],
      imageRoles: state.imageRoles ? { ...state.imageRoles } : undefined,
    };
  }

  const imageRoles = { ...(state.imageRoles ?? {}) };
  for (const src of Object.keys(imageRoles)) {
    if (imageRoles[src] === "cover") delete imageRoles[src];
  }
  imageRoles[added[0]] = "cover";

  return {
    images: [...added, ...state.images],
    imageRoles,
  };
}

/** 첫 장은 대표로 표시하고, 상세는 사용자가 명시한 경우에만 표시한다. */
export function effectiveImageRole(p: Pick<Product, "images" | "imageRoles">, src: string): ImageRole | undefined {
  const assigned = p.imageRoles?.[src];
  if (assigned) return assigned;
  const ordered = orderedImages(p);
  if (ordered[0] === src) return "cover";
  return undefined;
}

const KEY = "damda.products.v1";
const MAX_BYTES = 4_000_000;

// ── 화면 입력폼 ↔ 공통 스키마 ─────────────────────────────────────────────

/** 기존 입력 폼이 쓰던 10개 항목 */
export type EditorFields = {
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

/** 입력 폼 항목 ↔ 공통 스키마 필드 대응 */
const FIELD_MAP: Record<keyof EditorFields, string> = {
  name: "productName",
  variety: "variety",
  origin: "origin",
  weight: "weightSpec",
  price: "price",
  stock: "stock",
  shipping: "deliveryFeeType",
  producer: "manufacturer",
  storage: "storage",
  feature: "feature",
};

export function toEditorFields(data: CanonicalRow): EditorFields {
  const out = {} as EditorFields;
  for (const [k, fieldId] of Object.entries(FIELD_MAP) as [keyof EditorFields, string][]) {
    out[k] = String(data[fieldId] ?? "");
  }
  return out;
}

/** 폼에서 바꾼 값을 공통 스키마에 반영. 폼에 없는 항목(고시·배송비 등)은 그대로 둔다. */
export function applyEditorFields(data: CanonicalRow, fields: EditorFields): CanonicalRow {
  const next: CanonicalRow = { ...data };
  for (const [k, fieldId] of Object.entries(FIELD_MAP) as [keyof EditorFields, string][]) {
    next[fieldId] = fields[k];
  }
  return next;
}

// ── 만들기 ────────────────────────────────────────────────────────────────

function newId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const now = () => new Date().toISOString();

export function newProduct(seed?: Partial<Product>): Product {
  return {
    id: newId(),
    data: {
      productName: "",
      taxType: "면세",
      productCondition: "신상품",
      minorPurchase: "구매 가능",
      saleStatus: "판매중",
      channelExpose: "노출함",
      infoNoticeGroup: "농수축산물",
      greenCertificationId: "EXCLUDED",
      deliveryType: "택배",
      ...seed?.data,
    },
    images: seed?.images ?? [],
    createdAt: now(),
    updatedAt: now(),
  };
}

/** 편집 화면에서는 모든 채널 상품 이미지를 대표·추가·상세 중 하나로 명확히 표시한다. */
export function productImageLabel(p: Pick<Product, "images" | "imageRoles">, src: string): "대표" | "추가" | "상세" {
  const role = effectiveImageRole(p, src);
  if (role === "cover") return "대표";
  if (role === "detail") return "상세";
  return "추가";
}

/** 상품 미리보기 갤러리는 대표 이미지와 모든 추가 이미지를 채널 전송 순서대로 쓴다. */
export function productGalleryImages(p: Pick<Product, "images" | "imageRoles">): string[] {
  return orderedImages(p);
}

function splitImageValues(value: unknown): string[] {
  return String(value ?? "")
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 가져온 엑셀 행들을 상품으로 변환 */
export function productsFromRows(rows: CanonicalRow[]): Product[] {
  return rows.map((data) => {
    const p = newProduct();
    const mainImages = splitImageValues(data.mainImage);
    const extraImages = splitImageValues(data.extraImages);
    const images = [...new Set([...mainImages, ...extraImages])];
    const cover = mainImages[0] ?? images[0];
    const imageRoles: Partial<Record<string, ImageRole>> = {};
    if (cover) imageRoles[cover] = "cover";
    return {
      ...p,
      data: { ...p.data, ...data },
      images,
      imageRoles: Object.keys(imageRoles).length ? imageRoles : undefined,
    };
  });
}

export function duplicateProduct(p: Product): Product {
  const name = String(p.data.productName ?? "상품");
  return {
    ...p,
    id: newId(),
    data: {
      ...p.data,
      productName: `${name} 복사본`,
      // 상품코드가 겹치면 채널에서 기존 상품을 덮어쓴다. 반드시 비운다.
      sellerProductCode: "",
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

// ── 목록 조작 ─────────────────────────────────────────────────────────────

export function upsert(list: Product[], product: Product): Product[] {
  const next = { ...product, updatedAt: now() };
  const i = list.findIndex((p) => p.id === product.id);
  if (i < 0) return [...list, next];
  const copy = [...list];
  copy[i] = next;
  return copy;
}

export function removeMany(list: Product[], ids: string[]): Product[] {
  const drop = new Set(ids);
  return list.filter((p) => !drop.has(p.id));
}

export function searchProducts(list: Product[], query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((p) =>
    ["productName", "variety", "origin", "sellerProductCode", "weightSpec"].some((f) =>
      String(p.data[f] ?? "").toLowerCase().includes(q),
    ),
  );
}

export type DuplicateCodeGroup = {
  code: string;
  productIds: string[];
};

/** 상품코드별로 채널 덮어쓰기 위험이 있는 모든 상품을 묶는다. */
export function duplicateCodeGroups(list: Product[]): DuplicateCodeGroup[] {
  const byCode = new Map<string, string[]>();
  for (const p of list) {
    const code = String(p.data.sellerProductCode ?? "").trim();
    if (!code) continue;
    byCode.set(code, [...(byCode.get(code) ?? []), p.id]);
  }
  return [...byCode.entries()]
    .filter(([, productIds]) => productIds.length > 1)
    .map(([code, productIds]) => ({ code, productIds }));
}

/** 상품코드가 겹치면 채널에서 덮어쓰기 사고가 난다. 목록 전체를 훑어 알려준다. */
export function duplicateCodes(list: Product[]): string[] {
  return duplicateCodeGroups(list).map((group) => group.code);
}

export const productLabel = (p: Product): string => String(p.data.productName ?? "").trim() || "(이름 없는 상품)";

// ── 저장 ──────────────────────────────────────────────────────────────────

/**
 * blob: URL은 저장해봐야 새로고침하면 죽는다. 저장 전에 걸러낸다.
 * (업로드해서 공개 URL이 된 사진만 남는다)
 */
function persistableImages(images: string[]): string[] {
  return images.filter((src) => !/^(blob:|data:)/i.test(src));
}

/** 살아남은 사진 주소에 대한 역할 태그만 남긴다 (지워진 사진의 태그는 버림) */
function persistableRoles(
  images: string[],
  roles: Partial<Record<string, ImageRole>> | undefined,
): Partial<Record<string, ImageRole>> | undefined {
  if (!roles) return undefined;
  const kept = new Set(images);
  const next: Partial<Record<string, ImageRole>> = {};
  for (const [src, role] of Object.entries(roles)) {
    if (role && kept.has(src)) next[src] = role;
  }
  return Object.keys(next).length ? next : undefined;
}

export function loadProducts(): Product[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as Product[];
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p.id === "string") : [];
  } catch {
    return [];
  }
}

export function saveProducts(list: Product[]): { ok: boolean; message?: string } {
  if (typeof window === "undefined") return { ok: false };
  const slim = list.map((p) => {
    const images = persistableImages(p.images);
    return { ...p, images, imageRoles: persistableRoles(images, p.imageRoles) };
  });
  const json = JSON.stringify(slim);
  if (json.length > MAX_BYTES) {
    return { ok: false, message: "저장 용량을 넘었습니다. 오래된 상품을 정리해 주세요." };
  }
  try {
    window.localStorage.setItem(KEY, json);
    return { ok: true };
  } catch {
    return { ok: false, message: "브라우저 저장에 실패했습니다." };
  }
}
