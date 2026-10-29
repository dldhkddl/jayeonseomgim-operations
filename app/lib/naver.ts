import bcrypt from "bcryptjs";

const TOKEN_URL = "https://api.commerce.naver.com/external/v1/oauth2/token";
const IMAGE_UPLOAD_URL = "https://api.commerce.naver.com/external/v1/product-images/upload";
const PRODUCT_URL = "https://api.commerce.naver.com/external/v2/products";

export type NaverCredentials = { clientId: string; clientSecret: string };
export type NaverApiStage = "인증" | "이미지 업로드" | "상품 정보 전송" | "상품 정보 조회" | "전체 상품 조회" | "판매중지" | "발송 처리" | "재고 조회" | "재고 수정";

export class NaverApiError extends Error {
  status: number;
  detail: unknown;
  stage: NaverApiStage;
  constructor(message: string, status: number, detail: unknown, stage: NaverApiStage) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.stage = stage;
  }
}

const NAVER_API_STAGES: NaverApiStage[] = ["인증", "이미지 업로드", "상품 정보 전송", "상품 정보 조회", "전체 상품 조회", "판매중지", "발송 처리", "재고 조회", "재고 수정"];

export function isNaverApiError(error: unknown): error is NaverApiError {
  if (!error || typeof error !== "object") return false;

  const candidate = error as Partial<NaverApiError>;
  return (
    typeof candidate.message === "string" &&
    typeof candidate.status === "number" &&
    NAVER_API_STAGES.includes(candidate.stage as NaverApiStage)
  );
}

/**
 * 네이버 커머스 API 전자서명 생성.
 * signature = base64( bcrypt(`${clientId}_${timestamp}`, clientSecret) )
 * clientSecret 자체가 bcrypt salt 형식(`$2a$...`)으로 발급됩니다.
 */
function buildSignature(clientId: string, clientSecret: string, timestamp: string) {
  const password = `${clientId}_${timestamp}`;
  const hashed = bcrypt.hashSync(password, clientSecret);
  return Buffer.from(hashed, "utf-8").toString("base64");
}

export async function getAccessToken({ clientId, clientSecret }: NaverCredentials) {
  const timestamp = Date.now().toString();
  const signature = buildSignature(clientId, clientSecret, timestamp);

  const body = new URLSearchParams({
    client_id: clientId,
    timestamp,
    client_secret_sign: signature,
    grant_type: "client_credentials",
    type: "SELF",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; message?: string; [k: string]: unknown }
    | null;

  if (!res.ok || !data?.access_token) {
    throw new NaverApiError(
      (data as { message?: string } | null)?.message || "네이버 인증에 실패했습니다. Client ID/Secret을 확인해 주세요.",
      res.status,
      data,
      "인증",
    );
  }

  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 10800 };
}

