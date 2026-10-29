"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./orders.module.css";

type OrderItem = {
  channel: "naver" | "coupang" | "cafe24";
  productOrderId: string;
  orderId: string;
  productName: string;
  optionName: string;
  quantity: number;
  paymentAmount: number;
  orderStatus: string;
  claimType: string;
  claimStatus: string;
  recipientName: string;
  recipientPhone1: string;
  zipCode: string;
  baseAddress: string;
  detailedAddress: string;
  lastChangedAt: string;
};

type SyncRun = { status: string; fetchedCount: number; completedAt?: string; error?: string } | null;

const STATUS_LABEL: Record<string, string> = {
  PAYMENT_WAITING: "결제 대기",
  PAYED: "결제 완료",
  DELIVERING: "배송 중",
  DELIVERED: "배송 완료",
  ACCEPT: "결제 완료",
  INSTRUCT: "상품 준비 중",
  DEPARTURE: "배송 지시",
  FINAL_DELIVERY: "배송 완료",
  NONE_TRACKING: "직접 배송",
  PURCHASE_DECIDED: "구매 확정",
  EXCHANGED: "교환",
  CANCELED: "취소",
  RETURNED: "반품",
  CANCELED_BY_NOPAYMENT: "미결제 취소",
};

const CHANNEL_LABEL: Record<OrderItem["channel"], string> = { naver: "네이버", coupang: "쿠팡", cafe24: "카페24" };

function dateTime(value?: string) {
  if (!value) return "수집 기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}

export default function OrdersDashboard() {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [lastRuns, setLastRuns] = useState<Record<string, SyncRun>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [channel, setChannel] = useState("all");
  const [loading, setLoading] = useState(true);
  const [syncingChannel, setSyncingChannel] = useState<"" | "naver" | "coupang">("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/orders?limit=300", { cache: "no-store" });
    const data = await response.json() as { items?: OrderItem[]; lastRuns?: Record<string, SyncRun>; error?: string };
    if (!response.ok) throw new Error(data.error || "주문 목록을 불러오지 못했습니다.");
    setItems(data.items ?? []);
    setLastRuns(data.lastRuns ?? {});
  }, []);

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "주문 목록 오류")).finally(() => setLoading(false));
  }, [load]);

  const filtered = useMemo(() => items.filter((item) => {
    const textMatch = !query || [item.productOrderId, item.orderId, item.productName, item.recipientName].some((value) => value.toLowerCase().includes(query.toLowerCase()));
    return textMatch && (status === "all" || item.orderStatus === status) && (channel === "all" || item.channel === channel);
  }), [items, query, status, channel]);

  async function sync(syncChannel: "naver" | "coupang", historyDays?: number) {
    setSyncingChannel(syncChannel);
    setMessage("");
    try {
      const endpoint = `/api/orders/${syncChannel}/sync${historyDays ? `?days=${historyDays}` : ""}`;
      const response = await fetch(endpoint, { method: "POST" });
      const data = await response.json() as { fetched?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "주문 수집에 실패했습니다.");
      setMessage(`${CHANNEL_LABEL[syncChannel]} ${historyDays ? `최근 ${historyDays}일 전체 수집` : "수집"} 완료 · ${data.fetched ?? 0}건을 확인했습니다.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "주문 수집 오류");
    } finally {
      setSyncingChannel("");
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><span>果</span><div><b>담다 AI</b><small>통합 주문함</small></div></Link>
        <Link href="/" className={styles.back}>대시보드로</Link>
      </header>

      <section className={styles.hero}>
        <div><span>READ-ONLY ORDER INBOX</span><h1>채널 주문을 안전하게<br/><em>읽고 모아봅니다.</em></h1><p>현재 네이버·쿠팡 주문을 조회하고 저장하며, 주문 상태·재고·송장은 변경하지 않습니다.</p></div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", maxWidth: 540 }}>
          <button type="button" onClick={() => void sync("naver")} disabled={Boolean(syncingChannel)}>{syncingChannel === "naver" ? "네이버 수집 중…" : "네이버 새 주문"}</button>
          <button type="button" onClick={() => void sync("naver", 7)} disabled={Boolean(syncingChannel)}>네이버 최근 7일</button>
          <button type="button" onClick={() => void sync("coupang")} disabled={Boolean(syncingChannel)}>{syncingChannel === "coupang" ? "쿠팡 수집 중…" : "쿠팡 새 주문"}</button>
          <button type="button" onClick={() => void sync("coupang", 7)} disabled={Boolean(syncingChannel)}>쿠팡 최근 7일</button>
        </div>
      </section>

      <section className={styles.content}>
        <div className={styles.summary}>
          <div><small>저장 주문</small><b>{items.length}</b><span>상품주문 기준</span></div>
          <div><small>네이버 마지막 수집</small><b>{lastRuns.naver?.status === "completed" ? "정상" : lastRuns.naver ? "확인 필요" : "대기"}</b><span>{dateTime(lastRuns.naver?.completedAt)}</span></div>
          <div><small>쿠팡 마지막 수집</small><b>{lastRuns.coupang?.status === "completed" ? "정상" : lastRuns.coupang ? "확인 필요" : "대기"}</b><span>{dateTime(lastRuns.coupang?.completedAt)}</span></div>
        </div>

        {message && <p className={styles.notice} role="status">{message}</p>}

        <div className={styles.filters}>
          <label><span>주문 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품주문번호·상품·수취인" /></label>
          <label><span>판매 채널</span><select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">전체 채널</option><option value="naver">네이버</option><option value="coupang">쿠팡</option></select></label>
          <label><span>주문 상태</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">전체 상태</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>

        <div className={styles.list} aria-live="polite">
          {loading ? <p className={styles.empty}>주문을 불러오는 중입니다.</p> : filtered.length === 0 ? <p className={styles.empty}>조건에 맞는 주문이 없습니다.</p> : filtered.map((item) => (
            <article className={styles.order} key={`${item.channel}:${item.productOrderId}`}>
              <div className={styles.orderHead}><span>{CHANNEL_LABEL[item.channel]} · {STATUS_LABEL[item.orderStatus] ?? item.orderStatus}</span><b>{item.productName}</b><small>{dateTime(item.lastChangedAt)}</small></div>
              <div className={styles.orderBody}>
                <dl><div><dt>상품주문번호</dt><dd>{item.productOrderId}</dd></div><div><dt>옵션·수량</dt><dd>{item.optionName || "기본 옵션"} · {item.quantity}개</dd></div><div><dt>결제금액</dt><dd>{item.paymentAmount.toLocaleString("ko-KR")}원</dd></div></dl>
                <dl><div><dt>수취인</dt><dd>{item.recipientName} · {item.recipientPhone1}</dd></div><div><dt>배송지</dt><dd>({item.zipCode}) {item.baseAddress} {item.detailedAddress}</dd></div>{item.claimStatus && <div><dt>클레임</dt><dd>{item.claimType} · {item.claimStatus}</dd></div>}</dl>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
