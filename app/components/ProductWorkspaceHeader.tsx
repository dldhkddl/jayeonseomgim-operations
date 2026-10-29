import BackToDashboardLink from "./BackToDashboardLink";
import styles from "./ProductWorkspaceHeader.module.css";

export default function ProductWorkspaceHeader() {
  return (
    <header className={styles.header}>
      <BackToDashboardLink className={styles.back} />
    </header>
  );
}
