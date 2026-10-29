/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  NAVER_ORIGIN_AREA_CODE?: string;
  NAVER_AS_PHONE?: string;
  NAVER_AS_GUIDE?: string;
  OPENAI_API_KEY?: string;
  COUPANG_ACCESS_KEY?: string;
  COUPANG_SECRET_KEY?: string;
  CAFE24_MALL_ID?: string;
  CAFE24_CLIENT_ID?: string;
  CAFE24_CLIENT_SECRET?: string;
  GARAK_API_KEY?: string;
  GARAK_PRICE_API_URL?: string;
  /** 상품 이미지 보관용 R2 버킷. 채널 엑셀에 넣을 공개 URL을 만들기 위해 필요하다. */
  MEDIA?: R2Bucket;
  /** 이미지 공개 주소의 기준 도메인. 비우면 요청이 들어온 도메인을 그대로 쓴다. */
  MEDIA_PUBLIC_BASE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
