import { env } from "cloudflare:workers";
import { getAccessToken, isNaverApiError, readNaverChannelProduct } from "../../../lib/naver";
import { extractNaverImportedDetails, type NaverImportedDetails } from "../../../lib/naverProductImport";

type NaverEnv = { NAVER_CLIENT_ID?: string; NAVER_CLIENT_SECRET?: string };

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { channelProductNos?: unknown };
    const channelProductNos = Array.isArray(body.channelProductNos)
      ? [...new Set(body.channelProductNos.map((value) => String(value).trim()).filter((value) => /^\d+$/.test(value)))].slice(0, 50)
      : [];
    if (!channelProductNos.length) return Response.json({ details: {}, failed: [] });

    const { NAVER_CLIENT_ID: clientId, NAVER_CLIENT_SECRET: clientSecret } = env as unknown as NaverEnv;
    if (!clientId || !clientSecret) {
      return Response.json({ error: "네이버 API 키가 설정되어 있지 않아 기존 상세페이지를 불러올 수 없습니다." }, { status: 400 });
    }

    const { accessToken } = await getAccessToken({ clientId, clientSecret });
    const details: Record<string, NaverImportedDetails> = {};
    const failed: { channelProductNo: string; message: string }[] = [];

    for (const channelProductNo of channelProductNos) {
      try {
        const response = await readNaverChannelProduct(accessToken, channelProductNo);
        const extracted = extractNaverImportedDetails(response);
        if (extracted) details[channelProductNo] = extracted;
        else failed.push({ channelProductNo, message: "상세페이지 데이터가 없습니다." });
      } catch (error) {
        failed.push({ channelProductNo, message: error instanceof Error ? error.message : "조회에 실패했습니다." });
      }
    }

    return Response.json({ details, failed });
  } catch (error) {
    if (isNaverApiError(error)) {
      return Response.json(
        { error: error.message, stage: error.stage, detail: error.detail },
        { status: error.status || 502 },
      );
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "네이버 기존 상세페이지 조회에 실패했습니다.",
        stage: "인증",
      },
      { status: 500 },
    );
  }
}
