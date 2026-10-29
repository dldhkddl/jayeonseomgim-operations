import type { Product } from "./products.ts";

const BLOCKED_CONTAINERS = /<\s*(script|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const BLOCKED_TAGS = /<\s*\/?\s*(script|iframe|object|embed)\b[^>]*>/gi;
const EVENT_ATTRIBUTE = /\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTRIBUTE = /(\s(?:href|src|xlink:href|action|formaction)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function decodeNumericEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);?/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&colon;/gi, ":");
}

function isExecutableUrl(value: string): boolean {
  const canonical = decodeNumericEntities(value).replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  return /^(?:javascript|vbscript|data:text\/html):/.test(canonical);
}

/** 채널과 시각 편집기에서 실행될 수 있는 마크업만 제거하고 일반 상품 HTML은 보존한다. */
export function sanitizeDetailHtml(html: unknown): string {
  let safe = String(html ?? "");
  let previous = "";
  while (safe !== previous) {
    previous = safe;
    safe = safe.replace(BLOCKED_CONTAINERS, "");
  }

  return safe
    .replace(BLOCKED_TAGS, "")
    .replace(EVENT_ATTRIBUTE, "")
    .replace(URL_ATTRIBUTE, (attribute, prefix: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
      const value = doubleQuoted ?? singleQuoted ?? bare ?? "";
      return isExecutableUrl(value) ? "" : attribute;
    })
    .trim();
}

/** 브라우저가 만드는 빈 편집기 껍데기와 바깥 공백을 같은 값으로 취급한다. */
export function normalizeDetailHtml(html: unknown): string {
  const safe = sanitizeDetailHtml(html).trim();
  if (/^<(?:div|p)(?:\s[^>]*)?>\s*(?:<br\s*\/?\s*>|&nbsp;|\s)*<\/(?:div|p)>$/i.test(safe)) return "";
  return safe;
}

export function hasDetailChanges(original: unknown, draft: unknown): boolean {
  return normalizeDetailHtml(original) !== normalizeDetailHtml(draft);
}

/** 오른쪽 미리보기는 저장본보다 현재 왼쪽 편집 초안을 우선해 보여준다. */
export function resolveDetailPreviewHtml(persisted: unknown, draft?: unknown): string | null {
  const html = normalizeDetailHtml(draft === undefined ? persisted : draft);
  return html || null;
}

/** 선택한 상품 하나의 상세설명만 안전하게 교체한다. */
export function replaceProductDetail(products: Product[], productId: string, html: unknown): Product[] {
  const detailContent = normalizeDetailHtml(html);
  return products.map((product) => product.id === productId
    ? { ...product, data: { ...product.data, detailContent }, updatedAt: new Date().toISOString() }
    : product);
}
