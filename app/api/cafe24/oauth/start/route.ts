import { env } from "cloudflare:workers";
import { buildAuthorizeUrl } from "../../../../lib/cafe24";

type Cafe24Env = { CAFE24_MALL_ID?: string; CAFE24_CLIENT_ID?: string };

/** 이 주소로 들어오면 카페24 인가 화면으로 보낸다. 판매자가 로그인해서 승인하면 콜백으로 돌아온다. */
export async function GET(request: Request) {
  const { CAFE24_MALL_ID: mallId, CAFE24_CLIENT_ID: clientId } = env as unknown as Cafe24Env;
  if (!mallId || !clientId) {
    return new Response(
      "서버에 CAFE24_MALL_ID / CAFE24_CLIENT_ID 환경변수가 설정되어 있지 않습니다. .dev.vars를 확인해 주세요.",
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/cafe24/oauth/callback`;
  const state = crypto.randomUUID();

  const authorizeUrl = buildAuthorizeUrl(
    { mallId, clientId },
    { redirectUri, state, scopes: ["mall.read_product", "mall.write_product"] },
  );

  const headers = new Headers({ Location: authorizeUrl });
  // CSRF 방지용 — 콜백에서 이 값과 대조한다. 10분 안에 로그인 안 하면 만료.
  headers.append("Set-Cookie", `cafe24_oauth_state=${state}; Path=/; HttpOnly; Max-Age=600; SameSite=Lax`);
  return new Response(null, { status: 302, headers });
}
