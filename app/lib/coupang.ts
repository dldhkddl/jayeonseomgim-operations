/**
 * 쿠팡 Open API
 *
 * 쿠팡은 상품명을 보내면 카테고리를 추천해 주는 API가 있다.
 * 과거 등록 상품으로 학습한 모델이라, 사람이 카테고리 트리를 뒤지는 것보다 빠르고 정확하다.
 *
 * 인증: HMAC-SHA256 서명을 Authorization 헤더에 담는다 (CEA 방식).
 *   message   = signedDate + method + path + query
 *   signature = hex( HMAC-SHA256(message, secretKey) )
 */

import type { ChannelInventoryItem } from "./inventory/channel-inventory.ts";

const HOST = "https://api-gateway.coupang.com";
const PREDICT_PATH = "/v2/providers/openapi/apis/api/v1/categorization/predict";
const CONNECTION_CHECK_PATH = "/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-related-metas/display-category-codes/72532";
const SELLER_PRODUCTS_PATH = "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";

export class CoupangApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/** yyMMdd'T'HHmmss'Z' (UTC) */
function signedDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    String(now.getUTCFullYear()).slice(2) +
    p(now.getUTCMonth() + 1) +
    p(now.getUTCDate()) +
    "T" +
    p(now.getUTCHours()) +
    p(now.getUTCMinutes()) +
    p(now.getUTCSeconds()) +
    "Z"
  );
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export async function buildAuthorization(
  accessKey: string,
  secretKey: string,
  method: string,
  path: string,
  query = "",
): Promise<string> {
  const date = signedDate();
  const signature = await hmacSha256Hex(secretKey, date + method + path + query);
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${date}, signature=${signature}`;
}

export type CoupangCredentials = { accessKey: string; secretKey: string };

export type CoupangSellerCredentials = CoupangCredentials & { vendorId: string };

export type CoupangSellerProductSummary = {
  sellerProductId: number | string;
  sellerProductName?: string;
  statusName?: string;
};

export type CoupangApprovalCandidate = {
  sellerProductId: string;
  sellerProductName: string;
  statusName: "임시저장";
};

export const COUPANG_APPROVAL_CONFIRMATION = "쿠팡 상품 승인요청";

export type CoupangProductImage = {
  imageOrder?: number;
  imageType?: string;
  cdnPath?: string;
  vendorPath?: string;
};

export type CoupangProductItem = {
  sellerProductItemId?: number | string;
  vendorItemId?: number | string | null;
  itemName?: string;
  externalVendorSku?: string;
  images?: CoupangProductImage[];
};

export type CoupangProductDetail = {
  sellerProductId: number | string;
  sellerProductName?: string;
  displayProductName?: string;
  statusName?: string;
  items?: CoupangProductItem[];
};

export type CoupangItemInventory = {
  sellerItemId?: number | string;
  amountInStock?: number;
  salePrice?: number;
  onSale?: boolean;
};

function coupangImageUrl(images: CoupangProductImage[] = []): string {
  const image = images.find((item) => item.imageType === "REPRESENTATION") ?? images[0];
  if (!image) return "";
  const vendorPath = String(image.vendorPath ?? "").trim();
  if (/^https?:\/\//i.test(vendorPath)) return vendorPath;
  const cdnPath = String(image.cdnPath ?? "").trim();
  if (!cdnPath) return "";
  if (/^https?:\/\//i.test(cdnPath)) return cdnPath;
  const normalized = cdnPath.replace(/^\/+/, "");
  return normalized.startsWith("image/")
    ? `https://image.coupangcdn.com/${normalized}`
    : `https://image.coupangcdn.com/image/${normalized}`;
}

function coupangStatus(inventory: CoupangItemInventory | undefined): string {
  if (!inventory) return "WAIT";
  if (inventory.onSale === false) return "SUSPENSION";
  return Math.max(0, Number(inventory.amountInStock) || 0) === 0 ? "OUTOFSTOCK" : "SALE";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchCoupangWithRetry(fetcher: typeof fetch, input: string, init: RequestInit) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetcher(input, init);
    if (response.status !== 429 || attempt === 3) return response;
    const retryAfter = Number(response.headers.get("Retry-After"));
    const delay = Number.isFinite(retryAfter)
      ? Math.min(Math.max(retryAfter * 1000, 0), 10_000)
      : 500 * 2 ** attempt;
    await wait(delay);
  }
  throw new Error("쿠팡 API 재시도에 실패했습니다.");
}

