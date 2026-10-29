import assert from "node:assert/strict";
import test from "node:test";

import { existingDetailContent } from "../app/lib/channels/detail.ts";
import { inspectImport } from "../app/lib/channels/importer.ts";
import { productsFromRows } from "../app/lib/products.ts";

test("restores representative and additional Excel images without mixing detail-page images into the gallery", () => {
  // Catches: treating the separate detail editor's images as channel additional/detail gallery images.
  const [product] = productsFromRows([{
    productName: "복숭아 2kg",
    mainImage: "https://img.example.com/cover.jpg",
    extraImages: "https://img.example.com/extra-1.jpg, https://img.example.com/extra-2.jpg",
    detailImage: "https://img.example.com/detail.jpg",
    detailContent: '<section><img src="https://img.example.com/story.jpg"><p>기존 상세설명</p></section>',
  }]);

  assert.deepEqual(product.images, [
    "https://img.example.com/cover.jpg",
    "https://img.example.com/extra-1.jpg",
    "https://img.example.com/extra-2.jpg",
  ]);
  assert.equal(product.imageRoles?.["https://img.example.com/cover.jpg"], "cover");
  assert.equal(product.imageRoles?.["https://img.example.com/extra-1.jpg"], undefined);
  assert.equal(product.data.detailImage, "https://img.example.com/detail.jpg");
  assert.match(String(product.data.detailContent), /story\.jpg/);
});

test("returns imported written detail content without rebuilding it", () => {
  // Catches: direct registration and preview replacing the seller's existing HTML with generated content.
  const original = '<div class="original"><img src="https://img.example.com/original.jpg">기존 상세페이지</div>';
  assert.equal(existingDetailContent({ detailContent: original }), original);
  assert.equal(existingDetailContent({ detailContent: "상세페이지 작성 예정" }), null);
});

test("does not warn that detail is missing after the managed product supplied it", () => {
  // Catches: showing a false missing-column warning even though enrichment supplied usable detail HTML.
  const issues = inspectImport({
    sheetName: "일괄수정",
    headerRow: 1,
    columns: [
      { col: 0, header: "상품번호", fieldId: "channelProductNo", confidence: 1, source: "auto" },
      { col: 1, header: "상품명", fieldId: "productName", confidence: 1, source: "auto" },
    ],
    rows: [{ channelProductNo: "123", productName: "과일세트", detailContent: "<div>기존 상세페이지</div>" }],
    skippedRows: 0,
    unmappedHeaders: [],
  });

  assert.equal(issues.some((issue) => issue.message.includes("상세설명") && issue.message.includes("원본에 없습니다")), false);
});

test("labels guide rows and channel-specific columns as informational, not missing-data warnings", () => {
  // Catches: normal Naver guide rows and unsupported optional columns looking like conversion failures.
  const issues = inspectImport({
    sheetName: "일괄수정",
    headerRow: 1,
    columns: [{ col: 0, header: "상품명", fieldId: "productName", confidence: 1, source: "auto" }],
    rows: [{ productName: "과일세트" }],
    skippedRows: 3,
    unmappedHeaders: ["단위가격 사용여부", "표시용량"],
  });

  assert.equal(issues.find((issue) => issue.message.includes("안내 행"))?.level, "info");
  assert.equal(issues.find((issue) => issue.message.includes("원본 전용 열"))?.level, "info");
});