export async function uploadProductImage(accessToken: string, file: File) {
  const form = new FormData();
  form.append("imageFiles", file, file.name || "image.jpg");

  const res = await fetch(IMAGE_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  const data = (await res.json().catch(() => null)) as
    | { images?: { url: string }[]; message?: string }
    | null;

  if (!res.ok || !data?.images?.length) {
    throw new NaverApiError(
      (data as { message?: string } | null)?.message || "상품 이미지 업로드에 실패했습니다.",
      res.status,
      data,
      "이미지 업로드",
    );
  }

  return data.images[0].url;
}

export type RegisterProductInput = {
  accessToken: string;
  leafCategoryId: string;
  name: string;
  sellerProductCode: string;
  salePrice: number;
  stockQuantity: number;
  representativeImageUrl: string;
  optionalImageUrls: string[];
  detailContentHtml: string;
  originAreaContent: string;
  originAreaCode: string;
  afterServiceTelephoneNumber: string;
  afterServiceGuideContent: string;
  weight: string;
  producer: string;
  storage: string;
  deliveryCompany: string;
  returnDeliveryFee: number;
  exchangeDeliveryFee: number;
  greenCertificationId: string;
  greenCertificationName: string;
  greenCertificationNumber: string;
  unitPriceYn: boolean;
  totalCapacityValue: number;
  unitCapacity: number;
  indicationUnit: string;
};

export function buildNaverProductPayload(input: Omit<RegisterProductInput, "accessToken">) {
  const detailReference = "상품 상세 참조";
  const productWeight = input.weight || detailReference;
  const producer = input.producer || detailReference;
  const storage = input.storage || detailReference;
  const greenCertificationId = input.greenCertificationId?.trim() || "EXCLUDED";
  const hasGreenCertification = greenCertificationId !== "EXCLUDED";

  return {
    originProduct: {
      statusType: "SALE",
      saleType: "NEW",
      leafCategoryId: input.leafCategoryId,
      name: input.name.slice(0, 100),
      detailContent: input.detailContentHtml,
      images: {
        representativeImage: { url: input.representativeImageUrl },
        optionalImages: input.optionalImageUrls.map((url) => ({ url })),
      },
      salePrice: input.salePrice,
      stockQuantity: input.stockQuantity,
      deliveryInfo: {
        deliveryType: "DELIVERY",
        deliveryAttributeType: "NORMAL",
        deliveryCompany: input.deliveryCompany,
        deliveryFee: { deliveryFeeType: "FREE" },
        claimDeliveryInfo: {
          returnDeliveryFee: input.returnDeliveryFee,
          exchangeDeliveryFee: input.exchangeDeliveryFee,
        },
      },
      detailAttribute: {
        minorPurchasable: true,
        unitCapacity: input.unitPriceYn
          ? {
              unitPriceYn: true,
              totalCapacityValue: input.totalCapacityValue,
              unitCapacity: input.unitCapacity,
              indicationUnit: input.indicationUnit,
            }
          : { unitPriceYn: false },
        ...(hasGreenCertification
          ? {
              productCertificationInfos: [{
                certificationInfoId: Number(greenCertificationId),
                certificationKindType: "GREEN_PRODUCTS",
                name: input.greenCertificationName,
                certificationNumber: input.greenCertificationNumber,
                certificationMark: true,
              }],
            }
          : {}),
        certificationTargetExcludeContent: {
          greenCertifiedProductExclusionYn: !hasGreenCertification,
        },
        afterServiceInfo: {
          afterServiceTelephoneNumber: input.afterServiceTelephoneNumber,
          afterServiceGuideContent: input.afterServiceGuideContent,
        },
        originAreaInfo: {
          originAreaCode: input.originAreaCode,
          content: input.originAreaContent,
        },
        productInfoProvidedNotice: {
          productInfoProvidedNoticeType: "FOOD",
          food: {
            returnCostReason: "1",
            noRefundReason: "1",
            qualityAssuranceStandard: "1",
            compensationProcedure: "1",
            troubleShootingContents: "1",
            foodItem: input.name,
            weight: productWeight,
            amount: productWeight,
            size: productWeight,
            packDateText: detailReference,
            consumptionDateText: detailReference,
            producer,
            productComposition: productWeight,
            keep: storage,
            adCaution: detailReference,
            customerServicePhoneNumber: input.afterServiceTelephoneNumber,
          },
        },
        sellerCodeInfo: { sellerManagementCode: input.sellerProductCode },
      },
    },
    smartstoreChannelProduct: {
      naverShoppingRegistration: true,
      channelProductDisplayStatusType: "ON",
    },
  };
}

export async function registerProduct(input: RegisterProductInput) {
  const payload = buildNaverProductPayload(input);

  let res: Response;
  try {
    res = await fetch(PRODUCT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (isNaverApiError(error)) throw error;
    throw new NaverApiError(
      error instanceof Error ? error.message : "네이버 상품 등록 서버에 연결하지 못했습니다.",
      502,
      null,
      "상품 정보 전송",
    );
  }

  const data = (await res.json().catch(() => null)) as
    | { productNo?: string | number; originProductNo?: string | number; message?: string; invalidInputs?: unknown }
    | null;

  if (!res.ok) {
    throw new NaverApiError(
      (data as { message?: string } | null)?.message || "네이버 상품 등록에 실패했습니다.",
      res.status,
      data,
      "상품 정보 전송",
    );
  }

  return data;
}

/** 스마트스토어 채널 상품번호로 기존 원상품·상세 HTML·이미지를 조회한다. */
export async function readNaverChannelProduct(accessToken: string, channelProductNo: string) {
  const normalized = channelProductNo.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new NaverApiError("네이버 상품번호는 숫자만 사용할 수 있습니다.", 400, { channelProductNo }, "상품 정보 조회");
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${PRODUCT_URL}/channel-products/${encodeURIComponent(normalized)}`, {
      headers: {
        Accept: "application/json;charset=UTF-8",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = await res.json().catch(() => null);
    if (res.ok) return data;

    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      continue;
    }
    throw new NaverApiError(
      (data as { message?: string } | null)?.message || `네이버 상품번호 ${normalized} 조회에 실패했습니다.`,
      res.status,
      data,
      "상품 정보 조회",
    );
  }
  throw new NaverApiError(`네이버 상품번호 ${normalized} 조회에 실패했습니다.`, 503, null, "상품 정보 조회");
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function isTrustedLocalOperationUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function isTrustedLocalMutationRequest(request: Request) {
  if (!isTrustedLocalOperationUrl(request.url) || request.method !== "POST") return false;
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const contentType = request.headers.get("content-type") ?? "";
  return origin === requestUrl.origin && fetchSite === "same-origin" && contentType.toLowerCase().startsWith("application/json");
}

export type NaverDispatchInput = {
  productOrderId: string;
  deliveryMethod: "DELIVERY";
  deliveryCompanyCode: string;
  trackingNumber: string;
};

/** 네이버 발송 처리는 한 요청에 최대 30건만 허용된다. */
export async function dispatchProductOrders(accessToken: string, rows: NaverDispatchInput[], fetcher: Fetcher = fetch) {
  if (!rows.length) throw new NaverApiError("발송 처리할 주문이 없습니다.", 400, null, "발송 처리");
  if (rows.length > 30) throw new NaverApiError("네이버 발송 처리는 한 번에 최대 30건까지 가능합니다.", 400, { count: rows.length }, "발송 처리");
  const ids = rows.map((row) => row.productOrderId.trim());
  if (new Set(ids).size !== ids.length) throw new NaverApiError("같은 상품주문번호가 중복되어 있습니다.", 400, null, "발송 처리");
  if (rows.some((row) => !row.productOrderId.trim() || !row.deliveryCompanyCode.trim() || !row.trackingNumber.trim())) {
    throw new NaverApiError("상품주문번호·택배사·송장번호를 모두 입력해 주세요.", 400, null, "발송 처리");
  }

  const response = await fetcher("https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json;charset=UTF-8", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ dispatchProductOrders: rows }),
  });
  const payload = await response.json().catch(() => null) as { data?: unknown; message?: string } | null;
  if (!response.ok) throw new NaverApiError(payload?.message || "네이버 송장 전송에 실패했습니다.", response.status, payload, "발송 처리");
  return payload?.data ?? payload;
}

export type NaverInventory = {
  channelProductNo: string;
  originProductNo: string;
  name: string;
  sellerManagementCode: string;
  statusType: string;
  stockQuantity: number | null;
};

export type NaverCatalogProduct = NaverInventory & { imageUrl: string };

export function extractNaverStockQuantity(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const originProduct = (payload as { originProduct?: unknown }).originProduct;
  if (!originProduct || typeof originProduct !== "object") return null;
  const direct = (originProduct as { stockQuantity?: unknown }).stockQuantity;
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.max(0, direct);

  const optionInfo = (originProduct as { optionInfo?: unknown }).optionInfo;
  if (!optionInfo || typeof optionInfo !== "object") return null;
  const combinations = (optionInfo as { optionCombinations?: unknown }).optionCombinations;
  if (!Array.isArray(combinations) || combinations.length === 0) return null;
  const quantities = combinations.map((option) => option && typeof option === "object"
    ? (option as { stockQuantity?: unknown }).stockQuantity
    : undefined);
  if (quantities.some((quantity) => typeof quantity !== "number" || !Number.isFinite(quantity))) return null;
  return quantities.reduce<number>((sum, quantity) => sum + Math.max(0, quantity as number), 0);
}

/** 채널 상품번호로 현재 원상품번호와 판매 재고를 조회한다. */
export async function readNaverInventory(accessToken: string, channelProductNo: string, fetcher: Fetcher = fetch): Promise<NaverInventory> {
  const normalized = channelProductNo.trim();
  if (!/^\d+$/.test(normalized)) throw new NaverApiError("네이버 채널 상품번호는 숫자만 입력해 주세요.", 400, null, "재고 조회");
  const response = await fetcher("https://api.commerce.naver.com/external/v1/products/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json;charset=UTF-8", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ searchKeywordType: "CHANNEL_PRODUCT_NO", channelProductNos: [Number(normalized)], page: 1, size: 1 }),
  });
  const payload = await response.json().catch(() => null) as {
    contents?: Array<{ originProductNo?: number | string; channelProducts?: Array<{ channelProductNo?: number | string; name?: string; sellerManagementCode?: string; statusType?: string; stockQuantity?: number }> }>;
    message?: string;
  } | null;
  if (!response.ok) throw new NaverApiError(payload?.message || "네이버 재고 조회에 실패했습니다.", response.status, payload, "재고 조회");
  const content = payload?.contents?.find((item) => item.channelProducts?.some((product) => String(product.channelProductNo) === normalized));
  const product = content?.channelProducts?.find((item) => String(item.channelProductNo) === normalized);
  if (!content?.originProductNo || !product) throw new NaverApiError("해당 네이버 상품의 재고 정보를 찾지 못했습니다.", 404, payload, "재고 조회");
  return {
    channelProductNo: String(product.channelProductNo ?? normalized),
    originProductNo: String(content.originProductNo),
    name: product.name ?? "",
    sellerManagementCode: product.sellerManagementCode ?? "",
    statusType: product.statusType ?? "",
    stockQuantity: typeof product.stockQuantity === "number" && Number.isFinite(product.stockQuantity)
      ? Math.max(0, product.stockQuantity)
      : null,
  };
}

/** 네이버 스마트스토어에 등록된 모든 채널 상품을 페이지 끝까지 조회한다. */
export async function searchAllNaverProducts(accessToken: string, fetcher: Fetcher = fetch): Promise<NaverCatalogProduct[]> {
  const products = new Map<string, NaverCatalogProduct>();
  let page = 1;
  let totalPages = 1;
  do {
    const response = await fetcher("https://api.commerce.naver.com/external/v1/products/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json;charset=UTF-8", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ page, size: 500, orderType: "NO" }),
    });
    const payload = await response.json().catch(() => null) as {
      contents?: Array<{
        originProductNo?: number | string;
        channelProducts?: Array<{
          channelServiceType?: string; channelProductNo?: number | string; name?: string; sellerManagementCode?: string;
          statusType?: string; stockQuantity?: number; representativeImage?: { url?: string };
        }>;
      }>;
      totalPages?: number; last?: boolean; message?: string;
    } | null;
    if (!response.ok) throw new NaverApiError(payload?.message || "네이버 전체 상품 조회에 실패했습니다.", response.status, payload, "전체 상품 조회");

    for (const content of payload?.contents ?? []) {
      for (const product of content.channelProducts ?? []) {
        if (product.channelServiceType && product.channelServiceType !== "STOREFARM") continue;
        const channelProductNo = String(product.channelProductNo ?? "").trim();
        if (!channelProductNo) continue;
        products.set(channelProductNo, {
          channelProductNo,
          originProductNo: String(content.originProductNo ?? ""),
          name: product.name ?? "",
          sellerManagementCode: product.sellerManagementCode ?? "",
          statusType: product.statusType ?? "",
          stockQuantity: typeof product.stockQuantity === "number" && Number.isFinite(product.stockQuantity) ? Math.max(0, product.stockQuantity) : null,
          imageUrl: product.representativeImage?.url ?? "",
        });
      }
    }
    totalPages = Math.max(1, Number(payload?.totalPages) || 1);
    if (payload?.last === true) break;
    page += 1;
  } while (page <= totalPages);
  return [...products.values()];
}

/** 최종 확인을 마친 원상품 하나를 네이버 판매 중지 상태로 변경한다. */
export async function suspendNaverProduct(accessToken: string, originProductNo: string, fetcher: Fetcher = fetch) {
  const normalized = originProductNo.trim();
  if (!/^\d+$/.test(normalized)) throw new NaverApiError("네이버 원상품번호가 올바르지 않습니다.", 400, null, "판매중지");
  const response = await fetcher(`https://api.commerce.naver.com/external/v1/products/origin-products/${encodeURIComponent(normalized)}/change-status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json;charset=UTF-8", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ statusType: "SUSPENSION" }),
  });
  const payload = await response.json().catch(() => null) as { message?: string; [key: string]: unknown } | null;
  if (!response.ok) throw new NaverApiError(payload?.message || "네이버 상품 판매중지에 실패했습니다.", response.status, payload, "판매중지");
  return payload;
}

