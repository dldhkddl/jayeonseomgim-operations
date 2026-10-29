/**
 * 카페24 Admin API
 *
 * 인증: OAuth 2.0 Authorization Code 방식 (네이버·쿠팡의 client_credentials와 다르다).
 *   1) 판매자가 브라우저에서 인가 화면에 딱 한 번 로그인해서 권한을 승인한다.
 *   2) 카페24가 우리 콜백 주소로 code를 보내준다 (1분 안에 교환해야 함).
 *   3) code를 access_token/refresh_token으로 교환한다.
 *   4) access_token은 2시간마다 만료 → refresh_token으로 자동 갱신.
 *
 * 상품 등록(createProduct)의 정확한 요청 필드는 카페24 문서 사이트가 예시 코드를
 * 자바스크립트로 그때그때 그려주는 방식이라 자동으로 확인하지 못했다.
 * 아래는 카페24 REST API가 공통으로 쓰는 형태(shop_no + request 래핑)를 따라 최선으로 작성한
 * 것이며, 실제 호출 전에 반드시 개발자센터의 "Create a product" 예시와 대조해야 한다.
 */

const TOKEN_PATH = "/api/v2/oauth/token";
const AUTHORIZE_PATH = "/api/v2/oauth/authorize";

export class Cafe24ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export type Cafe24App = { mallId: string; clientId: string; clientSecret: string };

function apiBase(mallId: string) {
  return `https://${mallId}.cafe24api.com`;
}

function basicAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf-8").toString("base64")}`;
}

/** 판매자가 로그인해서 권한을 승인할 주소. 여기로 안내한 뒤 code를 돌려받는다. */
export function buildAuthorizeUrl(
  app: Pick<Cafe24App, "mallId" | "clientId">,
  opts: { redirectUri: string; state: string; scopes: string[] },
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: app.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: opts.scopes.join(" "),
  });
  return `${apiBase(app.mallId)}${AUTHORIZE_PATH}?${params.toString()}`;
}

export function readOAuthCallback(input: string): {
  code: string | null;
  state: string | null;
  errorMessage: string | null;
} {
  const url = new URL(input);
  const error = url.searchParams.get("error");
  const description = url.searchParams.get("error_description");
  return {
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    errorMessage: error ? `${description || "카페24가 인증 요청을 거부했습니다."} (${error})` : null,
  };
}

export type Cafe24Token = {
  accessToken: string;
  refreshToken: string;
  /** ISO 문자열 */
  expiresAt: string;
  scopes: string;
};

async function parseTokenResponse(res: Response): Promise<Cafe24Token> {
  const data = (await res.json().catch(() => null)) as
    | {
        access_token?: string;
        refresh_token?: string;
        expires_at?: string;
        scopes?: string[] | string;
        error?: string;
        error_description?: string;
      }
    | null;

  if (!res.ok || !data?.access_token) {
    throw new Cafe24ApiError(
      data?.error_description || data?.error || "카페24 인증에 실패했습니다.",
      res.status,
      data,
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    // 카페24가 만료 시각을 안 주면 보수적으로 1시간 50분 후로 잡아, 실제 만료 전에 갱신되게 한다
    expiresAt: data.expires_at ?? new Date(Date.now() + 110 * 60 * 1000).toISOString(),
    scopes: Array.isArray(data.scopes) ? data.scopes.join(",") : data.scopes ?? "",
  };
}

/** 인가 화면에서 받은 code를 실제 토큰으로 바꾼다. code는 1분 안에 써야 한다. */
export async function exchangeCodeForToken(app: Cafe24App, code: string, redirectUri: string): Promise<Cafe24Token> {
  const res = await fetch(`${apiBase(app.mallId)}${TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(app.clientId, app.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
  });
  return parseTokenResponse(res);
}

/** access_token이 만료됐을 때 refresh_token으로 새 토큰을 받는다 */
export async function refreshAccessToken(app: Cafe24App, refreshToken: string): Promise<Cafe24Token> {
  const res = await fetch(`${apiBase(app.mallId)}${TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(app.clientId, app.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });
  return parseTokenResponse(res);
}

export type CreateProductInput = {
  mallId: string;
  accessToken: string;
  productName: string;
  price: number;
  supplyPrice?: number;
  summary?: string;
  descriptionHtml?: string;
  images: string[];
  /** "T"=전시함, "F"=전시안함 (카페24 관례) */
  display?: "T" | "F";
  /** "T"=판매함, "F"=판매안함 */
  selling?: "T" | "F";
};

export type CreateProductResult = { ok: boolean; productNo?: string; raw?: unknown };

/** 카페24 등록 요청은 모든 상품을 국내산(F)으로 고정한다. */
export function buildCafe24ProductPayload(input: CreateProductInput) {
  return {
    shop_no: 1,
    request: {
      product_name: input.productName,
      price: String(input.price),
      ...(input.supplyPrice ? { supply_price: String(input.supplyPrice) } : {}),
      product_condition: "N",
      display: input.display ?? "T",
      selling: input.selling ?? "T",
      summary_description: input.summary ?? "",
      description: input.descriptionHtml ?? "",
      detail_image: input.images[0] ?? "",
      list_image: input.images[0] ?? "",
      tiny_image: input.images[0] ?? "",
      small_image: input.images[0] ?? "",
      additional_images: input.images.slice(1, 20).map((url) => ({ url })),
      origin_classification: "F",
    },
  };
}

/**
 * ⚠️ 미확인 — 실제 카페24 "상품 생성" API 응답/필드명과 대조 전입니다.
 * 카페24 REST API는 보통 { shop_no, request: {...} } 형태로 감싸서 보냅니다.
 * 잘못된 필드는 카페24가 400과 함께 구체적인 오류 메시지를 돌려주므로,
 * 첫 실제 호출에서 그 오류 메시지를 보고 필드명을 맞추면 됩니다.
 */
export async function createProduct(input: CreateProductInput): Promise<CreateProductResult> {
  const body = buildCafe24ProductPayload(input);

  const res = await fetch(`${apiBase(input.mallId)}/api/v2/admin/products`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": "2025-06-01",
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => null)) as
    | { product?: { product_no?: number | string }; error?: { message?: string }; message?: string }
    | null;

  if (!res.ok) {
    throw new Cafe24ApiError(
      data?.error?.message || data?.message || "카페24 상품 등록에 실패했습니다. (필드명 미확인 상태 — 아래 상세 오류를 확인해 주세요)",
      res.status,
      data,
    );
  }

  return { ok: true, productNo: data?.product?.product_no ? String(data.product.product_no) : undefined, raw: data };
}
