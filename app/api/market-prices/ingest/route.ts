import { env } from "cloudflare:workers";
import { GarakClient } from "../../../lib/market-prices/garak-client.ts";
import { hasMarketPricesSession } from "../../../lib/market-prices/access.ts";
import { buildGarakPriceQueries, collectGarakPriceQueries } from "../../../lib/market-prices/ingestion.ts";
import { MarketPriceRepository } from "../../../lib/market-prices/repository.ts";

export async function POST(request: Request) {
  const secret = request.headers.get("x-market-prices-scheduler-secret");
  const schedulerAllowed = Boolean(secret && secret === process.env.MARKET_PRICES_SCHEDULER_SECRET);
  if (!schedulerAllowed && !hasMarketPricesSession(request)) return Response.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "가격 데이터베이스가 연결되지 않았습니다." }, { status: 503 });

  const now = new Date();
  const params = new URL(request.url).searchParams;
  const requestedItem = params.get("item")?.trim();
  const requestedDays = Number(params.get("days") ?? "1");
  let queries;
  try {
    queries = buildGarakPriceQueries({
      now,
      itemNames: requestedItem ? [requestedItem] : (process.env.GARAK_TRACKED_ITEMS ?? "").split(","),
      categoryCode: process.env.GARAK_FRUIT_CATEGORY_CODE ?? "2",
      marketCode: process.env.GARAK_MARKET_CODE ?? "1",
      days: requestedItem && Number.isFinite(requestedDays) ? requestedDays : 1,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const repository = new MarketPriceRepository(env.DB);
  const client = GarakClient.fromEnvironment(process.env);
  const runIds = new Map<string, string>();
  const queryKey = (query: (typeof queries)[number]) => `${query.searchDate}:${query.itemName}`;
  const result = await collectGarakPriceQueries(queries, {
    fetch: async (query) => {
      const runId = `garak-${query.searchDate}-${now.getTime()}-${runIds.size}`;
      runIds.set(queryKey(query), runId);
      await repository.startIngestionRun({ id: runId, query, startedAt: now.toISOString() });
      return client.fetchPrices(query);
    },
    persist: async (rows, query) => {
      await repository.upsertPrices(rows);
      await repository.completeIngestionRun(runIds.get(queryKey(query))!, { fetchedCount: rows.length, persistedCount: rows.length });
    },
    onFailure: async (query, error) => {
      const runId = runIds.get(queryKey(query));
      if (runId) await repository.failIngestionRun(runId, error);
    },
  });

  if (result.completedDates.length === 0) {
    return Response.json({ error: "가락시장 API에서 조회 가능한 가격을 받지 못했습니다.", failedDates: result.failedDates }, { status: 502 });
  }
  return Response.json({ ok: true, fetched: result.fetched, date: queries[0].searchDate, completedDates: result.completedDates, failedDates: result.failedDates });
}
