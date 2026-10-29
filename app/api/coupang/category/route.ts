import { env } from "cloudflare:workers";
import { CoupangApiError, predictCategory } from "../../../lib/coupang";

type CoupangEnv = { COUPANG_ACCESS_KEY?: string; COUPANG_SECRET_KEY?: string };

/** 상품명을 보내면 쿠팡이 카테고리를 추천해 준다 */
export async function POST(request: Request) {
  const { COUPANG_ACCESS_KEY: accessKey, COUPANG_SECRET_KEY: secretKey } = env as unknown as CoupangEnv;
  if (!accessKey || !secretKey) {
    return Response.json(
      {
        error:
          "쿠팡 API 키가 없습니다. .dev.vars 에 COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 를 넣고 서버를 다시 시작해 주세요.",
      },
      { status: 400 },
    );
  }

  let body: { productName?: string; brand?: string };
  try {
    body = (await request.json()) as { productName?: string; brand?: string };
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const productName = (body.productName ?? "").trim();
  if (!productName) return Response.json({ error: "상품명이 필요합니다." }, { status: 400 });

  try {
    const result = await predictCategory({ accessKey, secretKey }, { productName, brand: body.brand });
    // result.ok = 쿠팡이 카테고리를 판단했는가 (요청 성공 여부와 다르다)
    return Response.json({ productName, ...result });
  } catch (error) {
    if (error instanceof CoupangApiError) {
      return Response.json({ error: error.message, detail: error.detail }, { status: error.status || 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "알 수 없는 오류" }, { status: 500 });
  }
}
