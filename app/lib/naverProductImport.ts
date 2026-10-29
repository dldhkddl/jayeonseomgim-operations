import type { CanonicalRow } from "./channels/canonical.ts";

export type NaverImportedDetails = {
  originProductNo: string;
  detailContent: string;
  mainImage: string;
  extraImages: string;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

/** 네이버 채널상품 조회 응답에서 편집기에 필요한 부분만 꺼낸다. */
export function extractNaverImportedDetails(payload: unknown): NaverImportedDetails | null {
  const response = record(payload);
  const root = record(response.data ?? response);
  const originProduct = record(root.originProduct);
  const images = record(originProduct.images);
  const representative = record(images.representativeImage);
  const optionalImages = Array.isArray(images.optionalImages) ? images.optionalImages : [];
  const detailContent = String(originProduct.detailContent ?? "").trim();
  if (!detailContent && !representative.url && !optionalImages.length) return null;

  return {
    originProductNo: String(root.originProductNo ?? ""),
    detailContent,
    mainImage: String(representative.url ?? ""),
    extraImages: optionalImages.map((image) => String(record(image).url ?? "")).filter(Boolean).join("\n"),
  };
}

/** 엑셀 값을 우선 보존하고 비어 있는 상세설명/이미지만 네이버 조회 결과로 채운다. */
export function applyNaverImportedDetails(
  rows: CanonicalRow[],
  detailsByChannelProductNo: Record<string, NaverImportedDetails>,
): CanonicalRow[] {
  return rows.map((row) => {
    const channelProductNo = String(row.channelProductNo ?? "").trim();
    const details = detailsByChannelProductNo[channelProductNo];
    if (!details) return row;
    return {
      ...row,
      originProductNo: details.originProductNo,
      detailContent: String(row.detailContent ?? "").trim() || details.detailContent,
      mainImage: String(row.mainImage ?? "").trim() || details.mainImage,
      extraImages: String(row.extraImages ?? "").trim() || details.extraImages,
    };
  });
}
