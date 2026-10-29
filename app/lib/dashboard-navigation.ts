export type DashboardBackNavigation = {
  href: string;
  label: string;
};

export function dashboardBackNavigation(): DashboardBackNavigation {
  return { href: "/", label: "뒤로가기" };
}
