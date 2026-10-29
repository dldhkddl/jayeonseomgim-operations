import assert from "node:assert/strict";
import test from "node:test";
import * as products from "../app/lib/products.ts";
import type { ImageRole } from "../app/lib/products.ts";

type ImageState = {
  images: string[];
  imageRoles?: Partial<Record<string, ImageRole>>;
};

const addProductImages = (products as typeof products & {
  addProductImages?: (state: ImageState, sources: string[], maxImages?: number) => ImageState;
}).addProductImages;
const productDetailImages = (products as typeof products & {
  productDetailImages?: (state: ImageState) => string[];
}).productDetailImages;
const toggleProductImageRole = (products as typeof products & {
  toggleProductImageRole?: (state: ImageState, src: string, role: ImageRole) => ImageState;
}).toggleProductImageRole;
const moveProductImage = (products as typeof products & {
  moveProductImage?: (state: ImageState, fromIndex: number, toIndex: number) => ImageState;
}).moveProductImage;

test("puts newly uploaded images first and makes the first one the cover", () => {
  assert.equal(typeof addProductImages, "function");
  assert.deepEqual(
    addProductImages?.(
      {
        images: ["old-cover.jpg", "old-detail.jpg"],
        imageRoles: { "old-cover.jpg": "cover", "old-detail.jpg": "detail" },
      },
      ["new-first.jpg", "new-second.jpg"],
    ),
    {
      images: ["new-first.jpg", "new-second.jpg", "old-cover.jpg", "old-detail.jpg"],
      imageRoles: { "new-first.jpg": "cover", "old-detail.jpg": "detail" },
    },
  );
});

test("keeps the current image state when no upload slot remains", () => {
  assert.equal(typeof addProductImages, "function");
  const full = Array.from({ length: 10 }, (_, index) => `old-${index}.jpg`);
  assert.deepEqual(
    addProductImages?.({ images: full, imageRoles: { "old-0.jpg": "cover" } }, ["new.jpg"]),
    { images: full, imageRoles: { "old-0.jpg": "cover" } },
  );
});

test("orders every selected detail image after the cover", () => {
  assert.deepEqual(
    products.orderedImages({
      images: ["plain.jpg", "detail-1.jpg", "cover.jpg", "detail-2.jpg"],
      imageRoles: {
        "cover.jpg": "cover",
        "detail-1.jpg": "detail",
        "detail-2.jpg": "detail",
      },
    }),
    ["cover.jpg", "detail-1.jpg", "detail-2.jpg", "plain.jpg"],
  );
});

test("returns only explicitly selected detail images", () => {
  assert.equal(typeof productDetailImages, "function");
  assert.deepEqual(
    productDetailImages?.({
      images: ["cover.jpg", "detail-1.jpg", "plain.jpg", "detail-2.jpg"],
      imageRoles: {
        "cover.jpg": "cover",
        "detail-1.jpg": "detail",
        "detail-2.jpg": "detail",
      },
    }),
    ["detail-1.jpg", "detail-2.jpg"],
  );
  assert.deepEqual(
    productDetailImages?.({ images: ["legacy-cover.jpg", "legacy-detail.jpg", "plain.jpg"] }),
    [],
  );
});

test("builds detail pages from the representative image and explicitly selected detail images only", () => {
  assert.equal(typeof products.detailPageImages, "function");
  assert.deepEqual(
    products.detailPageImages?.({
      images: ["cover.jpg", "extra-1.jpg", "detail.jpg", "extra-2.jpg"],
      imageRoles: { "cover.jpg": "cover", "detail.jpg": "detail" },
    }),
    ["cover.jpg", "detail.jpg"],
  );
});

test("toggles detail images independently while keeping cover selection exclusive", () => {
  assert.equal(typeof toggleProductImageRole, "function");
  const initial: ImageState = {
    images: ["cover.jpg", "detail-1.jpg", "detail-2.jpg"],
    imageRoles: { "cover.jpg": "cover", "detail-1.jpg": "detail" },
  };
  const withTwoDetails = toggleProductImageRole?.(initial, "detail-2.jpg", "detail");
  assert.deepEqual(withTwoDetails?.imageRoles, {
    "cover.jpg": "cover",
    "detail-1.jpg": "detail",
    "detail-2.jpg": "detail",
  });
  assert.deepEqual(toggleProductImageRole?.(withTwoDetails!, "detail-1.jpg", "detail").imageRoles, {
    "cover.jpg": "cover",
    "detail-2.jpg": "detail",
  });
  assert.deepEqual(toggleProductImageRole?.(withTwoDetails!, "detail-2.jpg", "cover").imageRoles, {
    "detail-1.jpg": "detail",
    "detail-2.jpg": "cover",
  });
});

test("selecting a detail image does not silently select the second gallery image", () => {
  assert.equal(typeof toggleProductImageRole, "function");
  assert.deepEqual(
    toggleProductImageRole?.(
      {
        images: ["cover.jpg", "legacy-detail.jpg", "new-detail.jpg"],
        imageRoles: { "cover.jpg": "cover" },
      },
      "new-detail.jpg",
      "detail",
    ).imageRoles,
    {
      "cover.jpg": "cover",
      "new-detail.jpg": "detail",
    },
  );
});

test("unassigned gallery images stay additional instead of becoming detail images", () => {
  assert.equal(
    products.effectiveImageRole({
      images: ["cover.jpg", "extra-1.jpg", "extra-2.jpg"],
      imageRoles: { "cover.jpg": "cover" },
    }, "extra-1.jpg"),
    undefined,
  );
});

test("labels every gallery image as representative, additional, or detail", () => {
  const product = {
    images: ["cover.jpg", "extra.jpg", "detail.jpg"],
    imageRoles: { "cover.jpg": "cover", "detail.jpg": "detail" } as const,
  };

  assert.equal(products.productImageLabel?.(product, "cover.jpg"), "대표");
  assert.equal(products.productImageLabel?.(product, "extra.jpg"), "추가");
  assert.equal(products.productImageLabel?.(product, "detail.jpg"), "상세");
});

test("uses every ordered product image in the clickable product gallery", () => {
  const product = {
    images: ["extra-2.jpg", "cover.jpg", "extra-1.jpg"],
    imageRoles: { "cover.jpg": "cover" } as const,
  };

  assert.deepEqual(products.productGalleryImages?.(product), ["cover.jpg", "extra-2.jpg", "extra-1.jpg"]);
});

test("moves an image without losing its assigned roles", () => {
  assert.equal(typeof moveProductImage, "function");
  assert.deepEqual(
    moveProductImage?.(
      {
        images: ["cover.jpg", "detail-1.jpg", "detail-2.jpg"],
        imageRoles: { "cover.jpg": "cover", "detail-1.jpg": "detail", "detail-2.jpg": "detail" },
      },
      2,
      0,
    ),
    {
      images: ["detail-2.jpg", "cover.jpg", "detail-1.jpg"],
      imageRoles: { "cover.jpg": "cover", "detail-1.jpg": "detail", "detail-2.jpg": "detail" },
    },
  );
});
