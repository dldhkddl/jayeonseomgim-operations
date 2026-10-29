import assert from "node:assert/strict";
import test from "node:test";

import * as deletion from "../app/lib/inventory/product-deletion.ts";

test("accepts only the exact permanent deletion confirmation phrase", () => {
  assert.equal(typeof deletion.isExactProductDeletionConfirmation, "function");
  if (typeof deletion.isExactProductDeletionConfirmation !== "function") return;

  assert.equal(deletion.isExactProductDeletionConfirmation("확인했습니다."), true);
  assert.equal(deletion.isExactProductDeletionConfirmation("확인했습니다"), false);
  assert.equal(deletion.isExactProductDeletionConfirmation(" 확인했습니다."), false);
  assert.equal(deletion.isExactProductDeletionConfirmation("확인했습니다. "), false);
  assert.equal(deletion.isExactProductDeletionConfirmation("확인햇습니다."), false);
});

test("builds the permanent deletion request with the channel product owner id", () => {
  assert.equal(typeof deletion.buildProductDeletionRequest, "function");
  if (typeof deletion.buildProductDeletionRequest !== "function") return;

  assert.deepEqual(
    deletion.buildProductDeletionRequest(
      { channel: "naver", originProductNo: "90123" },
      deletion.PRODUCT_DELETION_CONFIRMATION,
    ),
    {
      url: "/api/naver/products/delete",
      body: {
        originProductNo: "90123",
        confirmation: deletion.PRODUCT_DELETION_CONFIRMATION,
      },
    },
  );

  assert.deepEqual(
    deletion.buildProductDeletionRequest(
      { channel: "coupang", originProductNo: "70045" },
      deletion.PRODUCT_DELETION_CONFIRMATION,
    ),
    {
      url: "/api/coupang/products/delete",
      body: {
        sellerProductId: "70045",
        confirmation: deletion.PRODUCT_DELETION_CONFIRMATION,
      },
    },
  );
});
