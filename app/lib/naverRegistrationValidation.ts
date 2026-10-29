export type NaverRegistrationField =
  | "title"
  | "category"
  | "sellerProductCode"
  | "price"
  | "stock"
  | "images"
  | "origin"
  | "phone"
  | "deliveryCompany"
  | "returnDeliveryFee"
  | "exchangeDeliveryFee"
  | "greenCertificationName"
  | "greenCertificationNumber"
  | "unitPriceYn"
  | "totalCapacityValue"
  | "unitCapacity"
  | "indicationUnit";

export type NaverRegistrationInput = {
  title?: unknown;
  category?: unknown;
  sellerProductCode?: unknown;
  price?: unknown;
  stock?: unknown;
  origin?: unknown;
  phone?: unknown;
  requirePhone?: boolean;
  deliveryCompany?: unknown;
  returnDeliveryFee?: unknown;
  exchangeDeliveryFee?: unknown;
  requireDelivery?: boolean;
  imageCount?: number;
  greenCertificationId?: unknown;
  greenCertificationName?: unknown;
  greenCertificationNumber?: unknown;
  weight?: unknown;
  unitPriceYn?: unknown;
  totalCapacityValue?: unknown;
  unitCapacity?: unknown;
  indicationUnit?: unknown;
};

export type NaverRegistrationIssue = {
  field: NaverRegistrationField;
  message: string;
};

export type UnitPriceFields = {
  unitPriceYn: string;
  totalCapacityValue: string;
  unitCapacity: string;
  indicationUnit: string;
};

export function resolveNaverProductTitle(input: {
  productName?: unknown;
  origin?: unknown;
  variety?: unknown;
  weight?: unknown;
  shipping?: unknown;
}): string {
  const productName = String(input.productName ?? "").trim();
  if (productName) return productName;
  return `[산지직송] ${String(input.origin ?? "")} ${String(input.variety ?? "")} ${String(input.weight ?? "")} ${String(input.shipping ?? "")}`
    .replace(/\s+/g, " ")
    .trim();
}

/** 오른쪽 AI 추천 카드도 실제 입력 상품명을 최우선으로 사용한다. */
export function recommendedProductTitle(input: Parameters<typeof resolveNaverProductTitle>[0]): string {
  return resolveNaverProductTitle(input);
}

export function inferUnitPrice(weight: unknown): UnitPriceFields | null {
  const normalized = String(weight ?? "").trim().toLowerCase().replace(/×/g, "x");
  const matches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|개입|개)/g)];
  if (!matches.length) return null;

  const units = new Set(matches.map((match) => match[2]));
  if (units.size !== 1) return null;

  const multiplier = normalized.match(/\d+(?:\.\d+)?\s*(?:kg|g|ml|l|개입|개)\s*[x*]\s*(\d+)/);
  if (multiplier && matches.length !== 1) return null;
  if (!multiplier && (normalized.match(/\d+(?:\.\d+)?/g)?.length ?? 0) !== matches.length) return null;

  const total = multiplier
    ? Number(matches[0][1]) * Number(multiplier[1])
    : matches.reduce((sum, match) => sum + Number(match[1]), 0);
  if (!Number.isFinite(total) || total <= 0) return null;

  const rawUnit = matches[0][2];
  const indicationUnit = rawUnit === "l" ? "L" : rawUnit === "개입" ? "개" : rawUnit;
  return {
    unitPriceYn: "true",
    totalCapacityValue: String(Number(total.toFixed(3))),
    unitCapacity: indicationUnit === "g" || indicationUnit === "ml" ? "100" : "1",
    indicationUnit,
  };
}

export function resolveUnitPriceFields(input: NaverRegistrationInput): UnitPriceFields & { autoCalculated: boolean } {
  const inferred = inferUnitPrice(input.weight);
  const explicit = String(input.unitPriceYn ?? "").trim();
  if (explicit === "false") {
    return { unitPriceYn: "false", totalCapacityValue: "", unitCapacity: "", indicationUnit: "", autoCalculated: false };
  }
  if (explicit === "true") {
    return {
      unitPriceYn: "true",
      totalCapacityValue: String(input.totalCapacityValue ?? "").trim() || inferred?.totalCapacityValue || "",
      unitCapacity: String(input.unitCapacity ?? "").trim() || inferred?.unitCapacity || "",
      indicationUnit: String(input.indicationUnit ?? "").trim() || inferred?.indicationUnit || "",
      autoCalculated: false,
    };
  }
  if (inferred) return { ...inferred, autoCalculated: true };
  return { unitPriceYn: "", totalCapacityValue: "", unitCapacity: "", indicationUnit: "", autoCalculated: false };
}

export type NaverCategoryCertificationInfo = {
  id?: unknown;
  name?: unknown;
  kindTypes?: unknown;
  certificationMarkType?: unknown;
};

export type GreenCertificationOption = {
  id: string;
  name: string;
  markType: string;
};

