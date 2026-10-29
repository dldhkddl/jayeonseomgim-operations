"use client";

import { useCallback, useEffect, useState } from "react";
import { checkChannelConnection, type ChannelConnectionStatus } from "./channel-connection";

export type ChannelId = "naver" | "cafe24" | "coupang";
export type ChannelConnectionMap = Record<ChannelId, ChannelConnectionStatus>;

const INITIAL: ChannelConnectionMap = { naver: "checking", cafe24: "checking", coupang: "checking" };

const REQUESTS: Record<ChannelId, { endpoint: string; init?: RequestInit }> = {
  naver: { endpoint: "/api/naver/token", init: { method: "POST" } },
  cafe24: { endpoint: "/api/cafe24/status" },
  coupang: { endpoint: "/api/coupang/status" },
};

export function useChannelConnections() {
  const [statuses, setStatuses] = useState<ChannelConnectionMap>(INITIAL);

  const check = useCallback(async (channel: ChannelId) => {
    setStatuses((current) => ({ ...current, [channel]: "checking" }));
    const request = REQUESTS[channel];
    const result = await checkChannelConnection(request.endpoint, fetch, request.init);
    setStatuses((current) => ({ ...current, [channel]: result.status }));
    return result;
  }, []);

  useEffect(() => {
    void Promise.all((Object.keys(REQUESTS) as ChannelId[]).map(check));
  }, [check]);

  return { statuses, check };
}
