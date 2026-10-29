import { env } from "cloudflare:workers";
import { ProductCatalogRepository } from "../../lib/product-catalog-repository.ts";
import type { Product } from "../../lib/products.ts";

function repository() {
  if (!env.DB) throw new Error("상품 데이터베이스가 연결되지 않았습니다.");
  return new ProductCatalogRepository(env.DB);
}

export async function GET() {
  try {
    return Response.json(await repository().load());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "상품을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { products?: unknown } | null;
    if (!body || !Array.isArray(body.products)) {
      return Response.json({ error: "상품 목록 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const products = body.products.filter((item): item is Product => Boolean(item && typeof item === "object" && typeof (item as Product).id === "string"));
    if (products.length !== body.products.length) {
      return Response.json({ error: "올바르지 않은 상품이 포함되어 있습니다." }, { status: 400 });
    }
    await repository().save(products);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "상품을 저장하지 못했습니다." }, { status: 500 });
  }
}
