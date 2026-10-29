/**
 * 상세설명 자동 생성
 *
 * 채널 엑셀의 `상세설명` 칸은 대개 HTML을 받는다.
 * 상품이 이미 들고 있는 사실(원산지·품종·중량·보관법)과 올려둔 사진으로 조립한다.
 *
 * 원칙: **없는 정보는 만들지 않는다.**
 *   당도·수확일·인증 같은 걸 그럴듯하게 지어내면 표시광고법 문제가 되고,
 *   무엇보다 고객이 받은 물건과 설명이 다르면 반품과 클레임으로 돌아온다.
 *   비어 있는 항목은 그냥 빼고 만든다.
 */

import { CANONICAL_BY_ID, type CanonicalRow } from "./canonical.ts";
import { isPubliclyReachable } from "../media.ts";
import { buildPremiumDetailHtml, type DetailTheme } from "../premiumDetail.ts";

/** 상세설명 자리에 들어와 있는 "작업 메모"를 알아본다 */
const MEMO_PATTERN = /(확인\s*필요|수정\s*본?\s*필요|필요함?$|미정|추후|예시|샘플|작성\s*예정|전용\s*상세페이지)/;

/** 지금 값이 진짜 상세설명인지, 비었거나 메모인지 판정 */
export function detailState(value: unknown): "empty" | "memo" | "written" {
  const s = String(value ?? "").trim();
  if (!s) return "empty";
  // 파일 경로가 들어온 경우도 상세설명이 아니다
  if (/^[a-zA-Z]:[\\/]|^file:/.test(s)) return "memo";
  if (s.length < 40 && MEMO_PATTERN.test(s)) return "memo";
  return "written";
}

/** 가져온 엑셀에 완성된 상세설명이 있으면 원문을 그대로 돌려준다. */
export function existingDetailContent(row: Pick<CanonicalRow, "detailContent">): string | null {
  return detailState(row.detailContent) === "written" ? String(row.detailContent) : null;
}

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 상세 정보표에 넣을 항목들 (값이 있는 것만 나간다) */
const SPEC_FIELDS = [
  "variety", "origin", "weightSpec", "manufacturer",
  "storage", "expiry", "certification", "deliveryFeeType",
];

export type DetailOptions = {
  /** 상단 큰 이미지 등으로 쓸 사진들. 공개 URL만 들어간다 */
  images?: string[];
  /** 교환·반품 안내 (판매자 기본값) */
  guide?: string;
  /** 문의 전화 */
  phone?: string;
  /** 대표 사진에서 추출한 상품별 상세페이지 색상 */
  theme?: DetailTheme;
};

/**
 * 상세설명 HTML을 만든다.
 * 채널 에디터가 스타일을 걸러내는 경우가 많아 인라인 스타일만 쓰고 구조는 단순하게 둔다.
 */
export function buildLegacyDetailHtml(row: CanonicalRow, options: DetailOptions = {}): string {
  const name = String(row.productName ?? "").trim();
  const images = (options.images ?? []).filter(isPubliclyReachable);

  const parts: string[] = [];
  parts.push(`<div style="max-width:860px;margin:0 auto;font-family:'Noto Sans KR',sans-serif;color:#222;line-height:1.8">`);

  if (images[0]) {
    parts.push(`<img src="${esc(images[0])}" alt="${esc(name)}" style="width:100%;display:block;margin-bottom:24px" />`);
  }

  if (name) parts.push(`<h2 style="font-size:24px;margin:0 0 12px">${esc(name)}</h2>`);

  // 소개 문단 — 상품이 가진 사실만 이어 붙인다
  const intro: string[] = [];
  if (row.origin) intro.push(`${esc(row.origin)}에서 보내드립니다.`);
  if (row.variety) intro.push(`품종은 ${esc(row.variety)}입니다.`);
  if (row.weightSpec) intro.push(`구성은 ${esc(row.weightSpec)}입니다.`);
  if (intro.length) parts.push(`<p style="font-size:15px;margin:0 0 20px">${intro.join(" ")}</p>`);

  const feature = String(row.feature ?? "").trim();
  if (feature) {
    const items = feature.split(/[,·]/).map((s) => s.trim()).filter(Boolean);
    if (items.length > 1) {
      parts.push(
        `<ul style="font-size:15px;margin:0 0 24px;padding-left:20px">${items
          .map((i) => `<li style="margin-bottom:6px">${esc(i)}</li>`)
          .join("")}</ul>`,
      );
    } else {
      parts.push(`<p style="font-size:15px;margin:0 0 24px">${esc(feature)}</p>`);
    }
  }

  // 상품 정보표
  const specRows = SPEC_FIELDS.filter((f) => String(row[f] ?? "").trim())
    .map(
      (f) =>
        `<tr><th style="width:130px;text-align:left;padding:10px 12px;background:#f6f6f2;border-bottom:1px solid #eee;font-weight:600">${esc(
          CANONICAL_BY_ID[f]?.label ?? f,
        )}</th><td style="padding:10px 12px;border-bottom:1px solid #eee">${esc(row[f])}</td></tr>`,
    );
  if (specRows.length) {
    parts.push(`<h3 style="font-size:17px;margin:0 0 10px">상품 정보</h3>`);
    parts.push(
      `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px"><tbody>${specRows.join("")}</tbody></table>`,
    );
  }

  // 나머지 사진
  for (const src of images.slice(1)) {
    parts.push(`<img src="${esc(src)}" alt="${esc(name)} 상세" style="width:100%;display:block;margin-bottom:16px" />`);
  }

  const notices: string[] = [];
  if (row.storage) notices.push(`받으신 뒤 ${esc(row.storage)} 부탁드립니다.`);
  if (options.guide) notices.push(esc(options.guide));
  if (options.phone) notices.push(`문의 ${esc(options.phone)}`);
  if (notices.length) {
    parts.push(
      `<div style="background:#f6f6f2;padding:16px;font-size:13px;color:#555;margin-top:8px">${notices
        .map((n) => `<p style="margin:0 0 6px">${n}</p>`)
        .join("")}</div>`,
    );
  }

  parts.push(`</div>`);
  return parts.join("\n");
}

