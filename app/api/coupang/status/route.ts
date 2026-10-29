import { env } from "cloudflare:workers";
import { CoupangApiError, verifyCoupangConnection } from "../../../lib/coupang";

type CoupangEnv = { COUPANG_ACCESS_KEY?: string; COUPANG_SECRET_KEY?: string };

export async function GET() {
  const { COUPANG_ACCESS_KEY: accessKey, COUPANG_SECRET_KEY: secretKey } = env as unknown as CoupangEnv;
  if (!accessKey || !secretKey) {
    return Response.json({ connected: false, error: "쿠팡 Access Key와 Secret Key가 필요합니다." }, { status: 400 });
  }
  try {
    await verifyCoupangConnection({ accessKey, secretKey });
    return Response.json({ ok: true, connected: true });
  } catch (error) {
    const status = error instanceof CoupangApiError ? error.status : 502;
    return Response.json(
      { connected: false, error: error instanceof Error ? error.message : "쿠팡 연결 상태를 확인하지 못했습니다." },
      { status },
    );
  }
}
