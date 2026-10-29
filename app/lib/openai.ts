const IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";

export class OpenAiApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * 참조 이미지 + 프롬프트를 gpt-image-1-mini 이미지 편집 API에 보내
 * 새 이미지를 생성합니다. (data URL로 반환)
 */
export async function generateEditedImage(apiKey: string, prompt: string, image: File) {
  const form = new FormData();
  // gpt-image-1은 2026-10-23 퇴역 예정 + 장당 비용이 훨씬 비싸(고화질 기준 약 230원).
  // gpt-image-1-mini + quality:medium 조합은 화질 85~90% 유지하면서 장당 약 15원 수준.
  form.append("model", "gpt-image-1-mini");
  form.append("quality", "medium");
  form.append("prompt", prompt);
  form.append("image[]", image, image.name || "reference.png");
  form.append("size", "1024x1024");

  const res = await fetch(IMAGE_EDIT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const data = (await res.json().catch(() => null)) as
    | { data?: { b64_json?: string }[]; error?: { message?: string } }
    | null;

  if (!res.ok) {
    throw new OpenAiApiError(data?.error?.message || "이미지 생성에 실패했습니다.", res.status);
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    throw new OpenAiApiError("이미지 데이터를 받지 못했습니다.", 502);
  }

  return `data:image/png;base64,${b64}`;
}
