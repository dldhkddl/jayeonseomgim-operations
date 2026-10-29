import { env } from "cloudflare:workers";
import {
  approveCoupangDraftProducts,
  CoupangApiError,
  listCoupangApprovalCandidates,
} from "../../../../lib/coupang";
import { isTrustedLocalOperationUrl } from "../../../../lib/naver";

type CoupangEnv = {
  COUPANG_ACCESS_KEY?: string;
  COUPANG_SECRET_KEY?: string;
  COUPANG_VENDOR_ID?: string;
};

function credentials() {
  const values = env as unknown as CoupangEnv;
  if (!values.COUPANG_ACCESS_KEY || !values.COUPANG_SECRET_KEY || !values.COUPANG_VENDOR_ID) {
    throw new CoupangApiError("쿠팡 Access Key, Secret Key, 업체코드 설정이 필요합니다.", 400);
  }
  return {
    accessKey: values.COUPANG_ACCESS_KEY,
    secretKey: values.COUPANG_SECRET_KEY,
    vendorId: values.COUPANG_VENDOR_ID,
  };
}

function errorResponse(error: unknown) {
  const status = error instanceof CoupangApiError ? error.status : 500;
  return Response.json(
    { error: error instanceof Error ? error.message : "쿠팡 상품 승인요청을 처리하지 못했습니다." },
    { status },
  );
}

export async function GET(request: Request) {
  if (!isTrustedLocalOperationUrl(request.url)) {
    return Response.json({ error: "쿠팡 승인요청 관리는 이 컴퓨터의 localhost에서만 사용할 수 있습니다." }, { status: 403 });
  }
  try {
    const items = await listCoupangApprovalCandidates(credentials());
    return Response.json({ items, count: items.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isTrustedLocalOperationUrl(request.url)) {
    return Response.json({ error: "쿠팡 상품 승인요청은 이 컴퓨터의 localhost에서만 실행할 수 있습니다." }, { status: 403 });
  }
  try {
    const body = await request.json() as { sellerProductIds?: unknown; confirmation?: unknown };
    const sellerProductIds = Array.isArray(body.sellerProductIds)
      ? body.sellerProductIds.map((id) => String(id))
      : [];
    const results = await approveCoupangDraftProducts(
      credentials(),
      sellerProductIds,
      String(body.confirmation ?? ""),
    );
    return Response.json({ approvedCount: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
}