/** 상품별 자동 색상과 구매 설득 흐름을 적용한 프리미엄 상세페이지 HTML */
export function buildDetailHtml(row: CanonicalRow, options: DetailOptions = {}): string {
  return buildPremiumDetailHtml(row, {
    ...options,
    images: (options.images ?? []).filter(isPubliclyReachable),
  });
}

/** HTML을 못 받는 채널용 — 같은 내용을 글자만으로 */
export function buildDetailText(row: CanonicalRow, options: DetailOptions = {}): string {
  const lines: string[] = [];
  const name = String(row.productName ?? "").trim();
  if (name) lines.push(name, "");

  if (row.origin) lines.push(`${row.origin}에서 보내드립니다.`);
  if (row.variety) lines.push(`품종: ${row.variety}`);
  if (row.weightSpec) lines.push(`구성: ${row.weightSpec}`);
  const feature = String(row.feature ?? "").trim();
  if (feature) lines.push("", feature);

  const specs = SPEC_FIELDS.filter((f) => String(row[f] ?? "").trim());
  if (specs.length) {
    lines.push("", "[상품 정보]");
    for (const f of specs) lines.push(`- ${CANONICAL_BY_ID[f]?.label ?? f}: ${row[f]}`);
  }
  if (options.guide) lines.push("", String(options.guide));
  if (options.phone) lines.push(`문의 ${options.phone}`);

  return lines.join("\n").trim();
}

export type BuildSummary = {
  /** 실제로 채운 상품 수 */
  filled: number;
  /** 이미 작성돼 있어 건너뛴 수 */
  skipped: number;
  /** 메모가 들어있어 교체한 수 */
  replaced: number;
  /** 사진이 없어 글자만 들어간 수 */
  noImage: number;
};

export type BuildMode = "empty" | "all";

/**
 * 여러 상품의 상세설명을 한 번에 만든다.
 * mode "empty" = 비어 있거나 메모인 것만, "all" = 전부 다시 생성
 */
export function fillDetails(
  items: { data: CanonicalRow; images: string[]; theme?: DetailTheme }[],
  options: { mode: BuildMode; format: "html" | "text"; guide?: string; phone?: string },
): { rows: CanonicalRow[]; summary: BuildSummary } {
  const summary: BuildSummary = { filled: 0, skipped: 0, replaced: 0, noImage: 0 };

  const rows = items.map(({ data, images, theme }) => {
    const state = detailState(data.detailContent);
    if (options.mode === "empty" && state === "written") {
      summary.skipped += 1;
      return data;
    }
    const usable = images.filter(isPubliclyReachable);
    if (!usable.length) summary.noImage += 1;
    if (state === "memo") summary.replaced += 1;
    summary.filled += 1;

    const built =
      options.format === "html"
        ? buildDetailHtml(data, { images: usable, guide: options.guide, phone: options.phone, theme })
        : buildDetailText(data, { guide: options.guide, phone: options.phone });

    return { ...data, detailContent: built };
  });

  return { rows, summary };
}
