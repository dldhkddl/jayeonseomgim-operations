import { env } from "cloudflare:workers";
import { getAccessToken, NaverApiError } from "../../../lib/naver";

type NaverEnv = {
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
};

export async function POST() {
  try {
    const { NAVER_CLIENT_ID: clientId, NAVER_CLIENT_SECRET: clientSecret } = env as unknown as NaverEnv;

    if (!clientId || !clientSecret) {
      return Response.json(
        { error: "서버에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되어 있지 않습니다. .dev.vars 파일을 확인해 주세요." },
        { status: 400 }
      );
    }

    const { expiresIn } = await getAccessToken({ clientId, clientSecret });
    return Response.json({ ok: true, expiresIn });
  } catch (error) {
    if (error instanceof NaverApiError) {
      return Response.json({ error: error.message, detail: error.detail }, { status: error.status || 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "알 수 없는 오류" }, { status: 500 });
  }
}
