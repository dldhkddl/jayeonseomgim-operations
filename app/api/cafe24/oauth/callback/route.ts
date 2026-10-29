import { env } from "cloudflare:workers";
import { exchangeCodeForToken, readOAuthCallback } from "../../../../lib/cafe24";
import { saveCafe24Token } from "../../../../lib/cafe24Store";

type Cafe24Env = { CAFE24_MALL_ID?: string; CAFE24_CLIENT_ID?: string; CAFE24_CLIENT_SECRET?: string };

function page(title: string, body: string) {
  const escapeHtml = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:'Noto Sans KR',sans-serif;padding:40px;text-align:center;color:#242a23">
<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p><p><a href="/">돌아가기</a></p>
</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** 카페24 인가 화면에서 승인하면 여기로 code가 돌아온다. 실제 토큰으로 바꿔서 D1에 저장한다. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { code, state, errorMessage } = readOAuthCallback(request.url);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const savedState = /cafe24_oauth_state=([^;]+)/.exec(cookieHeader)?.[1];

  if (!code) {
    return page("연결 실패", errorMessage || "카페24가 인가 코드를 보내지 않았습니다. 다시 시도해 주세요.");
  }
  if (!state || state !== savedState) {
    return page("연결 실패", "요청이 일치하지 않습니다(state 불일치). 처음부터 다시 시도해 주세요.");
  }

  const { CAFE24_MALL_ID: mallId, CAFE24_CLIENT_ID: clientId, CAFE24_CLIENT_SECRET: clientSecret } =
    env as unknown as Cafe24Env;
  if (!mallId || !clientId || !clientSecret) {
    return page("연결 실패", "서버에 카페24 환경변수(CAFE24_MALL_ID/CLIENT_ID/CLIENT_SECRET)가 없습니다.");
  }

  try {
    const redirectUri = `${url.origin}/api/cafe24/oauth/callback`;
    const token = await exchangeCodeForToken({ mallId, clientId, clientSecret }, code, redirectUri);
    await saveCafe24Token(mallId, token);
    return Response.redirect(new URL("/?cafe24=connected", url.origin));
  } catch (err) {
    return page("연결 실패", err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
  }
}
