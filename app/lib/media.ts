/**
 * 상품 이미지 보관 (Cloudflare R2)
 *
 * 채널 대량등록 엑셀의 이미지 칸은 파일이 아니라 **공개 URL**만 받는다.
 * 그래서 앱에서 만든 사진(업로드 사진 · AI 생성 이미지 · 상세페이지 PNG)을
 * R2에 올리고, 그 주소를 공통 스키마의 이미지 필드에 꽂아준다.
 *
 * 공개 방식
 *   R2 객체는 기본이 비공개다. r2.dev 도메인을 켜거나 커스텀 도메인을 붙이는 방법도 있지만,
 *   여기서는 우리 앱의 GET /api/media/<key> 로 흘려보낸다.
 *   설정할 게 없고, 나중에 커스텀 도메인이 생기면 MEDIA_PUBLIC_BASE 하나만 바꾸면 된다.
 */

/**
 * R2 버킷에서 우리가 실제로 쓰는 부분만 추린 타입.
 * @cloudflare/workers-types 전역 타입이 없어도 컴파일되도록 직접 정의한다.
 */
export interface MediaObject {
  body: ReadableStream;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

export interface MediaBucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | null,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<MediaObject | null>;
}

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type UploadedMedia = {
  key: string;
  url: string;
  size: number;
  type: string;
  /** 원본 파일명 (화면 표시용) */
  name: string;
};

export function extensionFor(type: string): string {
  return EXT_BY_TYPE[type] ?? "bin";
}

/**
 * 저장 키를 만든다. 채널이 이미지를 오래 캐시하므로 키는 절대 재사용하지 않는다.
 * 같은 사진을 다시 올리면 새 키가 생겨 캐시 충돌이 없다.
 */
export function buildMediaKey(fileName: string, type: string): string {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = crypto.randomUUID().slice(0, 8);
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "image";
  return `products/${yyyymm}/${rand}-${base}.${extensionFor(type)}`;
}

export function isAllowedImage(type: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

/** 요청 도메인 또는 설정된 기준 도메인으로 공개 URL을 만든다. */
export function publicUrlFor(key: string, requestUrl: string, base?: string): string {
  const origin = (base && base.trim()) || new URL(requestUrl).origin;
  return `${origin.replace(/\/$/, "")}/api/media/${key}`;
}

/**
 * 채널이 실제로 가져갈 수 있는 주소인지 판정.
 * localhost / 127.0.0.1 / blob: / data: 는 우리 컴퓨터 안에서만 유효해서
 * 엑셀에 넣으면 채널이 이미지를 못 받고 등록이 반려된다.
 */
export function isPubliclyReachable(url: string): boolean {
  if (!url) return false;
  if (/^(blob:|data:|file:)/i.test(url)) return false;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1") return false;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

// ── 브라우저 쪽 헬퍼 ──────────────────────────────────────────────────────

/** blob:/data: URL을 File로 되돌린다. 화면에 있는 미리보기 이미지를 업로드하려면 필요하다. */
export async function urlToFile(url: string, name: string): Promise<File> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "image/png" });
}

export type UploadResponse = { ok: true; files: UploadedMedia[] } | { ok?: false; error: string };

/** 여러 장을 한 번에 올린다. */
export async function uploadImages(files: File[]): Promise<UploadedMedia[]> {
  if (!files.length) return [];
  const form = new FormData();
  for (const f of files) form.append("files", f);

  const res = await fetch("/api/media/upload", { method: "POST", body: form });
  const data = (await res.json()) as UploadResponse;
  if (!res.ok || !("ok" in data) || !data.ok) {
    throw new Error("error" in data && data.error ? data.error : "이미지 업로드에 실패했습니다.");
  }
  return data.files;
}
