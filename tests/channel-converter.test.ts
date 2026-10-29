import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import { analyzeTargetTemplate, applyConversionDefaults, convertChannelWorkbook, missingFullConversionFields } from "../app/lib/channels/converter.ts";
import { enrichImportedRowsFromProducts } from "../app/lib/channels/conversion-enrichment.ts";
import { buildBuiltinTemplate } from "../app/lib/channels/builtin.ts";
import type { Product } from "../app/lib/products.ts";

function workbookBuffer(rows: unknown[][], sheetName = "Template"): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

test("converts a multi-row Coupang-style workbook into another channel template", async () => {
  // Catches: treating the title/group rows as the header, which silently loses the product row.
  const source = workbookBuffer([
    ["Catalog Template_Ver.1.2"],
    ["쿠팡상품정보"],
    ["상품기본정보", "", "", "구매옵션정보"],
    ["등록상품명", "쿠팡 노출상품명", "카테고리", "제조사", "브랜드", "검색어", "등록 옵션명", "구매옵션유형1", "구매옵션값1"],
    ["복숭아 2kg", "산지직송 복숭아 2kg", "복숭아", "샘플상점", "샘플상점", "복숭아,과일", "2kg", "중량", "2kg"],
  ]);
  const targetBuffer = workbookBuffer([
    ["스마트스토어 상품등록"],
    ["상품명", "카테고리ID", "제조사", "브랜드", "태그(최대 10개)", "옵션명", "옵션값"],
  ], "상품등록");
  const target = await analyzeTargetTemplate(targetBuffer, {
    channelId: "smartstore",
    channelLabel: "스마트스토어",
    fileName: "smartstore.xlsx",
  });

  const result = await convertChannelWorkbook(source, {
    sourceFileName: "coupang.xlsx",
    targetTemplate: target,
  });

  assert.equal(result.rowCount, 1);
  assert.equal(result.sourceSheetName, "Template");
  const output = XLSX.read(result.bytes, { type: "array" });
  const values = XLSX.utils.sheet_to_json(output.Sheets["상품등록"], { header: 1, defval: "" }) as unknown[][];
  assert.deepEqual(values[2].slice(0, 7), ["산지직송 복숭아 2kg", "복숭아", "샘플상점", "샘플상점", "복숭아,과일", "중량", "2kg"]);
});

test("explains when an uploaded workbook is only an empty template", async () => {
  // Catches: producing an empty output workbook and making the user think conversion succeeded.
  const emptySource = workbookBuffer([
    ["Catalog Template_Ver.1.2"],
    ["쿠팡상품정보 수정요청"],
    ["상품기본정보", "", "구매옵션정보"],
    ["등록상품명", "쿠팡 노출상품명", "카테고리", "제조사"],
  ]);
  const targetBuffer = workbookBuffer([["상품명", "카테고리ID"]]);
  const target = await analyzeTargetTemplate(targetBuffer, {
    channelId: "smartstore",
    channelLabel: "스마트스토어",
    fileName: "smartstore.xlsx",
  });

  await assert.rejects(
    () => convertChannelWorkbook(emptySource, { sourceFileName: "empty-coupang.xlsx", targetTemplate: target }),
    /상품 데이터가 없습니다.*빈 양식/,
  );
});

test("blocks a conversion when the source lacks fields required by the target template", async () => {
  // Catches: downloading a workbook that the target channel will reject for missing price and stock.
  const source = workbookBuffer([
    ["쿠팡 노출상품명", "카테고리"],
    ["산지직송 복숭아", "복숭아"],
  ]);
  const targetBuffer = workbookBuffer([["상품명", "카테고리ID", "판매가", "재고수량"]]);
  const target = await analyzeTargetTemplate(targetBuffer, {
    channelId: "smartstore",
    channelLabel: "스마트스토어",
    fileName: "smartstore.xlsx",
  });

  await assert.rejects(
    () => convertChannelWorkbook(source, { sourceFileName: "coupang-update.xlsx", targetTemplate: target }),
    /"판매가".*원본 엑셀에 없습니다/,
  );
});

