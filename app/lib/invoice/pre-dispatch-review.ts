import type { NaverOrder } from "./types.ts";

export type PreDispatchSeverity = "blocking" | "warning";
export type ReviewDecision = "pending" | "confirmed" | "excluded";
export type PreDispatchField = "order" | "recipientName" | "phone" | "address" | "product" | "quantity" | "status" | "deliveryMessage";

export type PreDispatchIssue = {
  code: string;
  severity: PreDispatchSeverity;
  field: PreDispatchField;
  message: string;
};

export type PreDispatchReviewItem = {
  key: string;
  order: NaverOrder;
  issues: PreDispatchIssue[];
};

export type PreDispatchReviewSummary = {
  ready: number;
  warning: number;
  blocking: number;
  excluded: number;
  canExport: boolean;
};

const NOT_DISPATCHABLE = /(배송\s*중|배송\s*완료|발송\s*완료|구매\s*확정|취소|반품|DELIVERING|DELIVERED|PURCHASE_DECIDED|CANCELED|RETURNED)/i;
const REMOTE_AREA = /(제주|울릉|백령|도서|산간)/;
const SPECIAL_DELIVERY_MESSAGE = /(날짜\s*지정|지정\s*배송|부재|연락\s*(?:후|주세요|요망|바람)|전화\s*(?:후|주세요|요망|바람)|도착\s*전)/;

function compact(value: string): string {
  return value.trim().replace(/[\s\-(),.]/g, "").toLowerCase();
}

function phone(value: string): string {
  return value.replace(/\D/g, "");
}

function add(issues: PreDispatchIssue[], code: string, severity: PreDispatchSeverity, field: PreDispatchField, message: string) {
  issues.push({ code, severity, field, message });
}

