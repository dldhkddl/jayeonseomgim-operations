import type { Product } from "../products.ts";
import type { CanonicalRow } from "./canonical.ts";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedName(value: unknown): string {
  return text(value).toLowerCase().replace(/[\s\-_()[\]{}]+/g, "");
}

function uniqueIndex(products: Product[], field: "channelProductNo" | "sellerProductCode") {
  const grouped = new Map<string, Product[]>();
  for (const product of products) {
    const key = text(product.data[field]);
    if (key) grouped.set(key, [...(grouped.get(key) ?? []), product]);
  }
  return new Map([...grouped].filter(([, matches]) => matches.length === 1).map(([key, matches]) => [key, matches[0]]));
}

function uniqueNameIndex(products: Product[]) {
  const grouped = new Map<string, Product[]>();
  for (const product of products) {
    const key = normalizedName(product.data.productName);
    if (key) grouped.set(key, [...(grouped.get(key) ?? []), product]);
  }
  return new Map([...grouped].filter(([, matches]) => matches.length === 1).map(([key, matches]) => [key, matches[0]]));
}

function productSupplement(product: Product): CanonicalRow {
  const roles = product.imageRoles ?? {};
  const cover = product.images.find((src) => roles[src] === "cover") ?? product.images[0];
  const detailImages = product.images.filter((src) => roles[src] === "detail");
  const additionalImages = product.images.filter((src) => src !== cover && roles[src] !== "detail");
  return {
    ...product.data,
    mainImage: text(product.data.mainImage) || cover,
    extraImages: text(product.data.extraImages) || additionalImages.join("\n"),
    detailImage: text(product.data.detailImage) || detailImages.join("\n"),
  };
}

/** 엑셀에 없는 값만 상품 관리의 저장본으로 보완한다. 엑셀의 명시적인 값은 덮어쓰지 않는다. */
export function enrichImportedRowsFromProducts(rows: CanonicalRow[], products: Product[]): CanonicalRow[] {
  const byChannelNo = uniqueIndex(products, "channelProductNo");
  const bySellerCode = uniqueIndex(products, "sellerProductCode");
  const byName = uniqueNameIndex(products);

  return rows.map((row) => {
    const match = byChannelNo.get(text(row.channelProductNo))
      ?? bySellerCode.get(text(row.sellerProductCode))
      ?? byName.get(normalizedName(row.productName));
    if (!match) return row;

    const next: CanonicalRow = { ...row };
    for (const [field, value] of Object.entries(productSupplement(match))) {
      if (!text(next[field]) && text(value)) next[field] = value;
    }
    return next;
  });
}
