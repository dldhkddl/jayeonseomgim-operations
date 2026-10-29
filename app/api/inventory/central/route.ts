import { env } from "cloudflare:workers";

import { changeCoupangStockAndVerify, collectCoupangInventory } from "../../../lib/coupang";
import {
  changeNaverStock,
  getAccessToken,
  isTrustedLocalMutationRequest,
  isTrustedLocalOperationUrl,
  searchAllNaverProducts,
} from "../../../lib/naver";
import {
  buildCentralInventoryQuantityChanges,
  buildCentralInventorySyncChanges,
  buildManualNaverMasterMapping,
  buildNaverMasterMappings,
  buildStoredMappingReviewGroups,
  findCentralInventoryIdForChannelItem,
  reconcileInventoryReservations,
  type CentralInventoryChannelItem,
  type CentralInventoryMapping,
} from "../../../lib/inventory/central-inventory";
import {
  applyCentralInventoryState,
  createCentralInventoryMapping,
  deleteCentralInventoryMapping,
  initializeCentralInventory,
  loadCentralInventoryData,
  loadCentralInventorySnapshots,
} from "../../../lib/inventory/central-inventory-repository";

type CentralInventoryEnv = {
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  COUPANG_ACCESS_KEY?: string;
  COUPANG_SECRET_KEY?: string;
  COUPANG_VENDOR_ID?: string;
};

function credentials() {
  const values = env as unknown as CentralInventoryEnv;
  if (!values.NAVER_CLIENT_ID || !values.NAVER_CLIENT_SECRET) throw new Error("네이버 API 설정이 필요합니다.");
  if (!values.COUPANG_ACCESS_KEY || !values.COUPANG_SECRET_KEY || !values.COUPANG_VENDOR_ID) throw new Error("쿠팡 API 설정이 필요합니다.");
  return values as Required<CentralInventoryEnv>;
}

async function collectLiveInventory() {
  const values = credentials();
  const naverToken = (await getAccessToken({ clientId: values.NAVER_CLIENT_ID, clientSecret: values.NAVER_CLIENT_SECRET })).accessToken;
  const [naver, coupang] = await Promise.all([
    searchAllNaverProducts(naverToken),
    collectCoupangInventory({ accessKey: values.COUPANG_ACCESS_KEY, secretKey: values.COUPANG_SECRET_KEY, vendorId: values.COUPANG_VENDOR_ID }),
  ]);
  const items: CentralInventoryChannelItem[] = [
    ...naver.map((item) => ({
      channel: "naver",
      channelProductNo: item.channelProductNo,
      originProductNo: item.originProductNo,
      sellerProductCode: item.sellerManagementCode,
      productName: item.name,
      stockQuantity: item.stockQuantity,
    })),
    ...coupang.map((item) => ({
      channel: "coupang",
      channelProductNo: item.channelProductNo,
      originProductNo: item.originProductNo,
      sellerProductCode: item.sellerProductCode,
      productName: item.productName,
      stockQuantity: item.stockQuantity,
    })),
  ];
  return { items, naverToken, values };
}

type LiveInventory = Awaited<ReturnType<typeof collectLiveInventory>>;
type StockChange = ReturnType<typeof buildCentralInventorySyncChanges>[number];

async function executeStockChanges(changes: StockChange[], live: LiveInventory) {
  const succeeded: StockChange[] = [];
  const failed: Array<StockChange & { error: string }> = [];
  for (const change of changes) {
    try {
      if (change.channel === "naver") {
        await changeNaverStock(live.naverToken, change.originProductNo, change.newQuantity);
      } else if (change.channel === "coupang") {
        await changeCoupangStockAndVerify({
          accessKey: live.values.COUPANG_ACCESS_KEY,
          secretKey: live.values.COUPANG_SECRET_KEY,
          vendorId: live.values.COUPANG_VENDOR_ID,
        }, change.channelProductNo, change.newQuantity);
      } else {
        throw new Error(`${change.channel} 재고 변경 API는 아직 연결 전입니다.`);
      }
      succeeded.push(change);
    } catch (error) {
      failed.push({ ...change, error: error instanceof Error ? error.message : "재고 변경 실패" });
    }
  }
  return { succeeded, failed };
}

