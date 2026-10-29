"use client";

import Link from "next/link";
import { CHANNEL_CAPABILITIES, CHANNEL_LABELS, type CapabilityState } from "../lib/dashboard";
import { useChannelConnections, type ChannelId } from "../lib/use-channel-connections";
import BackToDashboardLink from "../components/BackToDashboardLink";
import styles from "./connections.module.css";

const CHANNELS = Object.keys(CHANNEL_LABELS) as ChannelId[];
const CAPABILITY_LABELS = { product: "상품", order: "주문", inventory: "재고", invoice: "송장" } as const;
const DETAILS: Record<ChannelId, Record<keyof typeof CAPABILITY_LABELS, string>> = {
  naver: { product: "상품 조회·신규 등록", order: "변경 주문 조회·저장", inventory: "현재 재고 조회·수동 수정", invoice: "주문 매칭·송장 API 전송" },
  cafe24: { product: "상품 신규 등록", order: "주문 자동수집 미구현", inventory: "재고 동기화 미구현", invoice: "송장 API 미구현" },
  coupang: { product: "카테고리 추천만 구현", order: "상태별 주문 조회·수동 저장", inventory: "재고 동기화 미구현", invoice: "송장 API 미구현" },
};

function authCopy(status: "checking" | "connected" | "disconnected") {
  if (status === "connected") return { label: "인증 연결됨", tone: "ready" };
  if (status === "checking") return { label: "확인 중", tone: "checking" };
  return { label: "인증 필요", tone: "attention" };
}

function capabilityCopy(state: CapabilityState, authenticated: boolean) {
  if (state === "not_implemented") return { label: "미구현", tone: "off" };
  if (state === "partial") return { label: authenticated ? "일부 연결" : "설정 필요", tone: authenticated ? "partial" : "attention" };
  return { label: authenticated ? "사용 가능" : "인증 후 사용", tone: authenticated ? "ready" : "attention" };
}

export default function ConnectionsDashboard() {
  const { statuses, check } = useChannelConnections();
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><span>果</span><div><b>담다 AI</b><small>API 연결 센터</small></div></Link>
        <BackToDashboardLink className={styles.back} />
      </header>

      <section className={styles.hero}>
        <span>CHANNEL CONNECTION CENTER</span>
        <h1>연결됐다는 말 대신,<br/><em>어디까지 되는지 보여드립니다.</em></h1>
        <p>인증 성공과 실제 구현 기능을 분리해서 확인하세요. 초록색 인증만으로 주문·재고까지 연결된 것은 아닙니다.</p>
      </section>

      <section className={styles.content} aria-labelledby="channel-status-title">
        <div className={styles.sectionTitle}><span>01</span><div><h2 id="channel-status-title">채널별 연결 상세</h2><p>서버에 저장된 설정과 실제 인증 요청으로 상태를 확인합니다.</p></div></div>
        <div className={styles.channelGrid}>
          {CHANNELS.map((channel) => {
            const status = statuses[channel];
            const auth = authCopy(status);
            const authenticated = status === "connected";
            return (
              <article className={styles.channelCard} key={channel}>
                <div className={styles.channelHead}>
                  <div><small>{channel.toUpperCase()}</small><h2>{CHANNEL_LABELS[channel]}</h2></div>
                  <span className={`${styles.badge} ${styles[auth.tone]}`}>{auth.label}</span>
                </div>
                <div className={styles.capabilityList}>
                  {(Object.keys(CAPABILITY_LABELS) as Array<keyof typeof CAPABILITY_LABELS>).map((capability) => {
                    const state = CHANNEL_CAPABILITIES[channel][capability];
                    const copy = capabilityCopy(state, authenticated);
                    return (
                      <div className={styles.capability} key={capability}>
                        <div><b>{CAPABILITY_LABELS[capability]}</b><small>{DETAILS[channel][capability]}</small></div>
                        <span className={`${styles.miniBadge} ${styles[copy.tone]}`}>{copy.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className={styles.actions}>
                  {channel === "cafe24" ? (
                    <a className={styles.primaryAction} href="/api/cafe24/oauth/start">{authenticated ? "카페24 다시 연결" : "카페24 연결하기"}</a>
                  ) : (
                    <button className={styles.primaryAction} type="button" onClick={() => void check(channel)} disabled={status === "checking"}>연결 다시 확인</button>
                  )}
                </div>
                {!authenticated && <p className={styles.help}>{channel === "naver" ? "네이버 커머스 API Client ID와 Secret을 확인하세요." : channel === "cafe24" ? "Mall ID와 앱 키를 설정한 뒤 카페24 로그인을 승인하세요." : "쿠팡 WING에서 Access Key와 Secret Key를 발급받아 서버 설정에 입력하세요."}</p>}
              </article>
            );
          })}
        </div>

        <section className={styles.roadmap} aria-labelledby="roadmap-title">
          <div><small>NEXT AUTOMATION</small><h2 id="roadmap-title">다음 연결 순서</h2></div>
          <ol><li><b>1</b><span>세 채널 인증 완료</span></li><li><b>2</b><span>주문 자동수집</span></li><li><b>3</b><span>송장 자동전송</span></li><li><b>4</b><span>통합 재고 동기화</span></li></ol>
        </section>
      </section>
    </main>
  );
}
