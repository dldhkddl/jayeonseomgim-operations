export type ChannelConnectionStatus = "checking" | "connected" | "disconnected";

export type ChannelConnectionResult = {
  status: Exclude<ChannelConnectionStatus, "checking">;
  message: string;
};

export function connectionPresentation(channel: string, status: ChannelConnectionStatus) {
  if (status === "connected") {
    return { label: `✓ ${channel} 연결됨`, className: "channelConnection connected" };
  }
  if (status === "checking") {
    return { label: `${channel} 확인 중…`, className: "channelConnection checking" };
  }
  return { label: `${channel} 연결`, className: "channelConnection disconnected" };
}

export async function checkChannelConnection(
  endpoint: string,
  fetcher: typeof fetch = fetch,
  init?: RequestInit,
): Promise<ChannelConnectionResult> {
  try {
    const response = await fetcher(endpoint, init);
    const data = await response.json().catch(() => null) as {
      ok?: boolean;
      connected?: boolean;
      error?: string;
    } | null;
    if (response.ok && data?.connected !== false && (data?.ok === true || data?.connected === true)) {
      return { status: "connected", message: "" };
    }
    return {
      status: "disconnected",
      message: data?.error || "연결 상태를 확인하지 못했습니다.",
    };
  } catch (error) {
    return {
      status: "disconnected",
      message: error instanceof Error ? error.message : "연결 상태를 확인하지 못했습니다.",
    };
  }
}
