import Link from "next/link";
import styles from "../dashboard.module.css";

export default function DashboardHeader() {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="담다 AI 대시보드">
        <span className={styles.brandMark}>果</span>
        <span><b>담다 AI</b><small>판매 운영 대시보드</small></span>
      </Link>
      <nav className={styles.nav} aria-label="주요 메뉴">
        <Link href="/products">상품등록</Link>
        <Link href="/connections">API 연결</Link>
      </nav>
    </header>
  );
}
