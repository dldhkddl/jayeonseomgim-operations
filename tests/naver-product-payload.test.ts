import assert from "node:assert/strict";
import test from "node:test";
import * as naver from "../app/lib/naver.ts";

const buildNaverProductPayload = (naver as typeof naver & {
  buildNaverProductPayload?: (input: Record<string, unknown>) => {
    originProduct?: {
      minorPurchasable?: boolean;
      detailAttribute?: {
        minorPurchasable?: boolean;
        originAreaInfo?: { originAreaCode?: string };
        productInfoProvidedNotice?: unknown;
        productCertificationInfos?: unknown;
        certificationTargetExcludeContent?: { greenCertifiedProductExclusionYn?: boolean };
        unitCapacity?: {
          unitPriceYn?: boolean;
          totalCapacityValue?: number;
          unitCapacity?: number;
          indicationUnit?: string;
        };
        sellerCodeInfo?: { sellerManagementCode?: string };
      };
      deliveryInfo?: {
        deliveryCompany?: string;
        claimDeliveryInfo?: { returnDeliveryFee?: number; exchangeDeliveryFee?: number };
      };
    };
  };
}).buildNaverProductPayload;

test("keeps the failing Naver API stage with the error", () => {
  const error = Reflect.construct(naver.NaverApiError, [
    "internal error; reference = test-reference",
    500,
    { code: "INTERNAL_SERVER_ERROR" },
    "상품 정보 전송",
  ]) as naver.NaverApiError & { stage?: string };

  assert.equal(error.stage, "상품 정보 전송");
});

test("recognizes a Naver API error copied across a server module boundary", () => {
  const copiedError = {
    name: "Error",
    message: "internal error; reference = test-reference",
    status: 500,
    detail: { code: "INTERNAL_SERVER_ERROR" },
    stage: "상품 정보 전송",
  };

  assert.equal(typeof naver.isNaverApiError, "function");
  assert.equal(naver.isNaverApiError?.(copiedError), true);
});

