import { latestOrderSyncRun, latestOrderSyncRuns, listOrders } from "../../lib/orders/order-repository";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const [items, lastRun, lastRuns] = await Promise.all([listOrders(limit), latestOrderSyncRun(), latestOrderSyncRuns()]);
  return Response.json({ items, lastRun, lastRuns });
}
