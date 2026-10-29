import assert from "node:assert/strict";
import test from "node:test";
import * as products from "../app/lib/products.ts";
import type { Product } from "../app/lib/products.ts";

const duplicateCodeGroups = (products as typeof products & {
  duplicateCodeGroups?: (list: Product[]) => Array<{ code: string; productIds: string[] }>;
}).duplicateCodeGroups;

function product(id: string, code: string): Product {
  return {
    id,
    data: { productName: id, sellerProductCode: code },
    images: [],
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

test("groups every product affected by the same duplicate code", () => {
  assert.equal(typeof duplicateCodeGroups, "function");
  assert.deepEqual(
    duplicateCodeGroups?.([
      product("apple-1", "PE-YE-2"),
      product("apple-2", "PE-YE-2"),
      product("apple-3", "PE-YE-2"),
      product("pear-1", "PE-YE-4"),
      product("pear-2", "PE-YE-4"),
    ]),
    [
      { code: "PE-YE-2", productIds: ["apple-1", "apple-2", "apple-3"] },
      { code: "PE-YE-4", productIds: ["pear-1", "pear-2"] },
    ],
  );
});

test("ignores blank and unique product codes", () => {
  assert.equal(typeof duplicateCodeGroups, "function");
  assert.deepEqual(
    duplicateCodeGroups?.([
      product("blank-1", ""),
      product("blank-2", "   "),
      product("unique", "ONLY-1"),
    ]),
    [],
  );
});