test("fills missing detail HTML and registration fields from the matching managed product", () => {
  // Catches: converting only the downloaded Naver cells and losing the editor detail page.
  const products = [{
    id: "managed-1",
    data: {
      channelProductNo: "1234567890",
      sellerProductCode: "FRUIT-001",
      productName: "관리 상품명",
      detailContent: '<section class="saved-detail">기존 에디터 상세페이지</section>',
      infoNoticeGroup: "농수축산물",
      infoNoticeItems: "국산|냉장보관",
    },
    images: ["https://img.test/main.jpg", "https://img.test/add.jpg", "https://img.test/detail.jpg"],
    imageRoles: {
      "https://img.test/main.jpg": "cover",
      "https://img.test/detail.jpg": "detail",
    },
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  }] as Product[];

  const [row] = enrichImportedRowsFromProducts([{
    channelProductNo: "1234567890",
    productName: "엑셀에 적힌 상품명",
    mainImage: "https://naver.test/original-main.jpg",
  }], products);

  assert.equal(row.productName, "엑셀에 적힌 상품명");
  assert.equal(row.sellerProductCode, "FRUIT-001");
  assert.match(String(row.detailContent), /기존 에디터 상세페이지/);
  assert.equal(row.mainImage, "https://naver.test/original-main.jpg");
  assert.equal(row.extraImages, "https://img.test/add.jpg");
  assert.equal(row.detailImage, "https://img.test/detail.jpg");
  assert.equal(row.infoNoticeGroup, "농수축산물");
  assert.equal(row.infoNoticeItems, "국산|냉장보관");
});

test("writes the enriched editor detail and keeps additional images separate", async () => {
  // Catches: sending additional gallery images into the detail-image column or leaving HTML blank.
  const source = workbookBuffer([
    ["상품번호", "상품명", "대표이미지", "추가이미지"],
    ["1234567890", "알찬 과일세트", "https://img.test/main.jpg", "https://img.test/add.jpg"],
  ]);
  const target = await analyzeTargetTemplate(workbookBuffer([[
    "상품명", "판매자 상품코드", "대표이미지", "추가이미지", "상세이미지", "상세설명", "상품정보제공고시 상품군",
  ]]), {
    channelId: "coupang",
    channelLabel: "쿠팡",
    fileName: "coupang-register.xlsx",
  });
  const rows = [{
    channelProductNo: "1234567890",
    productName: "알찬 과일세트",
    sellerProductCode: "FRUIT-001",
    mainImage: "https://img.test/main.jpg",
    extraImages: "https://img.test/add.jpg",
    detailImage: "https://img.test/detail.jpg",
    detailContent: "<div>저장된 상세 HTML</div>",
    infoNoticeGroup: "농수축산물",
  }];

  const result = await convertChannelWorkbook(source, {
    sourceFileName: "naver.xlsx",
    targetTemplate: target,
    sourceRows: rows,
  });

  const output = XLSX.read(result.bytes, { type: "array" });
  const values = XLSX.utils.sheet_to_json(output.Sheets[target.sheetName], { header: 1, defval: "" }) as unknown[][];
  assert.deepEqual(values[1], [
    "알찬 과일세트", "FRUIT-001", "https://img.test/main.jpg", "https://img.test/add.jpg",
    "https://img.test/detail.jpg", "<div>저장된 상세 HTML</div>", "농수축산물",
  ]);
});

test("every built-in registration workbook carries codes, gallery images, detail HTML, and notice data", async () => {
  // Catches: a channel's quick conversion silently dropping data the user already prepared.
  for (const [channelId, label] of [["smartstore", "스마트스토어"], ["coupang", "쿠팡"], ["cafe24", "카페24"]]) {
    const template = await buildBuiltinTemplate(channelId, label);
    assert.ok(template);
    const mapped = new Set(template.columns.map((column) => column.fieldId).filter(Boolean));
    for (const required of ["productName", "sellerProductCode", "mainImage", "extraImages", "detailContent", "infoNoticeGroup"]) {
      assert.ok(mapped.has(required), `${label} 기본 양식에 ${required}가 빠졌습니다.`);
    }
  }
});

test("identifies a Coupang product-info update sheet that cannot carry a full product", async () => {
  // Catches: accepting the user's Coupang_detailinfo kind of sheet and silently losing images/detail/price.
  const updateTemplate = await analyzeTargetTemplate(workbookBuffer([
    ["Catalog Template_Ver.1.2"],
    ["상품기본정보"],
    ["등록상품ID", "등록상품명", "쿠팡 노출상품명", "카테고리", "제조사", "브랜드", "검색어"],
  ]), {
    channelId: "coupang",
    channelLabel: "쿠팡",
    fileName: "Coupang_detailinfo.xlsx",
  });

  assert.deepEqual(missingFullConversionFields(updateTemplate), [
    "sellerProductCode", "price", "stock", "mainImage", "extraImages", "detailContent", "infoNoticeGroup",
  ]);
});

