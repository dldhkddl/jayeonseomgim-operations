import { env } from "cloudflare:workers";
import { NaverApiError, getAccessToken } from "../../../lib/naver";

type NaverEnv = { NAVER_CLIENT_ID?: string; NAVER_CLIENT_SECRET?: string };

const CATEGORY_URL = "https://api.commerce.naver.com/external/v1/categories";

type NaverCategory = {
  id?: number | string;
  categoryId?: number | string;
  name?: string;
  categoryName?: string;
  wholeCategoryName?: string;
  last?: boolean;
  lastCategory?: boolean;
  certificationInfos?: unknown;
};

/**
 * 스마트스토어 카테고리를 이름으로 검색한다.
 *
 * 카테고리 코드는 사람이 지어낼 수 없는 값이라, 채널에서 직접 받아오는 게 유일하게 정확한 방법이다.
 * 검색어와 맞는 **말단 카테고리**(더 이상 하위가 없는 것)만 돌려준다 — 상품은 말단에만 등록되기 때문.
 */
export async function GET(request: Request) {
  const { NAVER_CLIENT_ID: clientId, NAVER_CLIENT_SECRET: clientSecret } = env as unknown as NaverEnv;
  if (!clientId || !clientSecret) {
    return Response.json(
      { error: "네이버 API 키가 없습니다. .dev.vars 의 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 를 채워 주세요." },
      { status: 400 },
    );
  }

  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const categoryId = (new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!query && !/^\d+$/.test(categoryId)) {
    return Response.json({ error: "검색어 또는 카테고리 ID가 필요합니다." }, { status: 400 });
  }

  try {
    const { accessToken } = await getAccessToken({ clientId, clientSecret });

    if (categoryId) {
      const detailResponse = await fetch(`${CATEGORY_URL}/${categoryId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const detail = (await detailResponse.json().catch(() => null)) as NaverCategory | { message?: string } | null;
      if (!detailResponse.ok || !detail || !("certificationInfos" in detail)) {
        const message = detail && "message" in detail && detail.message
          ? detail.message
          : "카테고리 인증 정보를 불러오지 못했습니다.";
        return Response.json({ error: message }, { status: detailResponse.status || 502 });
      }
      return Response.json({
        ok: true,
        category: {
          id: categoryId,
          certificationInfos: detail.certificationInfos ?? [],
        },
      });
    }

    const res = await fetch(CATEGORY_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json().catch(() => null)) as NaverCategory[] | { message?: string } | null;

    if (!res.ok || !Array.isArray(data)) {
      const message =
        (data && !Array.isArray(data) && data.message) ||
        "카테고리를 불러오지 못했습니다. 커머스API 권한에 '카테고리 조회'가 포함되어 있는지 확인해 주세요.";
      return Response.json({ error: message, status: res.status }, { status: res.status || 502 });
    }

    const q = query.toLowerCase();
    const matches = data
      .filter((c) => {
        const whole = String(c.wholeCategoryName ?? "");
        const name = String(c.categoryName ?? c.name ?? "");
        const isLast = c.last ?? c.lastCategory ?? true;
        return isLast && (name.toLowerCase().includes(q) || whole.toLowerCase().includes(q));
      })
      .slice(0, 30)
      .map((c) => ({
        id: String(c.categoryId ?? c.id ?? ""),
        name: String(c.categoryName ?? c.name ?? ""),
        path: String(c.wholeCategoryName ?? ""),
      }))
      .filter((c) => c.id);

    return Response.json({ ok: true, query, count: matches.length, categories: matches });
  } catch (error) {
    if (error instanceof NaverApiError) {
      return Response.json({ error: error.message, detail: error.detail }, { status: error.status || 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "알 수 없는 오류" }, { status: 500 });
  }
}