async function buildPreview(liveItems: CentralInventoryChannelItem[]) {
  const discovery = buildNaverMasterMappings(liveItems);
  const stored = await loadCentralInventoryData();
  if (!stored.items.length) {
    return {
      initialized: false as const,
      candidateCount: discovery.groups.length,
      conflictCodes: discovery.conflictCodes,
      unmatchedNaverCount: discovery.unmatchedNaverCount,
      unmatchedChannelCount: discovery.unmatchedChannelCount,
      groups: discovery.groups,
      changes: [],
      pendingReservations: [],
      shortageQuantity: 0,
      missingMappingCount: 0,
      mappedKeys: [] as string[],
      manualMappingIds: [] as string[],
      reviewGroups: [] as ReturnType<typeof buildStoredMappingReviewGroups>,
    };
  }

  const liveByChannelProduct = new Map(liveItems.map((item) => [`${item.channel}:${item.channelProductNo}`, item]));
  const storedItemsById = new Map(stored.items.map((item) => [item.id, item]));
  const mappingsByCentral = new Map<string, typeof stored.mappings>();
  for (const mapping of stored.mappings) {
    mappingsByCentral.set(mapping.centralInventoryId, [...(mappingsByCentral.get(mapping.centralInventoryId) ?? []), mapping]);
  }
  const mappingByChannelProduct = new Map(stored.mappings.map((item) => [`${item.channel}:${item.channelProductNo}`, item.centralInventoryId]));
  const reservationsByCentral = new Map<string, typeof stored.reservations>();
  for (const reservation of stored.reservations) {
    reservationsByCentral.set(reservation.centralInventoryId, [...(reservationsByCentral.get(reservation.centralInventoryId) ?? []), reservation]);
  }

  const ordersByCentral = new Map<string, typeof stored.orders>();
  for (const order of stored.orders) {
    const code = String(order.sellerProductCode ?? "").trim().toUpperCase();
    const centralId = storedItemsById.has(code)
      ? code
      : mappingByChannelProduct.get(`${order.channel}:${order.channelProductId}`);
    if (!centralId) continue;
    const central = storedItemsById.get(centralId);
    const orderedAt = Date.parse(order.orderedAt);
    if (!central || !Number.isFinite(orderedAt) || orderedAt <= Date.parse(central.initializedAt)) continue;
    ordersByCentral.set(centralId, [...(ordersByCentral.get(centralId) ?? []), order]);
  }

  const groups: CentralInventoryMapping[] = [];
  const pendingReservations: Array<{
    id: string; centralInventoryId: string; channel: string; productOrderId: string;
    quantity: number; status: "reserved" | "released";
  }> = [];
  let shortageQuantity = 0;
  let missingMappingCount = 0;

  for (const item of stored.items) {
    const mappings = mappingsByCentral.get(item.id) ?? [];
    const masterMapping = mappings.find((mapping) => mapping.channel === "naver");
    const masterLive = masterMapping ? liveByChannelProduct.get(`naver:${masterMapping.channelProductNo}`) : undefined;
    const targetLive = mappings
      .filter((mapping) => mapping.channel !== "naver")
      .map((mapping) => liveByChannelProduct.get(`${mapping.channel}:${mapping.channelProductNo}`))
      .filter((value): value is CentralInventoryChannelItem => Boolean(value));
    if (!masterLive || targetLive.length !== mappings.filter((mapping) => mapping.channel !== "naver").length) {
      missingMappingCount += 1;
      continue;
    }

    const orderRows = ordersByCentral.get(item.id) ?? [];
    const reconciled = reconcileInventoryReservations(
      item.availableQuantity,
      orderRows.map((order) => ({
        id: order.id,
        sellerProductCode: order.sellerProductCode,
        quantity: order.quantity,
        orderStatus: order.orderStatus,
        claimStatus: order.claimStatus,
      })),
      (reservationsByCentral.get(item.id) ?? []).map((reservation) => ({
        id: reservation.id,
        quantity: reservation.quantity,
        status: reservation.status as "reserved" | "released",
      })),
    );
    shortageQuantity += reconciled.shortageQuantity;
    const orderById = new Map(orderRows.map((order) => [order.id, order]));
    for (const reservation of reconciled.upserts) {
      const order = orderById.get(reservation.id);
      if (!order) continue;
      pendingReservations.push({
        ...reservation,
        centralInventoryId: item.id,
        channel: order.channel,
        productOrderId: order.productOrderId,
      });
    }
    groups.push({
      id: item.id,
      sellerProductCode: item.sellerProductCode,
      productName: item.productName,
      availableQuantity: reconciled.availableQuantity,
      master: {
        channel: "naver",
        channelProductNo: masterLive.channelProductNo,
        originProductNo: masterLive.originProductNo,
        stockQuantity: Math.max(0, masterLive.stockQuantity ?? 0),
      },
      targets: targetLive.map((target) => ({
        channel: target.channel,
        channelProductNo: target.channelProductNo,
        originProductNo: target.originProductNo,
        stockQuantity: Math.max(0, target.stockQuantity ?? 0),
      })),
    });
  }

  return {
    initialized: true as const,
    candidateCount: stored.items.length,
    conflictCodes: discovery.conflictCodes,
    unmatchedNaverCount: discovery.unmatchedNaverCount,
    unmatchedChannelCount: discovery.unmatchedChannelCount,
    groups,
    changes: groups.flatMap(buildCentralInventorySyncChanges),
    pendingReservations,
    shortageQuantity,
    missingMappingCount,
    mappedKeys: stored.mappings.map((item) => item.id),
    manualMappingIds: stored.items.filter((item) => item.mappingSource === "manual").map((item) => item.id),
    reviewGroups: buildStoredMappingReviewGroups(stored.items, stored.mappings),
  };
}