function uniqueKeys(orders: NaverOrder[]): string[] {
  const totals = new Map<string, number>();
  for (const order of orders) {
    const id = order.productOrderId.trim();
    if (id) totals.set(id, (totals.get(id) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();
  return orders.map((order, index) => {
    const id = order.productOrderId.trim();
    if (!id) return `missing-order-${index + 1}`;
    if ((totals.get(id) ?? 0) === 1) return id;
    const occurrence = (occurrences.get(id) ?? 0) + 1;
    occurrences.set(id, occurrence);
    return `${id}#${occurrence}`;
  });
}

export function reviewPreDispatchOrders(orders: NaverOrder[]): PreDispatchReviewItem[] {
  const idCounts = new Map<string, number>();
  const recipientAddressCounts = new Map<string, number>();
  const identityNames = new Map<string, Set<string>>();
  const keys = uniqueKeys(orders);

  for (const order of orders) {
    const id = order.productOrderId.trim();
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);

    const recipientAddressKey = `${compact(order.recipientName)}|${compact(order.address)}`;
    if (compact(order.recipientName) && compact(order.address)) {
      recipientAddressCounts.set(recipientAddressKey, (recipientAddressCounts.get(recipientAddressKey) ?? 0) + 1);
    }

    const selectedPhone = phone(order.phone1 || order.phone2);
    const identityKey = `${selectedPhone}|${compact(order.address)}`;
    if (selectedPhone && compact(order.address) && compact(order.recipientName)) {
      const names = identityNames.get(identityKey) ?? new Set<string>();
      names.add(compact(order.recipientName));
      identityNames.set(identityKey, names);
    }
  }

  return orders.map((order, index) => {
    const issues: PreDispatchIssue[] = [];
    const id = order.productOrderId.trim();
    const recipientName = order.recipientName.trim();
    const selectedPhone = phone(order.phone1 || order.phone2);
    const address = order.address.trim();
    const productName = order.productName.trim();

    if (!id) add(issues, "missing_product_order_id", "blocking", "order", "상품주문번호가 없습니다.");
    else if ((idCounts.get(id) ?? 0) > 1) add(issues, "duplicate_product_order_id", "blocking", "order", "같은 상품주문번호가 중복되어 있습니다.");
    if (!recipientName) add(issues, "missing_recipient_name", "blocking", "recipientName", "수취인명이 없습니다.");
    if (!selectedPhone) add(issues, "missing_phone", "blocking", "phone", "수취인 전화번호가 없습니다.");
    if (!address) add(issues, "missing_address", "blocking", "address", "배송 주소가 없습니다.");
    if (!productName) add(issues, "missing_product_name", "blocking", "product", "상품명이 없습니다.");
    if (!Number.isFinite(order.quantity) || order.quantity < 1) add(issues, "invalid_quantity", "blocking", "quantity", "수량이 1보다 작습니다.");
    if (NOT_DISPATCHABLE.test(order.status)) add(issues, "not_dispatchable_status", "blocking", "status", `발송할 수 없는 주문 상태입니다: ${order.status || "상태 없음"}`);

    if (selectedPhone && ![10, 11].includes(selectedPhone.length)) add(issues, "invalid_phone_format", "warning", "phone", "전화번호가 10자리 또는 11자리가 아닙니다.");
    if (address && compact(address).length < 12) add(issues, "short_address", "warning", "address", "주소가 짧아 상세주소를 확인해야 합니다.");
    if (address && REMOTE_AREA.test(address)) add(issues, "remote_area", "warning", "address", "제주·도서산간 배송 여부를 확인해야 합니다.");
    if (order.deliveryMessage.trim() && SPECIAL_DELIVERY_MESSAGE.test(order.deliveryMessage)) {
      add(issues, "special_delivery_message", "warning", "deliveryMessage", "출고 전에 확인할 배송메시지가 있습니다.");
    }

    const recipientAddressKey = `${compact(recipientName)}|${compact(address)}`;
    if (recipientName && address && (recipientAddressCounts.get(recipientAddressKey) ?? 0) > 1) {
      add(issues, "combined_shipping_candidate", "warning", "order", "같은 수취인과 주소의 주문이 여러 건입니다. 합포장 여부를 확인하세요.");
    }

    const identityKey = `${selectedPhone}|${compact(address)}`;
    if (selectedPhone && address && (identityNames.get(identityKey)?.size ?? 0) > 1) {
      add(issues, "recipient_identity_conflict", "warning", "recipientName", "같은 전화번호와 주소에 다른 수취인명이 있습니다.");
    }

    return { key: keys[index], order, issues };
  });
}

export function preDispatchItemState(item: PreDispatchReviewItem, decision: ReviewDecision | undefined): "ready" | "warning" | "blocking" | "excluded" {
  if (decision === "excluded") return "excluded";
  if (item.issues.some((issue) => issue.severity === "blocking")) return "blocking";
  if (item.issues.some((issue) => issue.severity === "warning") && decision !== "confirmed") return "warning";
  return "ready";
}

export function summarizePreDispatchReview(
  items: PreDispatchReviewItem[],
  decisions: Record<string, ReviewDecision>,
): PreDispatchReviewSummary {
  const summary = { ready: 0, warning: 0, blocking: 0, excluded: 0 };
  for (const item of items) summary[preDispatchItemState(item, decisions[item.key])] += 1;
  return { ...summary, canExport: items.length > 0 && summary.ready > 0 && summary.warning === 0 && summary.blocking === 0 };
}

export function dispatchableOrders(
  items: PreDispatchReviewItem[],
  decisions: Record<string, ReviewDecision>,
): NaverOrder[] {
  return items.filter((item) => preDispatchItemState(item, decisions[item.key]) === "ready").map((item) => item.order);
}

export function reviewFingerprint(orders: NaverOrder[]): string {
  return JSON.stringify(
    orders.map((order) => ({
      productOrderId: order.productOrderId,
      recipientName: order.recipientName,
      phone1: order.phone1,
      phone2: order.phone2,
      address: order.address,
      productName: order.productName,
      quantity: order.quantity,
      status: order.status,
      deliveryMessage: order.deliveryMessage,
    })).sort((left, right) => left.productOrderId.localeCompare(right.productOrderId)),
  );
}