/** 판매 중지된 원상품을 재고 수량 변경 없이 판매 중 상태로 되돌린다. */
export async function resumeNaverProduct(accessToken: string, originProductNo: string, fetcher: Fetcher = fetch) {
  const normalized = originProductNo.trim();
  if (!/^\d+$/.test(normalized)) throw new NaverApiError("네이버 원상품번호가 올바르지 않습니다.", 400, null, "판매재개");
  const response = await fetcher(`https://api.commerce.naver.com/external/v1/products/origin-products/${encodeURIComponent(normalized)}/change-status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json;charset=UTF-8", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ statusType: "SALE" }),
  });
  const payload = await response.json().catch(() => null) as { message?: string; [key: string]: unknown } | null;
  if (!response.ok) throw new NaverApiError(payload?.message || "네이버 상품 판매재개에 실패했습니다.", response.status, payload, "판매재개");
  return payload;
}

export async function changeNaverProductStatus(
  accessToken: string,
  originProductNo: string,
  statusType: "SALE" | "SUSPENSION",
  fetcher: Fetcher = fetch,
) {
  if (statusType === "SUSPENSION") return suspendNaverProduct(accessToken, originProductNo, fetcher);
  if (statusType === "SALE") return resumeNaverProduct(accessToken, originProductNo, fetcher);
  throw new NaverApiError("지원하지 않는 판매 상태입니다.", 400, { statusType }, "판매 상태 변경");
}

/** 네이버 원상품을 영구 삭제한다. 성공 후 복구할 수 없으므로 호출 전 사용자 확인이 필요하다. */
export async function deleteNaverProduct(accessToken: string, originProductNo: string, fetcher: Fetcher = fetch) {
  const normalized = originProductNo.trim();
  if (!/^\d+$/.test(normalized)) throw new NaverApiError("네이버 원상품번호가 올바르지 않습니다.", 400, null, "상품 영구삭제");
  const response = await fetcher(`https://api.commerce.naver.com/external/v2/products/origin-products/${encodeURIComponent(normalized)}`, {
    method: "DELETE",
    headers: { Accept: "application/json;charset=UTF-8", Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null) as { message?: string; [key: string]: unknown } | null;
  if (!response.ok) throw new NaverApiError(payload?.message || "네이버 상품 영구삭제에 실패했습니다.", response.status, payload, "상품 영구삭제");
  return payload;
}

/** 단일 원상품의 판매 가능 재고를 바꾸며 0개는 품절 상태로 함께 전환한다. */
export async function changeNaverStock(accessToken: string, originProductNo: string, stockQuantity: number, fetcher: Fetcher = fetch) {
  const normalized = originProductNo.trim();
  if (!/^\d+$/.test(normalized)) throw new NaverApiError("네이버 원상품번호가 올바르지 않습니다.", 400, null, "재고 수정");
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 99_999_999) {
    throw new NaverApiError("재고는 0부터 99,999,999 사이의 정수로 입력해 주세요.", 400, { stockQuantity }, "재고 수정");
  }
  const response = await fetcher("https://api.commerce.naver.com/external/v1/products/origin-products/multi-update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json;charset=UTF-8", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      multiProductUpdateRequestVos: [{ originProductNo: Number(normalized), multiUpdateTypes: ["STOCK"], stockQuantity }],
    }),
  });
  const payload = await response.json().catch(() => null) as { message?: string; [key: string]: unknown } | null;
  if (!response.ok) throw new NaverApiError(payload?.message || "네이버 재고 수정에 실패했습니다.", response.status, payload, "재고 수정");
  return payload;
}
