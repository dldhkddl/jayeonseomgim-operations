import assert from "node:assert/strict";
import test from "node:test";
import * as validation from "../app/lib/naverRegistrationValidation.ts";

const { validateNaverRegistration } = validation;
const resolveNaverContactPhone = (validation as typeof validation & {
  resolveNaverContactPhone?: (productPhone: unknown, sellerDefaultPhone: unknown) => string;
}).resolveNaverContactPhone;
const inferUnitPrice = (validation as typeof validation & {
  inferUnitPrice?: (weight: unknown) => unknown;
}).inferUnitPrice ?? (() => undefined);
const resolveUnitPriceFields = (validation as typeof validation & {
  resolveUnitPriceFields?: (input: Record<string, unknown>) => unknown;
}).resolveUnitPriceFields ?? (() => undefined);
const resolveNaverProductTitle = (validation as typeof validation & {
  resolveNaverProductTitle?: (input: Record<string, unknown>) => string | undefined;
}).resolveNaverProductTitle ?? (() => undefined);
const recommendedProductTitle = (validation as typeof validation & {
  recommendedProductTitle?: (input: Record<string, unknown>) => string | undefined;
}).recommendedProductTitle;

const valid = {
  title: "경북 부사 사과 3kg",
  category: "50002160",
  sellerProductCode: "PE-YE-2",
  price: "39,900",
  stock: "100",
  origin: "경상북도 영주시",
  phone: "010-1234-5678",
  requirePhone: true,
  deliveryCompany: "CJGLS",
  returnDeliveryFee: "4000",
  exchangeDeliveryFee: "8000",
  requireDelivery: true,
  imageCount: 2,
  greenCertificationId: "EXCLUDED",
  unitPriceYn: "false",
};

test("accepts a complete SmartStore registration candidate", () => {
  assert.deepEqual(validateNaverRegistration(valid), []);
});

test("returns every missing required field in one pass", () => {
  assert.deepEqual(
    validateNaverRegistration({
      title: "",
      category: "",
      price: "",
      stock: "",
      origin: "",
      phone: "",
      requirePhone: true,
      deliveryCompany: "",
      returnDeliveryFee: "",
      exchangeDeliveryFee: "",
      requireDelivery: true,
      imageCount: 0,
    })
      .map((issue) => issue.field),
    [
      "title",
      "category",
      "sellerProductCode",
      "price",
      "stock",
      "images",
      "origin",
      "phone",
      "deliveryCompany",
      "returnDeliveryFee",
      "exchangeDeliveryFee",
      "unitPriceYn",
    ],
  );
});

test("requires unit-price capacity fields only when unit-price display is enabled", () => {
  const missing = validateNaverRegistration({ ...valid, unitPriceYn: "true" });
  assert.deepEqual(
    missing.map((issue) => issue.field),
    ["totalCapacityValue", "unitCapacity", "indicationUnit"],
  );

  assert.deepEqual(validateNaverRegistration({
    ...valid,
    unitPriceYn: "true",
    totalCapacityValue: "6",
    unitCapacity: "1",
    indicationUnit: "kg",
  }), []);
});

test("automatically sums repeated weights for unit-price registration", () => {
  assert.deepEqual(inferUnitPrice("3kg + 3kg"), {
    unitPriceYn: "true",
    totalCapacityValue: "6",
    unitCapacity: "1",
    indicationUnit: "kg",
  });
});

test("automatically multiplies package quantities and uses a readable base unit", () => {
  assert.deepEqual(inferUnitPrice("500g × 4봉"), {
    unitPriceYn: "true",
    totalCapacityValue: "2000",
    unitCapacity: "100",
    indicationUnit: "g",
  });
});

test("automatically reads item counts", () => {
  assert.deepEqual(inferUnitPrice("20개입"), {
    unitPriceYn: "true",
    totalCapacityValue: "20",
    unitCapacity: "1",
    indicationUnit: "개",
  });
});