test("keeps the product transmission stage when the Naver fetch itself rejects", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("internal error; reference = transport-reference");
  };

  try {
    await assert.rejects(
      () => naver.registerProduct({
        accessToken: "test-token",
        leafCategoryId: "50002160",
        name: "포항 산지직송 햇사과",
        salePrice: 39900,
        stockQuantity: 100,
        representativeImageUrl: "https://example.com/main.jpg",
        optionalImageUrls: [],
        detailContentHtml: "<p>상품 상세</p>",
        originAreaContent: "경상북도 포항시",
        originAreaCode: "00",
        afterServiceTelephoneNumber: "010-1234-5678",
        afterServiceGuideContent: "판매자에게 문의해 주세요.",
        weight: "3kg + 3kg",
        producer: "명성농산",
        storage: "수령 후 냉장 보관",
        deliveryCompany: "CJGLS",
        returnDeliveryFee: 4000,
        exchangeDeliveryFee: 8000,
      }),
      (error: unknown) => {
        assert.equal(naver.isNaverApiError(error), true);
        assert.equal((error as naver.NaverApiError).stage, "상품 정보 전송");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("builds the required FOOD notice for a domestic fresh product", () => {
  assert.equal(typeof buildNaverProductPayload, "function");
  const payload = buildNaverProductPayload?.({
    leafCategoryId: "50002160",
    name: "포항 산지직송 햇사과",
    salePrice: 39900,
    stockQuantity: 100,
    representativeImageUrl: "https://example.com/main.jpg",
    optionalImageUrls: ["https://example.com/detail.jpg"],
    detailContentHtml: "<p>상품 상세</p>",
    originAreaContent: "경상북도 포항시",
    originAreaCode: "00",
    afterServiceTelephoneNumber: "010-1234-5678",
    afterServiceGuideContent: "판매자에게 문의해 주세요.",
    weight: "3kg + 3kg",
    producer: "명성농산",
    storage: "수령 후 냉장 보관",
    deliveryCompany: "CJGLS",
    returnDeliveryFee: 4000,
    exchangeDeliveryFee: 8000,
    greenCertificationId: "EXCLUDED",
    greenCertificationName: "",
    greenCertificationNumber: "",
    sellerProductCode: "PE-YE-2",
  });

  assert.equal(payload?.originProduct?.minorPurchasable, undefined);
  assert.equal(payload?.originProduct?.detailAttribute?.minorPurchasable, true);
  assert.equal(payload?.originProduct?.detailAttribute?.originAreaInfo?.originAreaCode, "00");
  assert.equal(payload?.originProduct?.detailAttribute?.productCertificationInfos, undefined);
  assert.deepEqual(payload?.originProduct?.detailAttribute?.certificationTargetExcludeContent, {
    greenCertifiedProductExclusionYn: true,
  });
  assert.deepEqual(payload?.originProduct?.detailAttribute?.sellerCodeInfo, {
    sellerManagementCode: "PE-YE-2",
  });
  assert.deepEqual(payload?.originProduct?.deliveryInfo, {
    deliveryType: "DELIVERY",
    deliveryAttributeType: "NORMAL",
    deliveryCompany: "CJGLS",
    deliveryFee: { deliveryFeeType: "FREE" },
    claimDeliveryInfo: { returnDeliveryFee: 4000, exchangeDeliveryFee: 8000 },
  });
  assert.deepEqual(payload?.originProduct?.detailAttribute?.productInfoProvidedNotice, {
    productInfoProvidedNoticeType: "FOOD",
    food: {
      returnCostReason: "1",
      noRefundReason: "1",
      qualityAssuranceStandard: "1",
      compensationProcedure: "1",
      troubleShootingContents: "1",
      foodItem: "포항 산지직송 햇사과",
      weight: "3kg + 3kg",
      amount: "3kg + 3kg",
      size: "3kg + 3kg",
      packDateText: "상품 상세 참조",
      consumptionDateText: "상품 상세 참조",
      producer: "명성농산",
      productComposition: "3kg + 3kg",
      keep: "수령 후 냉장 보관",
      adCaution: "상품 상세 참조",
      customerServicePhoneNumber: "010-1234-5678",
    },
  });
});

test("sends the selected green certification to Naver", () => {
  const payload = buildNaverProductPayload?.({
    leafCategoryId: "50002160",
    name: "유기농 사과",
    salePrice: 39900,
    stockQuantity: 100,
    representativeImageUrl: "https://example.com/main.jpg",
    optionalImageUrls: [],
    detailContentHtml: "<p>상품 상세</p>",
    originAreaContent: "경상북도 영주시",
    originAreaCode: "00",
    afterServiceTelephoneNumber: "010-1234-5678",
    afterServiceGuideContent: "판매자에게 문의해 주세요.",
    weight: "3kg",
    producer: "명성농산",
    storage: "수령 후 냉장 보관",
    deliveryCompany: "CJGLS",
    returnDeliveryFee: 4000,
    exchangeDeliveryFee: 8000,
    greenCertificationId: "101",
    greenCertificationName: "유기농산물",
    greenCertificationNumber: "ORG-2026-001",
  });

  assert.deepEqual(payload?.originProduct?.detailAttribute?.productCertificationInfos, [
    {
      certificationInfoId: 101,
      certificationKindType: "GREEN_PRODUCTS",
      name: "유기농산물",
      certificationNumber: "ORG-2026-001",
      certificationMark: true,
    },
  ]);
  assert.deepEqual(payload?.originProduct?.detailAttribute?.certificationTargetExcludeContent, {
    greenCertifiedProductExclusionYn: false,
  });
});

test("sends the unit-price usage selection to Naver", () => {
  const disabled = buildNaverProductPayload?.({
    leafCategoryId: "50002160",
    name: "영주 사과",
    salePrice: 39900,
    stockQuantity: 100,
    representativeImageUrl: "https://example.com/main.jpg",
    optionalImageUrls: [],
    detailContentHtml: "<p>상품 상세</p>",
    originAreaContent: "국산",
    originAreaCode: "00",
    afterServiceTelephoneNumber: "010-1234-5678",
    afterServiceGuideContent: "판매자에게 문의해 주세요.",
    weight: "3kg + 3kg",
    producer: "명성농산",
    storage: "냉장 보관",
    deliveryCompany: "CJGLS",
    returnDeliveryFee: 4000,
    exchangeDeliveryFee: 8000,
    greenCertificationId: "EXCLUDED",
    greenCertificationName: "",
    greenCertificationNumber: "",
    unitPriceYn: false,
    totalCapacityValue: 0,
    unitCapacity: 0,
    indicationUnit: "",
  });
  assert.deepEqual(disabled?.originProduct?.detailAttribute?.unitCapacity, { unitPriceYn: false });

  const enabled = buildNaverProductPayload?.({
    leafCategoryId: "50002160",
    name: "영주 사과",
    salePrice: 39900,
    stockQuantity: 100,
    representativeImageUrl: "https://example.com/main.jpg",
    optionalImageUrls: [],
    detailContentHtml: "<p>상품 상세</p>",
    originAreaContent: "국산",
    originAreaCode: "00",
    afterServiceTelephoneNumber: "010-1234-5678",
    afterServiceGuideContent: "판매자에게 문의해 주세요.",
    weight: "3kg + 3kg",
    producer: "명성농산",
    storage: "냉장 보관",
    deliveryCompany: "CJGLS",
    returnDeliveryFee: 4000,
    exchangeDeliveryFee: 8000,
    greenCertificationId: "EXCLUDED",
    greenCertificationName: "",
    greenCertificationNumber: "",
    unitPriceYn: true,
    totalCapacityValue: 6,
    unitCapacity: 1,
    indicationUnit: "kg",
  });
  assert.deepEqual(enabled?.originProduct?.detailAttribute?.unitCapacity, {
    unitPriceYn: true,
    totalCapacityValue: 6,
    unitCapacity: 1,
    indicationUnit: "kg",
  });
});
