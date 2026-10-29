export type InventoryChannel = "naver" | "coupang" | "cafe24";

export type CollectedOrderProduct = {
  channel: string;
  channelProductId: string;
  sellerProductCode: string;
  productName: string;
  optionName: string;
  quantity: number;
};

export type CollectedInventoryProduct = {
  channel: string;
  channelProductNo: string;
  sellerProductCode: string;
  productName: string;
  options: string[];
  collectedOrderCount: number;
  collectedQuantity: number;
};

export type ChannelInventoryItem = CollectedInventoryProduct & {
  originProductNo: string;
  imageUrl: string;
  statusType: string;
  stockQuantity: number | null;
  fetchedAt?: string;
  error?: string;
};

export function mergeCollectedInventoryMetrics(
  liveItems: ChannelInventoryItem[],
  collectedItems: CollectedInventoryProduct[],
): ChannelInventoryItem[] {
  const collectedByItem = new Map(collectedItems.map((item) => [`${item.channel}:${item.channelProductNo}`, item]));
  return liveItems.map((item) => {
    const collected = collectedByItem.get(`${item.channel}:${item.channelProductNo}`);
    if (!collected) return item;
    return {
      ...item,
      sellerProductCode: item.sellerProductCode || collected.sellerProductCode,
      productName: item.productName || collected.productName,
      options: [...new Set([...item.options, ...collected.options])],
      collectedOrderCount: collected.collectedOrderCount,
      collectedQuantity: collected.collectedQuantity,
    };
  });
}

export function buildInventorySnapshotRecord(item: ChannelInventoryItem, fetchedAt = new Date().toISOString()) {
  if (item.stockQuantity == null) return null;
  return {
    id: `${item.channel}:${item.channelProductNo}`,
    channel: item.channel,
    channelProductNo: item.channelProductNo,
    originProductNo: item.originProductNo,
    productName: item.productName,
    sellerManagementCode: item.sellerProductCode,
    statusType: item.statusType,
    stockQuantity: item.stockQuantity,
    fetchedAt,
  };
}

export function groupCollectedInventoryProducts(rows: CollectedOrderProduct[]): CollectedInventoryProduct[] {
  const grouped = new Map<string, CollectedInventoryProduct>();
  for (const row of rows) {
    const channelProductNo = String(row.channelProductId ?? "").trim();
    if (!channelProductNo) continue;
    const channel = String(row.channel ?? "").trim();
    const key = `${channel}:${channelProductNo}`;
    const current = grouped.get(key) ?? {
      channel,
      channelProductNo,
      sellerProductCode: String(row.sellerProductCode ?? "").trim(),
      productName: String(row.productName ?? "").trim(),
      options: [],
      collectedOrderCount: 0,
      collectedQuantity: 0,
    };
    current.collectedOrderCount += 1;
    current.collectedQuantity += Math.max(0, Number(row.quantity) || 0);
    const option = String(row.optionName ?? "").trim();
    if (option && !current.options.includes(option)) current.options.push(option);
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

export function summarizeChannelInventory(items: Array<Pick<ChannelInventoryItem, "channel" | "channelProductNo" | "stockQuantity" | "statusType">>) {
  const distinct = [...new Map(items.map((item) => [`${item.channel}:${item.channelProductNo}`, item])).values()];
  return {
    productCount: distinct.length,
    totalStockQuantity: distinct.reduce((sum, item) => sum + (item.stockQuantity == null ? 0 : Math.max(0, item.stockQuantity)), 0),
    unknownStockProductCount: distinct.filter((item) => item.stockQuantity == null).length,
    saleProductCount: distinct.filter((item) => item.statusType === "SALE").length,
    soldOutProductCount: distinct.filter((item) => item.statusType === "OUTOFSTOCK").length,
    suspendedProductCount: distinct.filter((item) => item.statusType === "SUSPENSION").length,
  };
}

export function summarizeInventoryForChannel(
  items: Array<Pick<ChannelInventoryItem, "channel" | "channelProductNo" | "stockQuantity" | "statusType">>,
  channel: InventoryChannel | "all",
) {
  return summarizeChannelInventory(channel === "all" ? items : items.filter((item) => item.channel === channel));
}

export function getInventoryImageOverlay(statusType: string): { label: string; tone: "soldout" | "suspended" } | null {
  if (statusType === "OUTOFSTOCK") return { label: "품절", tone: "soldout" };
  if (statusType === "SUSPENSION") return { label: "판매중지", tone: "suspended" };
  return null;
}

export type InventoryStatusAction = {
  targetStatus: "SALE" | "SUSPENSION";
  label: string;
  enabled: boolean;
  disabledLabel: string;
};

export function getInventoryStatusAction(statusType: string, stockQuantity: number | null): InventoryStatusAction | null {
  if (statusType === "SUSPENSION") {
    const enabled = stockQuantity != null && stockQuantity > 0;
    return {
      targetStatus: "SALE",
      label: "판매중으로 변경",
      enabled,
      disabledLabel: enabled ? "" : "재고 1개 이상 필요",
    };
  }
  if (["SALE", "OUTOFSTOCK", "WAIT"].includes(statusType)) {
    return {
      targetStatus: "SUSPENSION",
      label: "판매중지로 변경",
      enabled: true,
      disabledLabel: "",
    };
  }
  return null;
}
