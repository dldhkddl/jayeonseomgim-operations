import type { StoredOrderInput } from "./naver-order-api";

export function buildOrderStorageRow(order: StoredOrderInput, updatedAt: string) {
  return { id: `${order.channel}:${order.productOrderId}`, ...order, updatedAt };
}
