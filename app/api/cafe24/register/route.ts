import { env } from "cloudflare:workers";
import { Cafe24ApiError, createProduct } from "../../../lib/cafe24";
import { Cafe24NotConnectedError, getValidCafe24Token } from "../../../lib/cafe24Store";

type Cafe24Env = { CAFE24_MALL_ID?: string; CAFE24_CLIENT_ID?: string; CAFE24_CLIENT_SECRET?: string };

/**
 * 상품을 카페24 쇼핑몰에 바로 등록한다.
 * 이미지는 R2에 이미 올라간 공개 URL을 그대로 카페24에 전달한다 (네이버처럼 파일 재업로드 안 함 — 미확인).
 */
export async function POST(request: Request) {
  try {
    const { CAFE24_MALL_ID: mallId, CAFE24_CLIENT_ID: clientId, CAFE24_CLIENT_SECRET: clientSecret } =
      env as unknown as Cafe24Env;
    if (!mallId || !clientId || !clientSecret) {
      return Response.json(
        { error: "서버에 CAFE24_MALL_ID / CAFE24_CLIENT_ID / CAFE24_CLIENT_SECRET 환경변수가 없습니다." },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      title?: string;
      price?: number | string;
      summary?: string;
      descriptionHtml?: string;
      images?: string[];
    } | null;

    const title = String(body?.title ?? "").trim();
    const price = Number(body?.price ?? 0);
    const images = Array.isArray(body?.images) ? body!.images!.filter(Boolean) : [];

    if (!title) return Response.json({ error: "상품명이 필요합니다." }, { status: 400 });
    if (!price) return Response.json({ error: "가격이 필요합니다." }, { status: 400 });
    if (!images.length) return Response.json({ error: "상품 사진이 최소 1장 필요합니다." }, { status: 400 });

    const { accessToken, mallId: connectedMallId } = await getValidCafe24Token({ mallId, clientId, clientSecret });

    const result = await createProduct({
      mallId: connectedMallId,
      accessToken,
      productName: title,
      price,
      summary: body?.summary,
      descriptionHtml: body?.descriptionHtml,
      images,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof Cafe24NotConnectedError) {
      return Response.json({ error: error.message, needsConnect: true }, { status: 400 });
    }
    if (error instanceof Cafe24ApiError) {
      return Response.json({ error: error.message, detail: error.detail }, { status: error.status || 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "알 수 없는 오류" }, { status: 500 });
  }
}
