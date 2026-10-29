import assert from "node:assert/strict";
import test from "node:test";

import { matchField } from "../app/lib/channels/mapping.ts";
import { readNaverChannelProduct } from "../app/lib/naver.ts";
import { applyNaverImportedDetails, extractNaverImportedDetails } from "../app/lib/naverProductImport.ts";

test("maps SmartStore 상품번호 as a channel product number", () => {
  // Catches: dropping the only identifier that can retrieve omitted detail HTML from Naver.
  assert.equal(matchField("상품번호")?.fieldId, "channelProductNo");
});

test("extracts detail HTML and images from a Naver channel-product response", () => {
  // Catches: reading originProduct fields from the wrong response level.
  assert.deepEqual(extractNaverImportedDetails({
    originProductNo: 123,
    originProduct: {
      detailContent: '<section class="original">기존 상세</section>',
      images: {
        representativeImage: { url: "https://img.example/cover.jpg" },
        optionalImages: [{ url: "https://img.example/extra.jpg" }],
      },
    },
  }), {
    originProductNo: "123",
    detailContent: '<section class="original">기존 상세</section>',
    mainImage: "https://img.example/cover.jpg",
    extraImages: "https://img.example/extra.jpg",
  });
});

test("fills only missing imported detail content and keeps Excel gallery images", () => {
  // Catches: API enrichment overwriting images exported in the user's workbook or replacing written detail.
  const rows = [{
    channelProductNo: "456",
    mainImage: "https://excel.example/cover.jpg",
    extraImages: "https://excel.example/extra.jpg",
  }, {
    channelProductNo: "789",
    detailContent: "<p>엑셀 기존 상세</p>",
  }];
  const next = applyNaverImportedDetails(rows, {
    "456": { originProductNo: "123", detailContent: "<p>네이버 기존 상세</p>", mainImage: "https://naver.example/cover.jpg", extraImages: "https://naver.example/extra.jpg" },
    "789": { originProductNo: "124", detailContent: "<p>덮어쓰면 안 됨</p>", mainImage: "", extraImages: "" },
  });

  assert.equal(next[0].detailContent, "<p>네이버 기존 상세</p>");
  assert.equal(next[0].mainImage, "https://excel.example/cover.jpg");
  assert.equal(next[0].extraImages, "https://excel.example/extra.jpg");
  assert.equal(next[1].detailContent, "<p>엑셀 기존 상세</p>");
});

test("retries a temporarily rate-limited Naver product lookup", async () => {
  // Catches: a short Naver rate limit leaving one imported product without its original detail page.
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(JSON.stringify({ message: "요청이 많아 서비스를 일시적으로 사용할 수 없습니다." }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ originProduct: { detailContent: "<p>원본</p>" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await readNaverChannelProduct("token", "13718376177");
    assert.equal(attempts, 2);
    assert.deepEqual(result, { originProduct: { detailContent: "<p>원본</p>" } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
