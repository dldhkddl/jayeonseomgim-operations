import ConnectionSummary from "./ConnectionSummary";
import DashboardHeader from "./DashboardHeader";
import FeatureCard from "./FeatureCard";
import { DASHBOARD_FEATURES } from "../lib/dashboard";
import styles from "../dashboard.module.css";

export default function DashboardHome() {
  return (
    <main className={styles.dashboard} id="main-content">
      <DashboardHeader />
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>DAMDA COMMERCE OPERATIONS</span>
          <h1>오늘 할 일을<br/><em>한 화면에서 시작하세요.</em></h1>
          <p>상품 제작부터 채널 변환, 송장 처리와 시세 확인까지 필요한 업무를 모았습니다.</p>
        </div>
        <div className={styles.heroMeta}><b>{DASHBOARD_FEATURES.length}</b><span>운영 도구</span></div>
      </section>
      <section className={styles.content} aria-labelledby="tools-title">
        <div className={styles.sectionHeading}><span>01</span><div><h2 id="tools-title">업무 도구</h2><p>진행할 작업을 선택하세요.</p></div></div>
        <div className={styles.featureGrid}>
          {DASHBOARD_FEATURES.map((feature, index) => <FeatureCard key={feature.id} feature={feature} index={index} />)}
        </div>
        <ConnectionSummary />
      </section>
    </main>
  );
}
