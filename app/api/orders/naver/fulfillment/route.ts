import { isTrustedLocalOperationUrl } from "../../../../lib/naver";
import { listOrdersForFulfillment } from "../../../../lib/orders/order-repository";

export async function GET(request: Request) {
  if (!isTrustedLocalOperationUrl(request.url)) {
    return Response.json({ error: "개인정보가 포함된 주문은 이 컴퓨터의 localhost에서만 불러올 수 있습니다." }, { status: 403 });
  }
  return Response.json({ items: await listOrdersForFulfillment() }, { headers: { "Cache-Control": "no-store" } });
}
