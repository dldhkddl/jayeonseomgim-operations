import assert from "node:assert/strict";
import test from "node:test";

import {
  loadSharedProducts,
  saveSharedProducts,
  type SharedProductState,
} from "../app/lib/shared-product-storage.ts";
import type { Product } from "../app/lib/products.ts";

const localProducts = [{ id: "local-1", data: { productName: "로컬 상품" }, images: [] }] as Product[];
const serverProducts = [{ id: "server-1", data: { productName: "공용 상품" }, images: [] }] as Product[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("공용 저장이 초기화되어 있으면 새 창은 서버 상품을 우선 사용한다", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse({ initialized: true, products: serverProducts } satisfies SharedProductState);
  };

  const result = await loadSharedProducts(localProducts, fetcher);

  assert.deepEqual(result, serverProducts);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init, undefined);
});

test("첫 실행이면 현재 브라우저 상품을 공용 저장소로 한 번 이전한다", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (!init) return jsonResponse({ initialized: false, products: [] } satisfies SharedProductState);
    return jsonResponse({ ok: true });
  };

  const result = await loadSharedProducts(localProducts, fetcher);

  assert.deepEqual(result, localProducts);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { products: localProducts });
});

test("공용 저장소가 일시적으로 실패해도 브라우저 백업을 유지한다", async () => {
  const result = await loadSharedProducts(localProducts, async () => {
    throw new Error("offline");
  });

  assert.deepEqual(result, localProducts);
});

test("상품 수정은 공용 저장 API에 전체 목록을 저장한다", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  await saveSharedProducts(serverProducts, async (url, init) => {
    request = { url, init };
    return jsonResponse({ ok: true });
  });

  assert.equal(request?.url, "/api/products");
  assert.equal(request?.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { products: serverProducts });
});
