import { env } from "cloudflare:workers";
import { generateEditedImage, OpenAiApiError } from "../../../lib/openai";

type OpenAiEnv = { OPENAI_API_KEY?: string };

export async function POST(request: Request) {
  try {
    const { OPENAI_API_KEY: apiKey } = env as unknown as OpenAiEnv;
    if (!apiKey) {
      return Response.json(
        { error: "서버에 OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다. .dev.vars 파일을 확인해 주세요." },
        { status: 400 }
      );
    }

    const form = await request.formData();
    const prompt = String(form.get("prompt") || "");
    const image = form.get("image");

    if (!prompt.trim()) {
      return Response.json({ error: "프롬프트를 입력해 주세요." }, { status: 400 });
    }
    if (!(image instanceof File)) {
      return Response.json({ error: "참조 이미지가 필요합니다." }, { status: 400 });
    }

    const imageDataUrl = await generateEditedImage(apiKey, prompt, image);
    return Response.json({ ok: true, imageDataUrl });
  } catch (error) {
    if (error instanceof OpenAiApiError) {
      return Response.json({ error: error.message }, { status: error.status || 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "알 수 없는 오류" }, { status: 500 });
  }
}
