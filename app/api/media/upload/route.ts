import { env } from "cloudflare:workers";
import {
  MAX_IMAGE_BYTES,
  buildMediaKey,
  isAllowedImage,
  publicUrlFor,
  type MediaBucket,
  type UploadedMedia,
} from "../../../lib/media";

type MediaEnv = { MEDIA?: MediaBucket; MEDIA_PUBLIC_BASE?: string };

export async function POST(request: Request) {
  const { MEDIA, MEDIA_PUBLIC_BASE } = env as unknown as MediaEnv;

  if (!MEDIA) {
    return Response.json(
      {
        error:
          "이미지 보관소(R2)가 연결되어 있지 않습니다. .openai/hosting.json 의 \"r2\" 값이 \"MEDIA\" 인지 확인하고 서버를 다시 시작해 주세요.",
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "업로드 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "올릴 이미지가 없습니다." }, { status: 400 });
  if (files.length > 20) return Response.json({ error: "한 번에 최대 20장까지 올릴 수 있습니다." }, { status: 400 });

  const uploaded: UploadedMedia[] = [];

  for (const file of files) {
    if (!isAllowedImage(file.type)) {
      return Response.json(
        { error: `지원하지 않는 형식입니다: ${file.name} (${file.type || "알 수 없음"}). PNG·JPG·WEBP·GIF만 됩니다.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return Response.json(
        { error: `${file.name} 이(가) 너무 큽니다. 장당 10MB 이하로 줄여 주세요.` },
        { status: 400 },
      );
    }

    const key = buildMediaKey(file.name || "image", file.type);
    try {
      await MEDIA.put(key, file.stream(), {
        httpMetadata: {
          contentType: file.type,
          // 키가 매번 새로 생기므로 오래 캐시해도 안전하다
          cacheControl: "public, max-age=31536000, immutable",
        },
        customMetadata: { originalName: file.name || "" },
      });
    } catch (error) {
      return Response.json(
        { error: `${file.name} 저장 중 오류: ${error instanceof Error ? error.message : "알 수 없는 오류"}` },
        { status: 500 },
      );
    }

    uploaded.push({
      key,
      url: publicUrlFor(key, request.url, MEDIA_PUBLIC_BASE),
      size: file.size,
      type: file.type,
      name: file.name || key,
    });
  }

  return Response.json({ ok: true, files: uploaded });
}