export function normalizeCoupangInventoryProduct(
  product: CoupangProductDetail,
  inventoryByVendorItemId: Map<string, CoupangItemInventory>,
): ChannelInventoryItem[] {
  const sellerProductId = String(product.sellerProductId ?? "").trim();
  const productName = String(product.displayProductName || product.sellerProductName || "").trim();
  return (product.items ?? []).flatMap((item) => {
    const vendorItemId = String(item.vendorItemId ?? "").trim();
    if (!vendorItemId) return [];
    const inventory = inventoryByVendorItemId.get(vendorItemId);
    return [{
      channel: "coupang",
      channelProductNo: vendorItemId,
      originProductNo: sellerProductId,
      imageUrl: coupangImageUrl(item.images),
      productName,
      sellerProductCode: String(item.externalVendorSku ?? "").trim(),
      options: item.itemName ? [String(item.itemName)] : [],
      collectedOrderCount: 0,
      collectedQuantity: 0,
      statusType: coupangStatus(inventory),
      stockQuantity: inventory && Number.isFinite(inventory.amountInStock)
        ? Math.max(0, Number(inventory.amountInStock))
        : null,
    }];
  });
}

async function coupangGet<T>(
  credentials: CoupangCredentials,
  path: string,
  query: string,
  fetcher: typeof fetch,
): Promise<T> {
  const authorization = await buildAuthorization(credentials.accessKey, credentials.secretKey, "GET", path, query);
  const url = `${HOST}${path}${query ? `?${query}` : ""}`;
  const response = await fetchCoupangWithRetry(fetcher, url, {
    method: "GET",
    headers: { Authorization: authorization, "Content-Type": "application/json;charset=UTF-8" },
  });
  const payload = await response.json().catch(() => null) as { code?: string | number; message?: string; data?: T } | null;
  if (!response.ok || payload?.code === "ERROR") {
    throw new CoupangApiError(payload?.message || "쿠팡 상품 조회에 실패했습니다.", response.status || 502, payload);
  }
  return payload?.data as T;
}

async function listCoupangSellerProducts(
  credentials: CoupangSellerCredentials,
  fetcher: typeof fetch,
): Promise<CoupangSellerProductSummary[]> {
  const vendorId = credentials.vendorId.trim();
  if (!/^A\d+$/.test(vendorId)) {
    throw new CoupangApiError("쿠팡 업체코드가 올바르지 않습니다.", 400, { vendorId });
  }

  const summaries: CoupangSellerProductSummary[] = [];
  let nextToken = "";
  const seenTokens = new Set<string>();
  do {
    const search = new URLSearchParams({ vendorId, maxPerPage: "100" });
    if (nextToken) search.set("nextToken", nextToken);
    const query = search.toString();
    const authorization = await buildAuthorization(credentials.accessKey, credentials.secretKey, "GET", SELLER_PRODUCTS_PATH, query);
    const response = await fetchCoupangWithRetry(fetcher, `${HOST}${SELLER_PRODUCTS_PATH}?${query}`, {
      method: "GET",
      headers: { Authorization: authorization, "Content-Type": "application/json;charset=UTF-8" },
    });
    const payload = await response.json().catch(() => null) as {
      code?: string | number;
      message?: string;
      nextToken?: string | number;
      data?: CoupangSellerProductSummary[];
    } | null;
    if (!response.ok || payload?.code === "ERROR") {
      throw new CoupangApiError(payload?.message || "쿠팡 상품 목록 조회에 실패했습니다.", response.status || 502, payload);
    }
    summaries.push(...(payload?.data ?? []));
    const candidate = String(payload?.nextToken ?? "").trim();
    nextToken = candidate && !seenTokens.has(candidate) ? candidate : "";
    if (nextToken) seenTokens.add(nextToken);
  } while (nextToken);
  return summaries;
}

