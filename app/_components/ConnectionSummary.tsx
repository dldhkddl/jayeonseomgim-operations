"use client";

import Link from "next/link";
import { CHANNEL_LABELS } from "../lib/dashboard";
import { useChannelConnections, type ChannelId } from "../lib/use-channel-connections";
import styles from "../dashboard.module.css";

const CHANNELS = Object.keys(CHANNEL_LABELS) as ChannelId[];

function statusLabel(status: "checking" | "connected" | "disconnected") {
  if (status === "connected") return "인증 연결됨";
  if (status === "checking") return "확인 중";
  return "연결 필요";
}

export default function ConnectionSummary() {
  const { statuses } = useChannelConnections();
  return (
    <section className={styles.connectionPanel} aria-labelledby="connection-summary-title">
      <div className={styles.panelHeading}>
        <div><small>LIVE CONNECTIONS</small><h2 id="connection-summary-title">판매채널 연결 상태</h2></div>
        <Link href="/connections">연결 상세 보기 <span aria-hidden="true">→</span></Link>
      </div>
      <div className={styles.channelRows}>
        {CHANNELS.map((channel) => (
          <div className={styles.channelRow} key={channel}>
            <span className={`${styles.statusDot} ${styles[statuses[channel]]}`} aria-hidden="true" />
            <b>{CHANNEL_LABELS[channel]}</b>
            <span className={`${styles.statusText} ${styles[statuses[channel]]}`}>{statusLabel(statuses[channel])}</span>
          </div>
        ))}
      </div>
      <p className={styles.connectionHint}>초록색 인증 상태가 주문·재고까지 연결됐다는 뜻은 아닙니다. 상세 화면에서 기능별 상태를 확인할 수 있습니다.</p>
    </section>
  );
}