function publicPreview(preview: Awaited<ReturnType<typeof buildPreview>>) {
  const reviewGroups = preview.reviewGroups;
  return {
    initialized: preview.initialized,
    candidateCount: preview.candidateCount,
    conflictCodes: preview.conflictCodes,
    unmatchedNaverCount: preview.unmatchedNaverCount,
    unmatchedChannelCount: preview.unmatchedChannelCount,
    groups: preview.groups.map((group) => ({
      id: group.id,
      sellerProductCode: group.sellerProductCode,
      productName: group.productName,
      availableQuantity: group.availableQuantity,
      naverQuantity: group.master.stockQuantity,
      channelCount: group.targets.length + 1,
    })),
    changes: preview.changes,
    pendingReservationCount: preview.pendingReservations.length,
    shortageQuantity: preview.shortageQuantity,
    missingMappingCount: preview.missingMappingCount,
    mappedKeys: preview.mappedKeys,
    mappingGroups: reviewGroups.filter((group) => group.source === "manual"),
    reviewGroups,
  };
}

export async function GET(request: Request) {
  if (!isTrustedLocalOperationUrl(request.url)) return Response.json({ error: "중앙재고는 이 컴퓨터의 localhost에서만 조회할 수 있습니다." }, { status: 403 });
  try {
    const snapshots = await loadCentralInventorySnapshots();
    return Response.json(publicPreview(await buildPreview(snapshots)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "중앙재고를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isTrustedLocalMutationRequest(request)) return Response.json({ error: "중앙재고 변경은 이 컴퓨터의 localhost에서만 실행할 수 있습니다." }, { status: 403 });
  try {
    const body = await request.json() as {
      action?: "initialize" | "sync" | "map" | "unmap" | "set-quantity";
      confirmed?: boolean;
      naverChannelProductNo?: string;
      coupangChannelProductNo?: string;
      centralInventoryId?: string;
      channel?: string;
      channelProductNo?: string;
      stockQuantity?: number;
    };
    const live = await collectLiveInventory();
    if (body.action === "initialize") {
      const discovery = buildNaverMasterMappings(live.items);
      if (!discovery.groups.length) return Response.json({ error: "안전하게 연결할 수 있는 네이버·쿠팡 상품이 없습니다." }, { status: 400 });
      const result = await initializeCentralInventory(discovery.groups);
      const preview = await buildPreview(live.items);
      return Response.json({ ok: true, ...result, preview: publicPreview(preview) });
    }
    if (body.action === "map") {
      if (body.confirmed !== true) return Response.json({ error: "상품 연결을 최종 확인해 주세요." }, { status: 400 });
      const group = buildManualNaverMasterMapping(
        live.items,
        String(body.naverChannelProductNo ?? ""),
        String(body.coupangChannelProductNo ?? ""),
      );
      const mapping = await createCentralInventoryMapping(group);
      const preview = await buildPreview(live.items);
      return Response.json({ ok: true, mapping, preview: publicPreview(preview) });
    }
    if (body.action === "unmap") {
      if (body.confirmed !== true) return Response.json({ error: "상품 연결 해제를 최종 확인해 주세요." }, { status: 400 });
      const unmapped = await deleteCentralInventoryMapping(String(body.centralInventoryId ?? ""));
      const preview = await buildPreview(live.items);
      return Response.json({ ok: true, unmapped, preview: publicPreview(preview) });
    }
    if (body.action === "set-quantity") {
      if (body.confirmed !== true) return Response.json({ error: "중앙재고 수정을 최종 확인해 주세요." }, { status: 400 });
      const stockQuantity = Number(body.stockQuantity);
      if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 99_999) {
        return Response.json({ error: "중앙재고는 0 이상 99,999 이하의 정수로 입력해 주세요." }, { status: 400 });
      }
      const preview = await buildPreview(live.items);
      if (!preview.initialized) return Response.json({ error: "네이버 기준 중앙재고를 먼저 시작해 주세요." }, { status: 409 });
      const centralInventoryId = findCentralInventoryIdForChannelItem(
        preview.reviewGroups,
        String(body.channel ?? ""),
        String(body.channelProductNo ?? ""),
      );
      const group = preview.groups.find((item) => item.id === centralInventoryId);
      if (!centralInventoryId || !group) {
        return Response.json({ error: "선택한 상품은 중앙재고에 연결되어 있지 않습니다." }, { status: 404 });
      }

      await applyCentralInventoryState({
        quantities: preview.groups.map((item) => ({
          id: item.id,
          availableQuantity: item.id === centralInventoryId ? stockQuantity : item.availableQuantity,
        })),
        reservations: preview.pendingReservations,
      });
      const changes = buildCentralInventoryQuantityChanges(group, stockQuantity);
      const { succeeded, failed } = await executeStockChanges(changes, live);
      return Response.json({
        ok: failed.length === 0,
        centralInventoryId,
        stockQuantity,
        succeededCount: succeeded.length,
        failedCount: failed.length,
        failed,
      }, { status: failed.length ? 207 : 200 });
    }
    if (body.action !== "sync" || body.confirmed !== true) return Response.json({ error: "최종 확인 후에만 재고를 동기화할 수 있습니다." }, { status: 400 });

    const preview = await buildPreview(live.items);
    if (!preview.initialized) return Response.json({ error: "네이버 기준 중앙재고를 먼저 시작해 주세요." }, { status: 409 });
    await applyCentralInventoryState({
      quantities: preview.groups.map((group) => ({ id: group.id, availableQuantity: group.availableQuantity })),
      reservations: preview.pendingReservations,
    });

    const { succeeded, failed } = await executeStockChanges(preview.changes, live);
    return Response.json({
      ok: failed.length === 0,
      succeededCount: succeeded.length,
      failedCount: failed.length,
      failed,
      pendingReservationCount: preview.pendingReservations.length,
    }, { status: failed.length ? 207 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "중앙재고 처리에 실패했습니다." }, { status: 500 });
  }
}
