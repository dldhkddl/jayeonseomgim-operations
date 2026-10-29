import { normalizeAddress, normalizeIdentifier, normalizePerson, normalizePhone, normalizeProductName } from "./normalize.ts";
import type { NaverOrder, ShipmentMatch, SupplierRow, SupplierShipment } from "./types.ts";

const DISPATCHED_STATUS = /(배송중|배송완료|발송완료|구매확정|취소|반품)/;

const STORED_STATUS_LABEL: Record<string, string> = {
  PAYMENT_WAITING: "결제 대기",
  PAYED: "결제 완료",
  DELIVERING: "배송 중",
  DELIVERED: "배송 완료",
  PURCHASE_DECIDED: "구매 확정",
  EXCHANGED: "교환",
  CANCELED: "취소",
  RETURNED: "반품",
};

export function storedOrderToInvoiceOrder(order: {
  productOrderId: string; productName: string; quantity: number; buyerName: string; recipientName: string;
  baseAddress: string; detailedAddress: string; recipientPhone1: string; recipientPhone2: string;
  deliveryMessage: string; buyerPhone: string; buyerId: string; orderStatus: string;
}): NaverOrder {
  return {
    productOrderId: order.productOrderId,
    productName: order.productName,
    quantity: order.quantity,
    buyerName: order.buyerName,
    recipientName: order.recipientName,
    address: [order.baseAddress, order.detailedAddress].filter(Boolean).join(" "),
    phone1: order.recipientPhone1,
    phone2: order.recipientPhone2,
    deliveryMessage: order.deliveryMessage,
    buyerPhone: order.buyerPhone,
    sellerId: "",
    buyerId: order.buyerId,
    status: STORED_STATUS_LABEL[order.orderStatus] ?? order.orderStatus,
  };
}

export function groupSupplierRowsByTracking(rows: SupplierRow[]): SupplierShipment[] {
  const grouped = new Map<string, SupplierShipment>();
  for (const row of rows) {
    const trackingNumber = normalizeIdentifier(row.trackingNumber);
    if (!trackingNumber) continue;
    const current = grouped.get(trackingNumber) ?? {
      trackingNumber,
      carrier: row.carrier.trim(),
      recipientName: row.recipientName.trim(),
      phone: row.phone.trim(),
      phoneRole: row.phoneRole,
      address: row.address.trim(),
      strictIdentity: row.strictIdentity,
      items: [],
    };
    current.items.push({
      productName: row.productName.trim(),
      quantity: Number(row.quantity) || 1,
      sourceOrderKey: row.sourceOrderKey?.trim() || undefined,
    });
    grouped.set(trackingNumber, current);
  }
  return [...grouped.values()];
}

function productLooksSame(left: string, right: string): boolean {
  const a = normalizeProductName(left);
  const b = normalizeProductName(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function recipientLooksSame(order: NaverOrder, shipment: SupplierShipment): boolean {
  if (shipment.strictIdentity && (!shipment.recipientName || !shipment.phone || !shipment.address)) return false;
  const nameMatches = !shipment.recipientName || normalizePerson(order.recipientName) === normalizePerson(shipment.recipientName);
  const addressMatches = !shipment.address || normalizeAddress(order.address) === normalizeAddress(shipment.address);
  const supplierPhone = normalizePhone(shipment.phone);
  const orderPhones = shipment.phoneRole === "buyer"
    ? [order.buyerPhone]
    : [order.phone1, order.phone2];
  const phoneMatches = !supplierPhone || orderPhones.map(normalizePhone).includes(supplierPhone);
  return nameMatches && addressMatches && phoneMatches;
}

function sameBundleIdentity(orders: NaverOrder[]): boolean {
  if (orders.length < 2) return true;
  const first = orders[0];
  const key = (order: NaverOrder) => [
    normalizeAddress(order.address),
    normalizePhone(order.phone1),
    normalizePhone(order.phone2),
    normalizePerson(order.sellerId),
    normalizePerson(order.buyerId),
  ];
  const expected = key(first);
  if (expected.some((value) => !value)) return false;
  return orders.slice(1).every((order) => key(order).every((value, index) => value === expected[index]));
}

export function matchShipments(orders: NaverOrder[], shipments: SupplierShipment[]): ShipmentMatch[] {
  const usable = orders.filter((order) => !DISPATCHED_STATUS.test(order.status));
  const assigned = new Set<string>();

  return shipments.map((shipment) => {
    const selected: NaverOrder[] = [];
    const allCandidates: NaverOrder[] = [];
    let ambiguous = false;

    for (const item of shipment.items) {
      const keyedOrder = item.sourceOrderKey
        ? usable.filter((order) => order.sourceOrderKey === item.sourceOrderKey)
        : [];
      const candidates = item.sourceOrderKey
        ? keyedOrder.filter((order) =>
          !assigned.has(order.productOrderId)
          && recipientLooksSame(order, shipment)
          && order.quantity === item.quantity
          && productLooksSame(order.productName, item.productName),
        )
        : usable.filter((order) =>
          !assigned.has(order.productOrderId)
          && recipientLooksSame(order, shipment)
          && order.quantity === item.quantity
          && productLooksSame(order.productName, item.productName),
        );
      for (const candidate of keyedOrder) {
        if (!allCandidates.some((order) => order.productOrderId === candidate.productOrderId)) allCandidates.push(candidate);
      }
      for (const candidate of candidates) {
        if (!allCandidates.some((order) => order.productOrderId === candidate.productOrderId)) allCandidates.push(candidate);
      }
      if (candidates.length === 1 && !selected.some((order) => order.productOrderId === candidates[0].productOrderId)) {
        selected.push(candidates[0]);
      } else {
        ambiguous = true;
      }
    }

    if (selected.length > 1 && !sameBundleIdentity(selected)) {
      return { shipment, status: "review_required", orders: [], candidates: allCandidates, reason: "네이버 묶음배송 기준이 서로 달라 확인이 필요합니다." };
    }
    if (ambiguous || selected.length !== shipment.items.length) {
      return { shipment, status: "review_required", orders: [], candidates: allCandidates, reason: "발송 가능한 주문을 하나로 확정하지 못했습니다." };
    }
    selected.forEach((order) => assigned.add(order.productOrderId));
    return { shipment, status: "auto_matched", orders: selected, candidates: allCandidates, reason: "수취인과 상품 정보가 일치합니다." };
  });
}
