import type { Product } from "./products.ts";

export type SharedProductState = {
  initialized: boolean;
  products: Product[];
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

export async function saveSharedProducts(products: Product[], fetcher: Fetcher = defaultFetcher): Promise<void> {
  const response = await fetcher("/api/products", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ products }),
  });
  if (!response.ok) throw new Error("공용 상품 저장에 실패했습니다.");
}

export async function loadSharedProducts(localProducts: Product[], fetcher: Fetcher = defaultFetcher): Promise<Product[]> {
  try {
    const response = await fetcher("/api/products");
    if (!response.ok) return localProducts;
    const state = await response.json() as SharedProductState;
    if (state.initialized) return Array.isArray(state.products) ? state.products : localProducts;
    if (localProducts.length) await saveSharedProducts(localProducts, fetcher);
    return localProducts;
  } catch {
    return localProducts;
  }
}