export async function listCoupangApprovalCandidates(
  credentials: CoupangSellerCredentials,
  fetcher: typeof fetch = fetch,
): Promise<CoupangApprovalCandidate[]> {
  const summaries = await listCoupangSellerProducts(credentials, fetcher);
  return summaries.flatMap((product) => {
    const sellerProductId = String(product.sellerProductId ?? "").trim();
    if (!sellerProductId || product.statusName !== "임시저장") return [];
    return [{
      sellerProductId,
      sellerProductName: String(product.sellerProductName ?? "").trim(),
      statusName: "임시저장" as const,
    }];
  });
}

export async function requestCoupangProductApproval(
  credentials: CoupangSellerCredentials,
  sellerProductId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ sellerProductId: string; message: string }> {
  const normalizedId = String(sellerProductId ?? "").trim();
  if (!/^\d+$/.test(normalizedId)) {
    throw new CoupangApiError("쿠팡 상품 ID가 올바르지 않습니다.", 400, { sellerProductId });
  }
  const path = `${SELLER_PRODUCTS_PATH}/${normalizedId}/approvals`;
  const authorization = await buildAuthorization(credentials.accessKey, credentials.secretKey, "PUT", path);
  const response = await fetchCoupangWithRetry(fetcher, `${HOST}${path}`, {
    method: "PUT",
    headers: { Authorization: authorization, "Content-Type": "application/json;charset=UTF-8" },
  });
  const payload = await response.json().catch(() => null) as {
    code?: string | number;
    message?: string;
    data?: string | number;
  } | null;
  if (!response.ok || payload?.code === "ERROR") {
    throw new CoupangApiError(payload?.message || "쿠팡 상품 승인요청에 실패했습니다.", response.status || 502, payload);
  }
  return {
    sellerProductId: String(payload?.data ?? normalizedId),
    message: payload?.message || "승인 요청되었습니다.",
  };
}

export async function approveCoupangDraftProducts(
  credentials: CoupangSellerCredentials,
  sellerProductIds: string[],
  confirmation: string,
  fetcher: typeof fetch = fetch,
): Promise<Array<{ sellerProductId: string; message: string }>> {
  if (confirmation !== COUPANG_APPROVAL_CONFIRMATION) {
    throw new CoupangApiError("쿠팡 승인요청 확인 문구가 정확하지 않습니다.", 400);
  }
  const uniqueIds = [...new Set(sellerProductIds.map((id) => String(id ?? "").trim()))];
  if (!uniqueIds.length || uniqueIds.length > 100 || uniqueIds.some((id) => !/^\d+$/.test(id))) {
    throw new CoupangApiError("승인요청할 쿠팡 상품 ID를 1개 이상 100개 이하로 선택해 주세요.", 400);
  }

  const candidates = await listCoupangApprovalCandidates(credentials, fetcher);
  const candidateIds = new Set(candidates.map((item) => item.sellerProductId));
  const unavailable = uniqueIds.filter((id) => !candidateIds.has(id));
  if (unavailable.length) {
    throw new CoupangApiError(`임시저장 상태가 아닌 상품이 포함되어 승인요청을 중단했습니다: ${unavailable.join(", ")}`, 409, { unavailable });
  }

  const results: Array<{ sellerProductId: string; message: string }> = [];
  for (const sellerProductId of uniqueIds) {
    results.push(await requestCoupangProductApproval(credentials, sellerProductId, fetcher));
  }
  return results;
}

async function coupangWrite(
  credentials: CoupangCredentials,
  method: "PUT" | "DELETE",
  path: string,
  fallbackMessage: string,
  fetcher: typeof fetch,
): Promise<{ message: string; data?: string }> {
  const authorization = await buildAuthorization(credentials.accessKey, credentials.secretKey, method, path);
  const response = await fetchCoupangWithRetry(fetcher, `${HOST}${path}`, {
    method,
    headers: { Authorization: authorization, "Content-Type": "application/json;charset=UTF-8" },
  });
  const payload = await response.json().catch(() => null) as {
    code?: string | number;
    message?: string;
    data?: string | number;
  } | null;
  if (!response.ok || payload?.code === "ERROR") {
    throw new CoupangApiError(payload?.message || fallbackMessage, response.status || 502, payload);
  }
  return {
    message: payload?.message || fallbackMessage.replace("실패했습니다.", "완료했습니다."),
    ...(payload?.data == null ? {} : { data: String(payload.data) }),
  };
}

