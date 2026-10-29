export type CentralInventoryChannelItem = {
  channel: string;
  channelProductNo: string;
  originProductNo: string;
  sellerProductCode: string;
  productName: string;
  stockQuantity: number | null;
  statusType?: string;
};

export type CentralInventoryReviewGroup = {
  id: string;
  source: "auto" | "manual";
  masterKey: string;
  targetKeys: string[];
};

export function findCentralInventoryIdForChannelItem(
  groups: CentralInventoryReviewGroup[],
  channel: string,
  channelProductNo: string,
) {
  const key = `${channel}:${channelProductNo}`;
  return groups.find((group) => group.masterKey === key || group.targetKeys.includes(key))?.id ?? null;
}

export type CentralInventoryMapping = {
  id: string;
  sellerProductCode: string;
  productName: string;
  availableQuantity: number;
  master: {
    channel: "naver";
    channelProductNo: string;
    originProductNo: string;
    stockQuantity: number;
  };
  targets: Array<{
    channel: string;
    channelProductNo: string;
    originProductNo: string;
    stockQuantity: number;
  }>;
};

function normalizedSellerCode(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

export function buildCentralInventoryOverview(
  items: CentralInventoryChannelItem[],
  reviewGroups: CentralInventoryReviewGroup[],
) {
  const itemByKey = new Map(items.map((item) => [`${item.channel}:${item.channelProductNo}`, item]));
  const mappedKeys = new Set(reviewGroups.flatMap((group) => [group.masterKey, ...group.targetKeys]));
  const codeCleanupProducts: Array<{ id: string; productName: string; channels: string[] }> = [];
  const records: Array<{ stockQuantity: number | null; statusType: string }> = [];

  for (const group of reviewGroups) {
    const linked = [group.masterKey, ...group.targetKeys]
      .map((key) => itemByKey.get(key))
      .filter((item): item is CentralInventoryChannelItem => Boolean(item));
    const master = itemByKey.get(group.masterKey) ?? linked[0];
    const stockQuantity = master?.stockQuantity ?? null;
    const statuses = linked.map((item) => String(item.statusType ?? "").toUpperCase()).filter(Boolean);
    const statusType = stockQuantity == null
      ? "UNKNOWN"
      : stockQuantity <= 0
        ? "OUTOFSTOCK"
        : statuses.length > 0 && statuses.every((status) => status === "SUSPENSION")
          ? "SUSPENSION"
          : statuses.includes("SALE")
            ? "SALE"
            : statuses.includes("SUSPENSION")
              ? "SUSPENSION"
              : "UNKNOWN";
    records.push({ stockQuantity, statusType });

    const canonicalCode = normalizedSellerCode(group.id);
    const channels = [...new Set(linked
      .filter((item) => normalizedSellerCode(item.sellerProductCode) !== canonicalCode)
      .map((item) => item.channel))];
    if (channels.length) {
      codeCleanupProducts.push({
        id: group.id,
        productName: master?.productName ?? group.id,
        channels,
      });
    }
  }

  const standalone = items.filter((item) => !mappedKeys.has(`${item.channel}:${item.channelProductNo}`));
  records.push(...standalone.map((item) => ({
    stockQuantity: item.stockQuantity,
    statusType: item.stockQuantity != null && item.stockQuantity <= 0
      ? "OUTOFSTOCK"
      : String(item.statusType ?? "").toUpperCase(),
  })));

  return {
    productCount: records.length,
    totalStockQuantity: records.reduce((sum, item) => sum + (item.stockQuantity == null ? 0 : Math.max(0, item.stockQuantity)), 0),
    unknownStockProductCount: records.filter((item) => item.stockQuantity == null).length,
    saleProductCount: records.filter((item) => item.statusType === "SALE").length,
    soldOutProductCount: records.filter((item) => item.statusType === "OUTOFSTOCK").length,
    suspendedProductCount: records.filter((item) => item.statusType === "SUSPENSION").length,
    connectedProductCount: reviewGroups.length,
    standaloneProductCount: standalone.length,
    codeCleanupCount: codeCleanupProducts.length,
    codeCleanupProducts,
  };
}

export function explainUnmappedInventoryItem(
  items: CentralInventoryChannelItem[],
  item: CentralInventoryChannelItem,
) {
  const code = normalizedSellerCode(item.sellerProductCode);
  const channelLabel = item.channel === "naver" ? "네이버" : item.channel === "coupang" ? "쿠팡" : "카페24";
  const counterpartChannel = item.channel === "naver" ? "coupang" : "naver";
  const counterpartLabel = counterpartChannel === "naver" ? "네이버" : "쿠팡";

  if (!code) return `${channelLabel} 판매자 상품코드가 비어 있어 자동 연결하지 않았습니다.`;

  const sameChannelCount = items.filter((candidate) =>
    candidate.channel === item.channel && normalizedSellerCode(candidate.sellerProductCode) === code
  ).length;
  if (sameChannelCount > 1) {
    return `${channelLabel}에 같은 코드가 ${sameChannelCount}개라 어떤 상품인지 확정할 수 없습니다.`;
  }

  const counterpartCount = items.filter((candidate) =>
    candidate.channel === counterpartChannel && normalizedSellerCode(candidate.sellerProductCode) === code
  ).length;
  if (counterpartCount === 0) return `${counterpartLabel}에 같은 코드가 없어 자동 연결하지 않았습니다.`;
  if (counterpartCount > 1) return `${counterpartLabel}에 같은 코드가 ${counterpartCount}개라 자동 연결하지 않았습니다.`;
  return "상대 채널에 같은 코드 상품이 있지만 중앙재고에 아직 연결되지 않았습니다.";
}

export function buildNaverMasterMappings(items: CentralInventoryChannelItem[]) {
  const byCode = new Map<string, CentralInventoryChannelItem[]>();
  for (const item of items) {
    const code = normalizedSellerCode(item.sellerProductCode);
    if (!code) continue;
    byCode.set(code, [...(byCode.get(code) ?? []), item]);
  }

  const groups: CentralInventoryMapping[] = [];
  const conflictCodes: string[] = [];
  let unmatchedNaverCount = 0;
  let unmatchedChannelCount = 0;

  for (const [code, codeItems] of [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const naver = codeItems.filter((item) => item.channel === "naver");
    const targets = codeItems.filter((item) => item.channel !== "naver");
    if (naver.length > 1 || targets.some((item) => targets.filter((candidate) => candidate.channel === item.channel).length > 1)) {
      conflictCodes.push(code);
      continue;
    }
    if (naver.length !== 1) {
      unmatchedChannelCount += targets.length;
      continue;
    }
    if (!targets.length) {
      unmatchedNaverCount += 1;
      continue;
    }
    const master = naver[0];
    if (master.stockQuantity == null) {
      conflictCodes.push(code);
      continue;
    }
    groups.push({
      id: code,
      sellerProductCode: code,
      productName: master.productName,
      availableQuantity: Math.max(0, master.stockQuantity),
      master: {
        channel: "naver",
        channelProductNo: master.channelProductNo,
        originProductNo: master.originProductNo,
        stockQuantity: Math.max(0, master.stockQuantity),
      },
      targets: targets.map((item) => ({
        channel: item.channel,
        channelProductNo: item.channelProductNo,
        originProductNo: item.originProductNo,
        stockQuantity: Math.max(0, item.stockQuantity ?? 0),
      })),
    });
  }

  return { groups, conflictCodes, unmatchedNaverCount, unmatchedChannelCount };
}

export function buildManualNaverMasterMapping(
  items: CentralInventoryChannelItem[],
  naverChannelProductNo: string,
  coupangChannelProductNo: string,
): CentralInventoryMapping {
  const naver = items.find((item) => item.channel === "naver" && item.channelProductNo === String(naverChannelProductNo));
  if (!naver) throw new Error("선택한 네이버 상품을 찾을 수 없습니다.");
  const coupang = items.find((item) => item.channel === "coupang" && item.channelProductNo === String(coupangChannelProductNo));
  if (!coupang) throw new Error("선택한 쿠팡 상품을 찾을 수 없습니다.");
  if (naver.stockQuantity == null) throw new Error("네이버 재고가 확인된 상품만 연결할 수 있습니다.");
  if (coupang.stockQuantity == null) throw new Error("쿠팡 재고가 확인된 상품만 연결할 수 있습니다.");

  const code = normalizedSellerCode(naver.sellerProductCode) || `NAVER-${naver.channelProductNo}`;
  return {
    id: code,
    sellerProductCode: code,
    productName: naver.productName,
    availableQuantity: Math.max(0, naver.stockQuantity),
    master: {
      channel: "naver",
      channelProductNo: naver.channelProductNo,
      originProductNo: naver.originProductNo,
      stockQuantity: Math.max(0, naver.stockQuantity),
    },
    targets: [{
      channel: "coupang",
      channelProductNo: coupang.channelProductNo,
      originProductNo: coupang.originProductNo,
      stockQuantity: Math.max(0, coupang.stockQuantity),
    }],
  };
}

export type CentralInventorySyncChange = {
  centralInventoryId: string;
  sellerProductCode: string;
  productName: string;
  channel: string;
  channelProductNo: string;
  originProductNo: string;
  previousQuantity: number;
  newQuantity: number;
};

export function buildCentralInventorySyncChanges(group: CentralInventoryMapping): CentralInventorySyncChange[] {
  const channels = [group.master, ...group.targets];
  return channels.flatMap((item) => item.stockQuantity === group.availableQuantity ? [] : [{
    centralInventoryId: group.id,
    sellerProductCode: group.sellerProductCode,
    productName: group.productName,
    channel: item.channel,
    channelProductNo: item.channelProductNo,
    originProductNo: item.originProductNo,
    previousQuantity: item.stockQuantity,
    newQuantity: group.availableQuantity,
  }]);
}

export function buildCentralInventoryQuantityChanges(
  group: CentralInventoryMapping,
  newQuantity: number,
): CentralInventorySyncChange[] {
  return buildCentralInventorySyncChanges({ ...group, availableQuantity: newQuantity });
}

export function buildMappingReviewGroups(groups: CentralInventoryMapping[], manualMappingIds: string[]) {
  const manual = new Set(manualMappingIds);
  return groups.map((group) => ({
    id: group.id,
    source: manual.has(group.id) ? "manual" as const : "auto" as const,
    masterKey: `${group.master.channel}:${group.master.channelProductNo}`,
    targetKeys: group.targets.map((item) => `${item.channel}:${item.channelProductNo}`),
  }));
}

export function buildStoredMappingReviewGroups(
  items: Array<{ id: string; mappingSource: string }>,
  mappings: Array<{ centralInventoryId: string; channel: string; channelProductNo: string }>,
) {
  return items.flatMap((item) => {
    const linked = mappings.filter((mapping) => mapping.centralInventoryId === item.id);
    const master = linked.find((mapping) => mapping.channel === "naver");
    if (!master) return [];
    return [{
      id: item.id,
      source: item.mappingSource === "manual" ? "manual" as const : "auto" as const,
      masterKey: `naver:${master.channelProductNo}`,
      targetKeys: linked.filter((mapping) => mapping.channel !== "naver").map((mapping) => `${mapping.channel}:${mapping.channelProductNo}`),
    }];
  });
}

export function listUnmappedChannelItems<T extends { channel: string; channelProductNo: string }>(
  items: T[],
  mappedKeys: string[],
) {
  const mapped = new Set(mappedKeys);
  const unmapped = items.filter((item) => !mapped.has(`${item.channel}:${item.channelProductNo}`));
  return {
    naver: unmapped.filter((item) => item.channel === "naver"),
    coupang: unmapped.filter((item) => item.channel === "coupang"),
  };
}

export type InventoryReservation = {
  id: string;
  quantity: number;
  status: "reserved" | "released";
};

export type InventoryReservationOrder = {
  id: string;
  sellerProductCode: string;
  quantity: number;
  orderStatus: string;
  claimStatus: string;
};

const ACTIVE_ORDER_STATUSES = new Set([
  "PAYED", "DELIVERING", "DELIVERED", "PURCHASE_DECIDED",
  "ACCEPT", "INSTRUCT", "DEPARTURE", "FINAL_DELIVERY",
]);
const COMPLETED_CANCEL_STATUSES = new Set(["CANCELED", "CANCEL_DONE", "CANCEL_COMPLETE"]);

function desiredReservationStatus(order: InventoryReservationOrder): "reserved" | "released" | "ignored" {
  const orderStatus = String(order.orderStatus ?? "").trim().toUpperCase();
  const claimStatus = String(order.claimStatus ?? "").trim().toUpperCase();
  if (COMPLETED_CANCEL_STATUSES.has(orderStatus) || COMPLETED_CANCEL_STATUSES.has(claimStatus)) return "released";
  return ACTIVE_ORDER_STATUSES.has(orderStatus) ? "reserved" : "ignored";
}

export function reconcileInventoryReservations(
  currentAvailableQuantity: number,
  orders: InventoryReservationOrder[],
  existingReservations: InventoryReservation[],
) {
  let rawAvailableQuantity = Math.max(0, currentAvailableQuantity);
  const existingById = new Map(existingReservations.map((item) => [item.id, item]));
  const upserts: InventoryReservation[] = [];

  for (const order of orders) {
    const desired = desiredReservationStatus(order);
    const existing = existingById.get(order.id);
    const quantity = Math.max(0, Math.trunc(Number(order.quantity) || 0));
    if (!quantity || desired === "ignored") continue;

    if (desired === "reserved") {
      if (!existing) {
        rawAvailableQuantity -= quantity;
        upserts.push({ id: order.id, quantity, status: "reserved" });
      } else if (existing.status === "released") {
        rawAvailableQuantity -= quantity;
        upserts.push({ id: order.id, quantity, status: "reserved" });
      } else if (existing.quantity !== quantity) {
        rawAvailableQuantity += existing.quantity - quantity;
        upserts.push({ id: order.id, quantity, status: "reserved" });
      }
      continue;
    }

    if (existing?.status === "reserved") {
      rawAvailableQuantity += existing.quantity;
      upserts.push({ id: order.id, quantity: existing.quantity, status: "released" });
    }
  }

  return {
    availableQuantity: Math.max(0, rawAvailableQuantity),
    shortageQuantity: Math.max(0, -rawAvailableQuantity),
    upserts,
  };
}
