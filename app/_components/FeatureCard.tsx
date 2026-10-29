import Link from "next/link";
import type { DashboardFeature } from "../lib/dashboard";
import styles from "../dashboard.module.css";

type Props = { feature: DashboardFeature; index: number };

export default function FeatureCard({ feature, index }: Props) {
  const gridSpan = feature.id === "products" || feature.id === "orders" ? 6 : 4;
  return (
    <Link href={feature.href} className={`${styles.featureCard} ${styles[feature.tone]}`} style={{ gridColumn: `span ${gridSpan}` }}>
      <div className={styles.cardTop}>
        <span className={styles.cardIndex}>{String(index + 1).padStart(2, "0")}</span>
        <span className={styles.cardArrow} aria-hidden="true">↗</span>
      </div>
      <div>
        <small>{feature.eyebrow}</small>
        <h2>{feature.title}</h2>
        <p>{feature.description}</p>
      </div>
      <b className={styles.cardAction}>{feature.action}</b>
    </Link>
  );
}
