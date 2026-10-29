import DashboardHome from "./_components/DashboardHome";

export const metadata = {
  title: "담다 AI | 판매 운영 대시보드",
  description: "상품등록, 채널 엑셀 변환, 송장 처리, 시세 확인과 API 연결 상태를 한곳에서 관리합니다.",
};

export default function DashboardPage() {
  return <DashboardHome />;
}
