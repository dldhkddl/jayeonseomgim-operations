import { parseNumberLike, type CanonicalRow } from "./canonical.ts";

export type CoupangCellOverride = {
  handled: boolean;
  value?: unknown;
  type?: "text" | "longtext" | "number";
};

export type CoupangCellContext = {
  previousSeedValue?: unknown;
};

const DEFAULT_AS_PHONE = "010-0000-1246";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function acceptedBrandId(value: unknown): string {
  const brand = text(value);
  if (brand === "브랜드 없음" || /^[A-Z]{2}-\d+$/.test(brand)) return brand;
  return "브랜드 없음";
}

function agriculturalNoticeValues(row: CanonicalRow): Array<string | undefined> {
  const productName = text(row.productName);
  const weight = text(row.weightSpec) || "상품 상세설명 참조";
  const manufacturer = text(row.manufacturer) || text(row.brand) || "판매자 별도표기";
  return [
    productName,
    weight,
    manufacturer,
    "국산",
    text(row.expiry) || "상품 상세설명 참조",
    "상품 상세설명 참조",
    "해당사항 없음",
    text(row.weightSpec) || productName || "상품 상세설명 참조",
    text(row.storage) || "냉장보관",
    "신선식품 특성상 수령 후 즉시 상태를 확인해 주세요.",
    text(row.asPhone) || DEFAULT_AS_PHONE,
    undefined,
    undefined,
    undefined,
  ];
}

/** 쿠팡 sellertool의 드롭다운/필수값 표기를 정확한 업로드 값으로 변환한다. */
export function resolveCoupangSellertoolValue(
  header: string,
  row: CanonicalRow,
  context: CoupangCellContext = {},
): CoupangCellOverride {
  const normalized = header.replace(/\s+/g, "");
  if (normalized === "추가이미지") {
    const images = text(row.extraImages)
      .split(/[\r\n,]+/)
      .map((url) => url.trim())
      .filter(Boolean);
    return { handled: true, value: images.join(","), type: "longtext" };
  }
  if (normalized === "옵션값1" && /^수량\s*[\r\n]*\[필수\]/.test(text(context.previousSeedValue))) {
    return { handled: true, value: "1개", type: "text" };
  }
  if (normalized === "상품상태") return { handled: true, value: "새상품", type: "text" };
  if (normalized === "브랜드ID") return { handled: true, value: acceptedBrandId(row.brand), type: "text" };
  if (normalized === "할인율기준가") return { handled: true, value: row.price, type: "number" };
  if (normalized === "재고수량") {
    const stock = parseNumberLike(String(row.stock ?? ""));
    return { handled: true, value: stock && stock > 0 ? stock : 30, type: "number" };
  }
  if (normalized === "출고리드타임") return { handled: true, value: 1, type: "number" };
  if (normalized === "과세여부") return { handled: true, value: "N", type: "text" };

  const noticeMatch = normalized.match(/^상품고시정보값(\d{1,2})$/);
  if (noticeMatch && text(row.infoNoticeGroup) === "농수축산물") {
    const index = Number(noticeMatch[1]) - 1;
    return { handled: true, value: agriculturalNoticeValues(row)[index], type: "text" };
  }
  return { handled: false };
}
