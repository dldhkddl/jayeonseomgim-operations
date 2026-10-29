import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { productTemplates } from "../../../../db/schema";

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) return Response.json({ error: "id가 필요합니다." }, { status: 400 });
    const db = getDb();
    await db.delete(productTemplates).where(eq(productTemplates.id, id));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "삭제에 실패했습니다." }, { status: 500 });
  }
}