test("does not invent a unit price from an ambiguous composition", () => {
  assert.equal(inferUnitPrice("과일 한 상자"), null);
});

test("uses inferred values unless the user explicitly overrides them", () => {
  assert.deepEqual(resolveUnitPriceFields({ weight: "3kg + 3kg" }), {
    unitPriceYn: "true",
    totalCapacityValue: "6",
    unitCapacity: "1",
    indicationUnit: "kg",
    autoCalculated: true,
  });
  assert.deepEqual(resolveUnitPriceFields({ weight: "3kg + 3kg", unitPriceYn: "false" }), {
    unitPriceYn: "false",
    totalCapacityValue: "",
    unitCapacity: "",
    indicationUnit: "",
    autoCalculated: false,
  });
});

test("keeps the entered product name instead of replacing it with numeric metadata", () => {
  assert.equal(resolveNaverProductTitle({
    productName: "과즙 가득 프리미엄 복숭아",
    origin: "00",
    weight: "2000",
  }), "과즙 가득 프리미엄 복숭아");
});

test("AI recommended title uses the entered name before numeric metadata", () => {
  assert.equal(typeof recommendedProductTitle, "function");
  assert.equal(recommendedProductTitle!({
    productName: "국산 복숭아",
    origin: "00",
    variety: "6000",
    weight: "",
    shipping: "무료",
  }), "국산 복숭아");
});

test("builds a fallback title only when the product name is blank", () => {
  assert.equal(resolveNaverProductTitle({
    productName: "",
    origin: "국산",
    variety: "백도",
    weight: "2kg",
    shipping: "무료배송",
  }), "[산지직송] 국산 백도 2kg 무료배송");
});

test("uses the product phone first and falls back to the seller default phone", () => {
  assert.equal(typeof resolveNaverContactPhone, "function");
  assert.equal(resolveNaverContactPhone!(" 010-0000-2668 ", "010-0000-4657"), "010-0000-2668");
  assert.equal(resolveNaverContactPhone!("", " 010-0000-4657 "), "010-0000-4657");
});

test("tells the user exactly which contact field is missing", () => {
  const phoneIssue = validateNaverRegistration({ ...valid, phone: "" }).find((issue) => issue.field === "phone");
  assert.equal(phoneIssue?.message, "A/S 상담전화번호를 입력해 주세요.");
});

test("tells the user which delivery settings are missing", () => {
  const issues = validateNaverRegistration({
    ...valid,
    deliveryCompany: "",
    returnDeliveryFee: "",
    exchangeDeliveryFee: "",
  });
  assert.deepEqual(
    issues.map((issue) => issue.message),
    ["택배사를 선택해 주세요.", "반품 배송비를 입력해 주세요.", "교환 배송비를 입력해 주세요."],
  );
});

test("rejects a non-numeric category id", () => {
  assert.equal(validateNaverRegistration({ ...valid, category: "사과" })[0]?.field, "category");
});

test("rejects a seller product code longer than Naver's 30-character limit", () => {
  const issue = validateNaverRegistration({ ...valid, sellerProductCode: "A".repeat(31) })
    .find((item) => item.field === "sellerProductCode");
  assert.equal(issue?.message, "판매자 상품코드는 30자 이내로 입력해 주세요.");
});

test("rejects zero, negative, decimal, and decorated price or stock values", () => {
  for (const value of ["0", "-1", "1.5", "만원"]) {
    assert.ok(validateNaverRegistration({ ...valid, price: value }).some((issue) => issue.field === "price"));
    assert.ok(validateNaverRegistration({ ...valid, stock: value }).some((issue) => issue.field === "stock"));
  }
});

test("requires an institution and number for a selected green certification", () => {
  const issues = validateNaverRegistration({
    ...valid,
    greenCertificationId: "101",
    greenCertificationName: "",
    greenCertificationNumber: "",
  });

  assert.deepEqual(
    issues.map((issue) => issue.message),
    ["친환경 인증 기관을 선택해 주세요.", "친환경 인증번호를 입력해 주세요."],
  );
});
