export type DashboardFeature = {
  id: "products" | "orders" | "inventory" | "converter" | "invoice" | "market" | "margin" | "price-watcher" | "connections";
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  action: string;
  tone: "forest" | "leaf" | "sand" | "cream" | "ink";
};

export const DASHBOARD_FEATURES: DashboardFeature[] = [
  {
    id: "products",
    eyebrow: "PRODUCT STUDIO",
    title: "상품등록",
    description: "사진과 상품 기본정보를 입력하고 네이버·카페24 등록까지 진행합니다.",
    href: "/products",
    action: "상품 관리 열기",
    tone: "forest",
  },
  {
    id: "orders",
    eyebrow: "ORDER INBOX",
    title: "주문 수집",
    description: "네이버·쿠팡 주문과 상태 변경을 안전하게 읽어 저장합니다.",
    href: "/orders",
    action: "주문 확인하기",
    tone: "leaf",
  },
  {
    id: "inventory",
    eyebrow: "NAVER INVENTORY",
    title: "재고 관리",
    description: "네이버 상품의 현재 재고를 조회하고 확인 후 안전하게 수정합니다.",
    href: "/inventory",
    action: "재고 확인하기",
    tone: "forest",
  },
  {
    id: "converter",
    eyebrow: "CHANNEL WORKBOOK",
    title: "채널 엑셀 변환",
    description: "한 채널의 상품 엑셀을 다른 판매채널의 등록 양식으로 바꿉니다.",
    href: "/product-converter",
    action: "엑셀 변환하기",
    tone: "leaf",
  },
  {
    id: "invoice",
    eyebrow: "INVOICE AUTOMATION",
    title: "송장 자동변환",
    description: "공급처 송장과 주문 내역을 대조해 네이버 발송 양식을 만듭니다.",
    href: "/invoice-converter",
    action: "송장 처리하기",
    tone: "sand",
  },
  {
    id: "market",
    eyebrow: "MARKET SIGNAL",
    title: "가락시장 시세",
    description: "과일별 실거래 가격과 최근 흐름을 확인해 판매가 결정을 돕습니다.",
    href: "/market-prices",
    action: "시세 확인하기",
    tone: "cream",
  },
  {
    id: "margin",
    eyebrow: "CHANNEL PROFIT",
    title: "마진 계산기",
    description: "한 번의 비용 입력으로 네이버·쿠팡·카페24 예상 순이익과 마진율을 비교합니다.",
    href: "/margin-calculator",
    action: "채널 마진 비교하기",
    tone: "sand",
  },
  {
    id: "price-watcher",
    eyebrow: "PURCHASE PRICE",
    title: "매입단가 확인",
    description: "매주 받는 매입단가 엑셀을 올려 전주 대비 변동률과 목표 마진율 기준 참고 판매가를 확인합니다.",
    href: "/price-watcher",
    action: "매입단가 확인하기",
    tone: "cream",
  },
  {
    id: "connections",
    eyebrow: "CHANNEL CONNECTIONS",
    title: "API 연결 확인",
    description: "네이버·카페24·쿠팡의 인증과 상품·주문·재고 연결 범위를 확인합니다.",
    href: "/connections",
    action: "연결 상세 보기",
    tone: "ink",
  },
];

export type CapabilityState = "live" | "implemented" | "partial" | "not_implemented";
export type ChannelCapability = {
  auth: CapabilityState;
  product: CapabilityState;
  order: CapabilityState;
  inventory: CapabilityState;
  invoice: CapabilityState;
};

export const CHANNEL_CAPABILITIES: Record<"naver" | "cafe24" | "coupang", ChannelCapability> = {
  naver: { auth: "live", product: "implemented", order: "implemented", inventory: "implemented", invoice: "implemented" },
  cafe24: { auth: "live", product: "implemented", order: "not_implemented", inventory: "not_implemented", invoice: "not_implemented" },
  coupang: { auth: "live", product: "partial", order: "implemented", inventory: "not_implemented", invoice: "not_implemented" },
};

export const CHANNEL_LABELS = {
  naver: "네이버 스마트스토어",
  cafe24: "카페24",
  coupang: "쿠팡",
} as const;
