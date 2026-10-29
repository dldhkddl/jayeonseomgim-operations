import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { productTemplates } from "../../../db/schema";
import { rankTemplates } from "../../lib/templateMatch";

function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  const detail = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${detail}`;
  if (combined.includes("no such table") || combined.includes("product_templates")) {
    return "상품 템플릿 테이블이 아직 없습니다. `npm run db:generate`로 마이그레이션을 만든 뒤 배포해 주세요.";
  }
  return message;
}

export type TemplateOut = {
  id: string;
  name: string;
  aliases: string;
  data: Record<string, string | number | undefined>;
  images: string[];
  imageRoles: Partial<Record<string, "cover" | "detail">>;
  createdAt: string;
  updatedAt: string;
};

function toOut(row: typeof productTemplates.$inferSelect): TemplateOut {
  let data: TemplateOut["data"] = {};
  let images: string[] = [];
  let imageRoles: TemplateOut["imageRoles"] = {};
  try { data = JSON.parse(row.data); } catch { /* 저장 당시 값이 이상하면 빈 값으로 */ }
  try { images = JSON.parse(row.images); } catch { /* noop */ }
  try { imageRoles = JSON.parse(row.imageRoles); } catch { /* noop */ }
  return { id: row.id, name: row.name, aliases: row.aliases, data, images, imageRoles, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** ?q= 가 있으면 이름·별칭으로 점수를 매겨 정렬해서 돌려준다. 없으면 전체 목록. */
export async function GET(request: Request) {
  try {
    const db = getDb();
    const rows = await db.select().from(productTemplates).orderBy(desc(productTemplates.updatedAt));
    const q = new URL(request.url).searchParams.get("q")?.trim();

    if (!q) return Response.json({ templates: rows.map(toOut) });

    const ranked = rankTemplates(q, rows.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases })));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const templates = ranked.map((r) => ({ ...toOut(byId.get(r.id)!), score: r.score }));
    return Response.json({ templates });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}

/** 새 템플릿 저장, 또는 id를 주면 그 템플릿을 덮어쓴다. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<TemplateOut>;
    const name = (body.name ?? "").trim();
    if (!name) return Response.json({ error: "템플릿 이름이 필요합니다." }, { status: 400 });

    const db = getDb();
    const now = new Date().toISOString();
    const id = body.id?.trim() || `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const row = {
      id,
      name,
      aliases: (body.aliases ?? "").trim(),
      data: JSON.stringify(body.data ?? {}),
      images: JSON.stringify(body.images ?? []),
      imageRoles: JSON.stringify(body.imageRoles ?? {}),
      updatedAt: now,
    };

    if (body.id) {
      const existing = await db.select().from(productTemplates).where(eq(productTemplates.id, body.id)).limit(1);
      if (existing.length) {
        await db.update(productTemplates).set(row).where(eq(productTemplates.id, body.id));
        return Response.json({ template: toOut({ ...existing[0], ...row }) });
      }
    }

    const inserted = { ...row, createdAt: now };
    await db.insert(productTemplates).values(inserted);
    return Response.json({ template: toOut(inserted) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: toRouteErrorMessage(error) }, { status: 500 });
  }
}