export async function changeCoupangStock(
  credentials: CoupangSellerCredentials,
  vendorItemId: string,
  stockQuantity: number,
  fetcher: typeof fetch = fetch,
): Promise<{ message: string }> {
  const normalizedId = String(vendorItemId ?? "").trim();
  if (!/^\d+$/.test(normalizedId)) throw new CoupangApiError("쿠팡 옵션 ID가 올바르지 않습니다.", 400);
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 99_999) {
    throw new CoupangApiError("쿠팡 재고는 0 이상 99,999 이하의 정수로 입력해 주세요.", 400);
  }
  const path = `${SELLER_PRODUCTS_PATH.replace("seller-products", "vendor-items")}/${normalizedId}/quantities/${stockQuantity}`;
  return coupangWrite(credentials, "PUT", path, "쿠팡 재고 변경에 실패했습니다.", fetcher);
}

export async function changeCoupangStockAndVerify(
  credentials: CoupangSellerCredentials,
  vendorItemId: string,
  stockQuantity: number,
  fetcher: typeof fetch = fetch,
  delay: (milliseconds: number) => Promise<unknown> = wait,
) {
  await changeCoupangStock(credentials, vendorItemId, stockQuantity, fetcher);
  const normalizedId = String(vendorItemId ?? "").trim();
  const inventoryPath = `${SELLER_PRODUCTS_PATH.replace("seller-products", "vendor-items")}/${encodeURIComponent(normalizedId)}/inventories`;
  let observedQuantity: number | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const inventory = await coupangGet<CoupangItemInventory>(credentials, inventoryPath, "", fetcher);
    observedQuantity = Number.isFinite(inventory?.amountInStock) ? Math.max(0, Number(inventory.amountInStock)) : null;
    if (observedQuantity === stockQuantity) {
      return { message: "쿠팡 재고 변경을 확인했습니다.", stockQuantity: observedQuantity };
    }
    if (attempt < 3) await delay(750 * (attempt + 1));
  }
  throw new CoupangApiError(
    `쿠팡이 재고 변경 요청을 접수했지만 조회값은 아직 ${observedQuantity ?? "미확인"}개입니다. 잠시 후 다시 확인해 주세요.`,
    409,
    { vendorItemId: normalizedId, requestedQuantity: stockQuantity, observedQuantity },
  );
}

export async function changeCoupangSalesStatus(
  credentials: CoupangSellerCredentials,
  vendorItemId: string,
  statusType: "SALE" | "SUSPENSION",
  fetcher: typeof fetch = fetch,
): Promise<{ message: string }> {
  const normalizedId = String(vendorItemId ?? "").trim();
  if (!/^\d+$/.test(normalizedId)) throw new CoupangApiError("쿠팡 옵션 ID가 올바르지 않습니다.", 400);
  if (statusType !== "SALE" && statusType !== "SUSPENSION") {
    throw new CoupangApiError("쿠팡 판매 상태는 판매중 또는 판매중지만 변경할 수 있습니다.", 400);
  }
  const action = statusType === "SALE" ? "resume" : "stop";
  const path = `${SELLER_PRODUCTS_PATH.replace("seller-products", "vendor-items")}/${normalizedId}/sales/${action}`;
  return coupangWrite(credentials, "PUT", path, "쿠팡 판매 상태 변경에 실패했습니다.", fetcher);
}

export async function deleteCoupangProduct(
  credentials: CoupangSellerCredentials,
  sellerProductId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ sellerProductId: string; message: string }> {
  const normalizedId = String(sellerProductId ?? "").trim();
  if (!/^\d+$/.test(normalizedId)) throw new CoupangApiError("쿠팡 상품 ID가 올바르지 않습니다.", 400);
  const result = await coupangWrite(
    credentials,
    "DELETE",
    `${SELLER_PRODUCTS_PATH}/${normalizedId}`,
    "쿠팡 상품 영구삭제에 실패했습니다.",
    fetcher,
  );
  return { sellerProductId: result.data ?? normalizedId, message: result.message };
}

