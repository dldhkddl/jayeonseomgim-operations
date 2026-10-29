import { env } from "cloudflare:workers";
import { isExactProductDeletionConfirmation } from "../../../../lib/inventory/product-deletion";
import { deleteNaverProduct, getAccessToken, isNaverApiError, isTrustedLocalMutationRequest } from "../../../../lib/naver";

type NaverEnv = { NAVER_CLIENT_ID?: string; NAVER_CLIENT_SECRET?: string };

export async function POST(request: Request) {
  if (!isTrustedLocalMutationRequest(request)) {
    return Response.json({ error: "상품 영구삭제는 이 컴퓨터의 localhost에서만 실행할 수 있습니다." }, { status: 403 });
  }
  try {
    const body = await request.json() as { originProductNo?: string; confirmation?: string };
    if (!isExactProductDeletionConfirmation(String(body.confirmation ?? ""))) {
      return Response.json({ error: "확인 문구가 정확하지 않아 상품을 삭제하지 않았습니다." }, { status: 400 });
    }
    const { NAVER_CLIENT_ID: clientId, NAVER_CLIENT_SECRET: clientSecret } = env as unknown as NaverEnv;
    if (!clientId || !clientSecret) return Response.json({ error: "네이버 API 설정이 필요합니다." }, { status: 400 });
    await deleteNaverProduct(
      (await getAccessToken({ clientId, clientSecret })).accessToken,
      String(body.originProductNo ?? ""),
    );
    return Response.json({ ok: true, deleted: true });
  } catch (error) {
    if (isNaverApiError(error)) return Response.json({ error: error.message, detail: error.detail, stage: error.stage }, { status: error.status || 400 });
    return Response.json({ error: error instanceof Error ? error.message : "네이버 상품 영구삭제에 실패했습니다." }, { status: 500 });
  }
}
