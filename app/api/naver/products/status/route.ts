import { env } from "cloudflare:workers";
import { changeNaverProductStatus, getAccessToken, isNaverApiError, isTrustedLocalMutationRequest } from "../../../../lib/naver";

type NaverEnv = { NAVER_CLIENT_ID?: string; NAVER_CLIENT_SECRET?: string };

export async function POST(request: Request) {
  if (!isTrustedLocalMutationRequest(request)) {
    return Response.json({ error: "판매중지는 이 컴퓨터의 localhost에서만 실행할 수 있습니다." }, { status: 403 });
  }
  try {
    const body = await request.json() as { originProductNo?: string; statusType?: string };
    if (body.statusType !== "SUSPENSION" && body.statusType !== "SALE") {
      return Response.json({ error: "판매중 또는 판매중지 상태만 변경할 수 있습니다." }, { status: 400 });
    }
    const { NAVER_CLIENT_ID: clientId, NAVER_CLIENT_SECRET: clientSecret } = env as unknown as NaverEnv;
    if (!clientId || !clientSecret) return Response.json({ error: "네이버 API 설정이 필요합니다." }, { status: 400 });
    await changeNaverProductStatus(
      (await getAccessToken({ clientId, clientSecret })).accessToken,
      String(body.originProductNo ?? ""),
      body.statusType,
    );
    return Response.json({ ok: true, statusType: body.statusType });
  } catch (error) {
    if (isNaverApiError(error)) return Response.json({ error: error.message, detail: error.detail, stage: error.stage }, { status: error.status || 400 });
    return Response.json({ error: error instanceof Error ? error.message : "네이버 상품 판매중지에 실패했습니다." }, { status: 500 });
  }
}