test("creates stable missing registration defaults without replacing explicit values", () => {
  // Catches: cross-channel output missing seller codes/default stock or changing a deliberate stock value.
  const rows = applyConversionDefaults([
    { channelProductNo: "13718376177", productName: "알찬 과일세트", price: 50000 },
    { productName: "다른 과일세트", sellerProductCode: "KEEP-ME", stock: 0, origin: "국산" },
  ]);

  assert.equal(rows[0].sellerProductCode, "NV-13718376177");
  assert.equal(rows[0].stock, 30);
  assert.equal(rows[0].origin, "국산");
  assert.equal(rows[0].infoNoticeGroup, "농수축산물");
  assert.equal(rows[1].sellerProductCode, "KEEP-ME");
  assert.equal(rows[1].stock, 0);
});

test("starts Coupang sellertool rows below its requirement and instruction rows", async () => {
  // Catches: overwriting rows 3-4 of the macro template instead of beginning product data at row 5.
  const template = await analyzeTargetTemplate(workbookBuffer([
    ["기본정보", ""],
    ["카테고리", "등록상품명"],
    ["필수", "필수"],
    ["상품정보는 5행부터 입력하세요.", "등록상품명을 입력하세요."],
    ["[72532] 과일선물세트", ""],
  ]), {
    channelId: "coupang",
    channelLabel: "쿠팡",
    fileName: "sellertool_upload.xlsm",
  });

  assert.equal(template.headerRow, 1);
  assert.equal(template.dataStartRow, 4);
});

test("maps Coupang's product notice category and preserves xlsm output", async () => {
  // Catches: leaving required notice category blank and stripping the macro-enabled extension.
  const template = await analyzeTargetTemplate(workbookBuffer([[
    "등록상품명", "상품고시정보 카테고리", "상세 설명",
  ]]), {
    channelId: "coupang",
    channelLabel: "쿠팡",
    fileName: "sellertool_upload.xlsm",
  });
  const source = workbookBuffer([["상품명"], ["과일세트"]]);
  const result = await convertChannelWorkbook(source, {
    sourceFileName: "naver.xlsx",
    targetTemplate: template,
    sourceRows: [{ category: "과일", productName: "과일세트", infoNoticeGroup: "농수축산물", detailContent: "<div>상세</div>" }],
  });

  assert.equal(template.columns.find((column) => column.header === "상품고시정보 카테고리")?.fieldId, "infoNoticeGroup");
  assert.equal(result.extension, "xlsm");
});

test("keeps the category selected in Coupang's sellertool template for every output row", async () => {
  const targetCategory = "[72532] 식품>신선식품>과일류>과일선물세트>혼합/기타 과일세트";
  const template = await analyzeTargetTemplate(workbookBuffer([
    ["기본정보", ""],
    ["카테고리", "등록상품명", "상품고시정보 카테고리", "상세 설명"],
    ["필수", "필수", "필수", "필수"],
    ["상품정보는 5행부터 입력하세요.", "등록상품명을 입력하세요."],
    [targetCategory, "", "", ""],
  ]), {
    channelId: "coupang",
    channelLabel: "쿠팡",
    fileName: "sellertool_upload.xlsm",
  });
  const source = workbookBuffer([["상품명"], ["상품1"], ["상품2"]]);
  const result = await convertChannelWorkbook(source, {
    sourceFileName: "naver.xlsx",
    targetTemplate: template,
    sourceRows: [
      { category: "네이버 카테고리", productName: "상품1", infoNoticeGroup: "농수축산물", detailContent: "<p>상세1</p>" },
      { category: "다른 네이버 카테고리", productName: "상품2", infoNoticeGroup: "농수축산물", detailContent: "<p>상세2</p>" },
    ],
  });
  const output = XLSX.read(result.bytes, { type: "array" });
  const sheet = output.Sheets[template.sheetName];
  assert.equal(sheet.A5.v, targetCategory);
  assert.equal(sheet.A6.v, targetCategory);
});

