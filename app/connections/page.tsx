import ConnectionsDashboard from "./ConnectionsDashboard";

export const metadata = {
  title: "API 연결 확인 | 담다 AI",
  description: "네이버, 카페24, 쿠팡의 인증과 기능별 API 연결 상태를 확인합니다.",
};

export default function ConnectionsPage() {
  return <ConnectionsDashboard />;
}