export async function collectCoupangInventory(
  credentials: CoupangSellerCredentials,
  fetcher: typeof fetch = fetch,
): Promise<ChannelInventoryItem[]> {
  const summaries = await listCoupangSellerProducts(credentials, fetcher);

  const result: ChannelInventoryItem[] = [];
  for (const summary of summaries) {
    const sellerProductId = String(summary.sellerProductId ?? "").trim();
    if (!sellerProductId) continue;
    const detailPath = `${SELLER_PRODUCTS_PATH}/${encodeURIComponent(sellerProductId)}`;
    const detail = await coupangGet<CoupangProductDetail>(credentials, detailPath, "", fetcher);
    const inventoryByVendorItemId = new Map<string, CoupangItemInventory>();
    for (const item of detail.items ?? []) {
      const vendorItemId = String(item.vendorItemId ?? "").trim();
      if (!vendorItemId) continue;
      const inventoryPath = `${SELLER_PRODUCTS_PATH.replace("seller-products", "vendor-items")}/${encodeURIComponent(vendorItemId)}/inventories`;
      inventoryByVendorItemId.set(vendorItemId, await coupangGet<CoupangItemInventory>(credentials, inventoryPath, "", fetcher));
    }
    result.push(...normalizeCoupangInventoryProduct(detail, inventoryByVendorItemId));
  }
  return result;
}

export async function verifyCoupangConnection(
  { accessKey, secretKey }: CoupangCredentials,
  fetcher: typeof fetch = fetch,
): Promise<true> {
  const authorization = await buildAuthorization(accessKey, secretKey, "GET", CONNECTION_CHECK_PATH);
  const response = await fetcher(`${HOST}${CONNECTION_CHECK_PATH}`, {
    method: "GET",
    headers: { Authorization: authorization, "Content-Type": "application/json;charset=UTF-8" },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { message?: string } | null;
    throw new CoupangApiError(data?.message || "쿠팡 API 인증에 실패했습니다.", response.status, data);
  }
  return true;
}

export type PredictedCategory = {
  ok: boolean;
  categoryId?: string;
  categoryName?: string;
  /** 쿠팡이 판단하지 못한 경우의 사유 */
  reason?: string;
};

/**
 * 상품명으로 쿠팡 카테고리를 추천받는다.
 *
 * 상품명이 검색 키워드 나열식("사과 부사 선물 과일 산지직송")이면 정확도가 떨어진다.
 * 쿠팡 문서도 사람이 봐도 알기 어려운 이름은 모델도 못 맞힌다고 안내한다.
 */
export async function predictCategory(
  { accessKey, secretKey }: CoupangCredentials,
  input: { productName: string; brand?: string; attributes?: Record<string, string> },
): Promise<PredictedCategory> {
  const authorization = await buildAuthorization(accessKey, secretKey, "POST", PREDICT_PATH);

  const res = await fetch(`${HOST}${PREDICT_PATH}`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({
      productName: input.productName,
      ...(input.brand ? { brand: input.brand } : {}),
      ...(input.attributes ? { attributes: input.attributes } : {}),
    }),
  });

  const data = (await res.json().catch(() => null)) as {
    code?: string | number;
    message?: string;
    data?: {
      autoCategorizationPredictionResultType?: string;
      predictedCategoryId?: string | number;
      predictedCategoryName?: string;
      comment?: string;
    };
  } | null;

  if (!res.ok) {
    throw new CoupangApiError(
      data?.message || "쿠팡 카테고리 추천에 실패했습니다. ACCESS KEY / SECRET KEY를 확인해 주세요.",
      res.status,
      data,
    );
  }

  const result = data?.data;
  if (result?.autoCategorizationPredictionResultType !== "SUCCESS" || !result?.predictedCategoryId) {
    return { ok: false, reason: result?.comment || data?.message || "쿠팡이 카테고리를 판단하지 못했습니다." };
  }

  return {
    ok: true,
    categoryId: String(result.predictedCategoryId),
    categoryName: result.predictedCategoryName ?? "",
  };
}