test("writes Coupang sellertool values using Coupang's accepted registration vocabulary", async () => {
  // Catches the exact rejection returned by Coupang_failed_260812 (2).xlsm:
  // 신상품/면세상품 plus blank price base, lead time, stock, and agricultural notice values.
  const headers = [
    "카테고리", "등록상품명", "상품상태", "브랜드 ID", "제조사", "판매가격", "할인율기준가",
    "재고수량", "출고리드타임", "과세여부", "상품고시정보 카테고리",
    ...Array.from({ length: 14 }, (_, index) => `상품고시정보값${index + 1}`),
  ];
  const targetCategory = "[72532] 식품>신선식품>과일류>과일선물세트>혼합/기타 과일세트";
  const template = await analyzeTargetTemplate(workbookBuffer([
    ["기본정보"],
    headers,
    headers.map(() => "필수"),
    ["상품정보는 5행부터 입력하세요."],
    [targetCategory],
  ]), {
    channelId: "coupang",
    channelLabel: "쿠팡",
    fileName: "sellertool_upload.xlsm",
  });
  const source = workbookBuffer([["상품명"], ["샘플상점 과일세트"]]);
  const result = await convertChannelWorkbook(source, {
    sourceFileName: "naver.xlsx",
    targetTemplate: template,
    sourceRows: [{
      category: "네이버 카테고리",
      productName: "샘플상점 과일세트",
      productCondition: "신상품",
      brand: "샘플상점샘플상점",
      manufacturer: "샘플상점샘플상점",
      price: 50000,
      stock: 0,
      taxType: "면세상품",
      infoNoticeGroup: "농수축산물",
      weightSpec: "4kg 1박스",
      origin: "국산",
      expiry: "수령 후 가급적 빠른 섭취",
      storage: "냉장보관",
      asPhone: "010-0000-1246",
      mainImage: "https://example.com/main.png",
      extraImages: "https://example.com/extra.png",
      detailContent: "<div>상세</div>",
    }],
  });
  const output = XLSX.read(result.bytes, { type: "array" });
  const row = XLSX.utils.sheet_to_json<unknown[]>(output.Sheets[template.sheetName], { header: 1, defval: null })[4];

  assert.deepEqual(row.slice(0, 25), [
    targetCategory,
    "샘플상점 과일세트",
    "새상품",
    "브랜드 없음",
    "샘플상점샘플상점",
    50000,
    50000,
    30,
    1,
    "N",
    "농수축산물",
    "샘플상점 과일세트",
    "4kg 1박스",
    "샘플상점샘플상점",
    "국산",
    "수령 후 가급적 빠른 섭취",
    "상품 상세설명 참조",
    "해당사항 없음",
    "4kg 1박스",
    "냉장보관",
    "신선식품 특성상 수령 후 즉시 상태를 확인해 주세요.",
    "010-0000-1246",
    null,
    null,
    null,
  ]);
});

test("preserves Coupang category options and normalizes additional image URLs", async () => {
  // Catches Coupang_failed_260813.xlsm: clearing the required category option and treating newline-separated URLs as one overlong path.
  const targetCategory = "[72532] 식품>신선식품>과일류>과일선물세트>혼합/기타 과일세트";
  const requiredOption = "수량\n[필수]\n[기본단위: 개]";
  const template = await analyzeTargetTemplate(workbookBuffer([
    ["기본정보"],
    ["카테고리", "등록상품명", "옵션유형1", "옵션값1", "추가이미지"],
    ["필수", "필수", "필수", "필수", "선택"],
    ["상품정보는 5행부터 입력하세요."],
    [targetCategory, "", requiredOption, "", ""],
  ]), {
    channelId: "coupang",
    channelLabel: "쿠팡",
    fileName: "sellertool_upload.xlsm",
  });
  const result = await convertChannelWorkbook(workbookBuffer([["상품명"], ["과일세트"]]), {
    sourceFileName: "naver.xlsx",
    targetTemplate: template,
    sourceRows: [
      { category: "과일", productName: "과일세트 1", weightSpec: "4kg 1박스", extraImages: "https://example.com/a.png\nhttps://example.com/b.png" },
      { category: "과일", productName: "과일세트 2", weightSpec: "4kg 1박스", extraImages: "https://example.com/c.png, https://example.com/d.png" },
    ],
  });
  const output = XLSX.read(result.bytes, { type: "array" });
  const sheet = output.Sheets[template.sheetName];

  assert.equal(sheet.C5.v, requiredOption);
  assert.equal(sheet.C6.v, requiredOption);
  assert.equal(sheet.D5.v, "1개");
  assert.equal(sheet.D6.v, "1개");
  assert.equal(sheet.E5.v, "https://example.com/a.png,https://example.com/b.png");
  assert.equal(sheet.E6.v, "https://example.com/c.png,https://example.com/d.png");
});

test("does not import Coupang requirement and instruction rows as products", async () => {
  // Catches a phantom product named "필수" when a sellertool workbook is used as the source channel.
  const source = workbookBuffer([
    ["기본정보"],
    ["등록상품명", "판매가격"],
    ["필수", "필수"],
    ["상품정보는 5행부터 입력하세요.", "판매가격을 입력하세요."],
    ["샘플상점 과일세트", 50000],
  ]);
  const target = await analyzeTargetTemplate(workbookBuffer([["상품명", "판매가격"]]), {
    channelId: "smartstore",
    channelLabel: "네이버",
    fileName: "naver.xlsx",
  });

  const result = await convertChannelWorkbook(source, {
    sourceFileName: "sellertool_upload.xlsm",
    targetTemplate: target,
  });

  assert.equal(result.rowCount, 1);
  const output = XLSX.read(result.bytes, { type: "array" });
  assert.equal(output.Sheets[target.sheetName].A2.v, "샘플상점 과일세트");
});
