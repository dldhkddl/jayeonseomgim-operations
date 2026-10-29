/**
 * 상품 템플릿 클라이언트 — 서버 D1에 저장된 재사용 상품 정보를 읽고 쓴다.
 * (db/schema.ts를 직접 import하면 서버 전용 모듈이 브라우저 번들에 섞이므로 타입을 따로 둔다)
 */

import type { CanonicalRow } from "./channels/canonical";
import { orderedImages, type ImageRole, type Product } from "./products";

export type TemplateRecord = {
  id: string;
  name: string;
  aliases: string;
  data: CanonicalRow;
  images: string[];
  imageRoles: Partial<Record<string, ImageRole>>;
  createdAt: string;
  updatedAt: string;
};

export type RankedTemplate = TemplateRecord & { score: number };

/** 이름으로 템플릿을 찾는다. 점수 높은 순. */
export async function findTemplates(query: string): Promise<RankedTemplate[]> {
  const res = await fetch(`/api/templates?q=${encodeURIComponent(query)}`);
  const data = (await res.json().catch(() => ({}))) as { templates?: RankedTemplate[]; error?: string };
  if (!res.ok) throw new Error(data.error || "템플릿을 찾지 못했습니다.");
  return data.templates ?? [];
}

export async function listTemplates(): Promise<TemplateRecord[]> {
  const res = await fetch("/api/templates");
  const data = (await res.json().catch(() => ({}))) as { templates?: TemplateRecord[]; error?: string };
  if (!res.ok) throw new Error(data.error || "템플릿 목록을 가져오지 못했습니다.");
  return data.templates ?? [];
}

/** 상품을 서버에 재사용 템플릿으로 저장한다 (표지가 앞에 오도록 정렬해서 저장) */
export async function saveProductAsTemplate(p: Product, name: string, aliases: string): Promise<TemplateRecord> {
  const res = await fetch("/api/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      aliases,
      data: p.data,
      images: orderedImages(p),
      imageRoles: p.imageRoles ?? {},
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { template?: TemplateRecord; error?: string };
  if (!res.ok || !data.template) throw new Error(data.error || "템플릿 저장에 실패했습니다.");
  return data.template;
}

export async function deleteTemplateById(id: string): Promise<void> {
  const res = await fetch(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "템플릿 삭제에 실패했습니다.");
  }
}
