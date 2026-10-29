import { env } from "cloudflare:workers";
import { Cafe24NotConnectedError, getValidCafe24Token } from "../../../lib/cafe24Store";

type Cafe24Env = {
  CAFE24_MALL_ID?: string;
  CAFE24_CLIENT_ID?: string;
  CAFE24_CLIENT_SECRET?: string;
};

export async function GET() {
  const {
    CAFE24_MALL_ID: mallId,
    CAFE24_CLIENT_ID: clientId,
    CAFE24_CLIENT_SECRET: clientSecret,
  } = env as unknown as Cafe24Env;

  if (!mallId || !clientId || !clientSecret) {
    return Response.json({ connected: false, error: "카페24 API 설정이 필요합니다." }, { status: 400 });
  }

  try {
    await getValidCafe24Token({ mallId, clientId, clientSecret });
    return Response.json({ ok: true, connected: true, mallId });
  } catch (error) {
    if (error instanceof Cafe24NotConnectedError) {
      return Response.json({ connected: false, error: "카페24 연결이 필요합니다." }, { status: 401 });
    }
    return Response.json(
      { connected: false, error: error instanceof Error ? error.message : "카페24 연결 상태를 확인하지 못했습니다." },
      { status: 502 },
    );
  }
}