export function greenCertificationOptions(infos: unknown): GreenCertificationOption[] {
  const green = Array.isArray(infos)
    ? infos
        .filter((info): info is NaverCategoryCertificationInfo => Boolean(info && typeof info === "object"))
        .filter((info) => Array.isArray(info.kindTypes) && info.kindTypes.includes("GREEN_PRODUCTS"))
        .map((info) => ({
          id: String(info.id ?? "").trim(),
          name: String(info.name ?? "").trim(),
          markType: String(info.certificationMarkType ?? "").trim(),
        }))
        .filter((info) => info.id && info.name)
    : [];
  return [{ id: "EXCLUDED", name: "인증 대상 아님", markType: "" }, ...green];
}

function isPositiveInteger(value: unknown): boolean {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  return /^\d+$/.test(normalized) && Number.isSafeInteger(Number(normalized)) && Number(normalized) > 0;
}

function isNonNegativeInteger(value: unknown): boolean {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  return /^\d+$/.test(normalized) && Number.isSafeInteger(Number(normalized));
}

const UNIT_PRICE_UNITS = new Set(["g", "kg", "ml", "L", "cm", "m", "개", "개입", "매", "매입", "정", "캡슐", "구미", "포", "구"]);

function isValidTotalCapacity(value: unknown): boolean {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  return /^\d+(?:\.\d{1,3})?$/.test(normalized) && Number(normalized) >= 0.001 && Number(normalized) <= 999999999;
}

function isValidUnitCapacity(value: unknown): boolean {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) && Number(normalized) >= 1 && Number(normalized) <= 999;
}

export function resolveNaverContactPhone(productPhone: unknown, sellerDefaultPhone: unknown): string {
  return String(productPhone ?? "").trim() || String(sellerDefaultPhone ?? "").trim();
}

export function validateNaverRegistration(input: NaverRegistrationInput): NaverRegistrationIssue[] {
  const issues: NaverRegistrationIssue[] = [];
  if (!String(input.title ?? "").trim()) {
    issues.push({ field: "title", message: "상품명을 입력해 주세요." });
  }

  const category = String(input.category ?? "").trim();
  if (!/^\d+$/.test(category)) {
    issues.push({ field: "category", message: "네이버 카테고리를 선택해 주세요." });
  }

  const sellerProductCode = String(input.sellerProductCode ?? "").trim();
  if (!sellerProductCode) {
    issues.push({ field: "sellerProductCode", message: "판매자 상품코드를 입력해 주세요." });
  } else if (sellerProductCode.length > 30) {
    issues.push({ field: "sellerProductCode", message: "판매자 상품코드는 30자 이내로 입력해 주세요." });
  }

  if (!isPositiveInteger(input.price)) {
    issues.push({ field: "price", message: "판매가는 0보다 큰 정수로 입력해 주세요." });
  }
  if (!isPositiveInteger(input.stock)) {
    issues.push({ field: "stock", message: "재고는 0보다 큰 정수로 입력해 주세요." });
  }
  if (!Number.isInteger(input.imageCount) || (input.imageCount ?? 0) < 1) {
    issues.push({ field: "images", message: "대표 이미지를 1장 이상 추가해 주세요." });
  }
  if (!String(input.origin ?? "").trim()) {
    issues.push({ field: "origin", message: "원산지를 입력해 주세요." });
  }
  if (input.requirePhone && !String(input.phone ?? "").trim()) {
    issues.push({
      field: "phone",
      message: "A/S 상담전화번호를 입력해 주세요.",
    });
  }
  if (input.requireDelivery) {
    if (!String(input.deliveryCompany ?? "").trim()) {
      issues.push({ field: "deliveryCompany", message: "택배사를 선택해 주세요." });
    }
    if (!isNonNegativeInteger(input.returnDeliveryFee)) {
      issues.push({ field: "returnDeliveryFee", message: "반품 배송비를 입력해 주세요." });
    }
    if (!isNonNegativeInteger(input.exchangeDeliveryFee)) {
      issues.push({ field: "exchangeDeliveryFee", message: "교환 배송비를 입력해 주세요." });
    }
  }
  const greenCertificationId = String(input.greenCertificationId ?? "EXCLUDED").trim() || "EXCLUDED";
  if (greenCertificationId !== "EXCLUDED") {
    if (!String(input.greenCertificationName ?? "").trim()) {
      issues.push({ field: "greenCertificationName", message: "친환경 인증 기관을 선택해 주세요." });
    }
    if (!String(input.greenCertificationNumber ?? "").trim()) {
      issues.push({ field: "greenCertificationNumber", message: "친환경 인증번호를 입력해 주세요." });
    }
  }
  const unitPriceYn = String(input.unitPriceYn ?? "").trim();
  if (unitPriceYn !== "true" && unitPriceYn !== "false") {
    issues.push({ field: "unitPriceYn", message: "단위가격 사용 여부를 선택해 주세요." });
  } else if (unitPriceYn === "true") {
    if (!isValidTotalCapacity(input.totalCapacityValue)) {
      issues.push({ field: "totalCapacityValue", message: "총용량은 0.001 이상 숫자로 입력해 주세요." });
    }
    if (!isValidUnitCapacity(input.unitCapacity)) {
      issues.push({ field: "unitCapacity", message: "기준 용량은 1~999 사이 정수로 입력해 주세요." });
    }
    if (!UNIT_PRICE_UNITS.has(String(input.indicationUnit ?? "").trim())) {
      issues.push({ field: "indicationUnit", message: "단위가격 표시 단위를 선택해 주세요." });
    }
  }
  return issues;
}
