import { env } from "cloudflare:workers";
import { collectCoupangInventory } from "../../lib/coupang";
import { getAccessToken, isTrustedLocalOperationUrl, searchAllNaverProducts } from "../../lib/naver";
import {
  mergeCollectedInventoryMetrics,
  summarizeChannelInventory,
  type ChannelInventoryItem,
} from "../../lib/inventory/channel-inventory";
import { listCollectedInventoryProducts, saveInventorySnapshot } from "../../lib/orders/order-repository";

type InventoryEnv = {
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  COUPANG_ACCESS_KEY?: string;
  COUPANG_SECRET_KEY?: string;
  COUPANG_VENDOR_ID?: string;
};

export async function GET(request: Request) {
  if (!isTrustedLocalOperationUrl(request.url)) {
    return Response.json({ error: "통합 재고는 이 컴퓨터의 localhost에서만 조회할 수 있습니다." }, { status: 403 });
  }

  try {
    const collectedProducts = await listCollectedInventoryProducts();
    const values = env as unknown as InventoryEnv;
    if (!values.NAVER_CLIENT_ID || !values.NAVER_CLIENT_SECRET) {
      return Response.json({ error: "네이버 API 설정이 필요합니다." }, { status: 400 });
    }

    const naverToken = (await getAccessToken({
      clientId: values.NAVER_CLIENT_ID,
      clientSecret: values.NAVER_CLIENT_SECRET,
    })).accessToken;
    const naverCatalog = await searchAllNaverProducts(naverToken);
    const fetchedAt = new Date().toISOString();
    const naverItems = mergeCollectedInventoryMetrics(naverCatalog.map((product): ChannelInventoryItem => ({
      channel: "naver",
      channelProductNo: product.channelProductNo,
      productName: product.name,
      sellerProductCode: product.sellerManagementCode,
      options: [],
      collectedOrderCount: 0,
      collectedQuantity: 0,
      originProductNo: product.originProductNo,
      imageUrl: product.imageUrl,
      statusType: product.statusType,
      stockQuantity: product.stockQuantity,
      fetchedAt,
    })), collectedProducts);

    let coupangItems: ChannelInventoryItem[] = [];
    let coupangError = "";
    const coupangConfigured = Boolean(values.COUPANG_ACCESS_KEY && values.COUPANG_SECRET_KEY && values.COUPANG_VENDOR_ID);
    if (coupangConfigured) {
      try {
        coupangItems = mergeCollectedInventoryMetrics(await collectCoupangInventory({
          accessKey: values.COUPANG_ACCESS_KEY!,
          secretKey: values.COUPANG_SECRET_KEY!,
          vendorId: values.COUPANG_VENDOR_ID!,
        }), collectedProducts).map((item) => ({ ...item, fetchedAt }));
      } catch (error) {
        coupangError = error instanceof Error ? error.message : "쿠팡 상품·재고 조회에 실패했습니다.";
      }
    } else {
      coupangError = "쿠팡 Access Key, Secret Key, 업체코드 설정이 필요합니다.";
    }

    const unsupported = collectedProducts
      .filter((item) => item.channel !== "naver" && (item.channel !== "coupang" || Boolean(coupangError)))
      .map((item): ChannelInventoryItem => ({
        ...item,
        originProductNo: "",
        imageUrl: "",
        statusType: "",
        stockQuantity: null,
        error: item.channel === "coupang" ? coupangError : `${item.channel} 재고 API는 아직 연결 전입니다.`,
      }));

    const liveItems = [...naverItems, ...coupangItems];
    const snapshotWarnings: string[] = [];
    for (const item of liveItems) {
      if (item.stockQuantity == null) continue;
      try {
        await saveInventorySnapshot(item);
      } catch {
        snapshotWarnings.push(`${item.channel}:${item.channelProductNo}`);
      }
    }

    const allItems = [...liveItems, ...unsupported];
    const successful = allItems.filter((item) => !item.error);
    return Response.json({
      items: allItems,
      summary: summarizeChannelInventory(successful),
      failedCount: allItems.length - successful.length,
      snapshotWarningCount: snapshotWarnings.length,
      channelErrors: { ...(coupangError ? { coupang: coupangError } : {}) },
      channels: {
        naver: "connected",
        coupang: coupangError ? (coupangConfigured ? "error" : "unconfigured") : "connected",
        cafe24: "planned",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "통합 재고를 불러오지 못했습니다." }, { status: 500 });
  }
}
