import assert from "node:assert/strict";
import test from "node:test";

import { replaceProductDetail } from "../app/lib/detail-editor.ts";
import { newProduct } from "../app/lib/products.ts";

test("updates only the selected product detail", () => {
  // Catches: saving one editor draft overwriting every selected product.
  const first = { ...newProduct({ data: { detailContent: "<p>첫 상품</p>" } }), id: "a" };
  const second = { ...newProduct({ data: { detailContent: "<p>둘째 상품</p>" } }), id: "b" };
  const next = replaceProductDetail([first, second], "b", "<p>수정본</p>");

  assert.equal(next[0].data.detailContent, "<p>첫 상품</p>");
  assert.equal(next[1].data.detailContent, "<p>수정본</p>");
  assert.equal(next[1].id, "b");
  assert.notEqual(next[1], second);
});

test("sanitizes detail HTML when saving the selected product", () => {
  // Catches: the state update path bypassing the sanitizer.
  const product = { ...newProduct(), id: "peach" };
  const [saved] = replaceProductDetail([product], "peach", '<p onclick="bad()">수정</p><script>bad()</script>');

  assert.equal(saved.data.detailContent, "<p>수정</p>");
});
