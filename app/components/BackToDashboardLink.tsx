import { dashboardBackNavigation } from "../lib/dashboard-navigation";

type BackToDashboardLinkProps = {
  className?: string;
};

export default function BackToDashboardLink({ className }: BackToDashboardLinkProps) {
  const navigation = dashboardBackNavigation();
  return (
    <a className={className} href={navigation.href} aria-label="대시보드로 뒤로가기">
      <span aria-hidden="true">←</span> {navigation.label}
    </a>
  );
}
