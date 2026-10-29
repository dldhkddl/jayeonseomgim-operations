import { env } from "cloudflare:workers";
import type { MediaBucket } from "../../../lib/media";

type MediaEnv = { MEDIA?: MediaBucket };

/**
 * 저장된 상품 이미지를 공개로 내보낸다.
 * 채널(스마트스토어·쿠팡 등) 서버가 이 주소로 직접 이미지를 가지러 온다.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { MEDIA } = env as unknown as MediaEnv;
  if (!MEDIA) return new Response("이미지 보관소가 연결되어 있지 않습니다.", { status: 503 });

  const { key: segments } = await ctx.params;
  const key = (segments ?? []).join("/");
  if (!key) return new Response("Not found", { status: 404 });

  const object = await MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=31536000, immutable");
  // 채널 서버가 다른 도메인에서 가져가므로 열어둔다
  headers.set("access-control-allow-origin", "*");

  return new Response(object.body, { headers });
}
