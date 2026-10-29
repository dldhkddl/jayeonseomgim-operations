/**
 * 공통 상품 스키마 (Canonical Product Schema)
 *
 * 채널(스마트스토어·쿠팡·카페24·11번가…)마다 대량등록 엑셀의 컬럼명과 순서가 다르다.
 * 그래서 상품 데이터는 여기 정의된 "공통 스키마" 하나로만 관리하고,
 * 채널별 엑셀은 매핑표(ColumnMapping)를 통해 파생시킨다.
 *
 * 데이터 계약(data contract) 원칙
 *  - 이 파일이 유일한 진실 원천(single source of truth)이다.
 *  - 필드를 지우거나 id를 바꾸면 기존 매핑표가 깨진다. id는 불변으로 취급한다.
 *  - 새 채널 대응은 이 파일이 아니라 매핑표에서 해결한다.
 *
 * aliases: 실제 채널 양식에서 관찰되는 헤더 표기 변형. 자동 매핑의 사전 역할.
 */

export type CanonicalGroup =
  | "기본정보"
  | "가격·재고"
  | "옵션"
  | "이미지·상세"
  | "배송·반품"
  | "고시·표시"
  | "노출·상태";

export type CanonicalType = "text" | "longtext" | "number";

export type CanonicalField = {
  id: string;
  label: string;
  group: CanonicalGroup;
  type: CanonicalType;
  /** 채널 양식에서 이 필드를 가리킬 때 쓰이는 헤더 표기들 */
  aliases: string[];
  /** 대부분의 채널에서 비면 등록이 반려되는 필드 */
  critical?: boolean;
  note?: string;
};

export const CANONICAL_FIELDS: CanonicalField[] = [
  // ── 기본정보 ────────────────────────────────────────────────────────────
  {
    id: "channelProductNo",
    label: "채널 상품번호",
    group: "기본정보",
    type: "text",
    aliases: ["상품번호", "채널상품번호", "스마트스토어상품번호", "channelProductNo"],
    note: "채널에서 기존 상품 상세를 다시 조회할 때 사용하는 번호.",
  },
  {
    id: "sellerProductCode",
    label: "판매자 상품코드",
    group: "기본정보",
    type: "text",
    critical: true,
    aliases: ["판매자상품코드", "업체상품코드", "셀러상품코드", "자체상품코드", "상품코드", "외부상품코드", "sellerManagementCode", "자체코드", "판매자관리코드"],
    note: "채널 간 대사(reconciliation) 키. 중복되면 덮어쓰기 사고가 난다.",
  },
  {
    id: "productName",
    label: "상품명",
    group: "기본정보",
    type: "text",
    critical: true,
    aliases: ["상품명", "제품명", "상품이름", "노출상품명", "쿠팡 노출상품명", "등록상품명", "productName"],
  },
  {
    id: "category",
    label: "카테고리",
    group: "기본정보",
    type: "text",
    critical: true,
    aliases: ["카테고리", "카테고리명", "카테고리id", "카테고리코드", "표준카테고리", "전시카테고리", "노출카테고리", "categoryId", "상품분류", "상품분류번호", "카테고리번호", "진열카테고리"],
  },
  { id: "brand", label: "브랜드", group: "기본정보", type: "text", aliases: ["브랜드", "브랜드명", "brand"] },
  {
    id: "manufacturer",
    label: "제조사·생산자",
    group: "기본정보",
    type: "text",
    aliases: ["제조사", "제조사명", "제조원", "생산자", "생산자명", "공급사", "manufacturer", "공급업체"],
  },
  { id: "modelName", label: "모델명", group: "기본정보", type: "text", aliases: ["모델명", "모델", "modelName"] },
  {
    id: "origin",
    label: "원산지",
    group: "기본정보",
    type: "text",
    critical: true,
    aliases: ["원산지", "원산지코드", "원산지명", "생산지", "origin", "originAreaCode", "원산지지역", "원산지구분"],
  },
  {
    id: "variety",
    label: "품종",
    group: "기본정보",
    type: "text",
    aliases: ["품종", "품목", "종류", "품종명"],
  },
  {
    id: "weightSpec",
    label: "중량·구성",
    group: "기본정보",
    type: "text",
    critical: true,
    aliases: ["중량", "중량수량", "용량", "구성", "규격", "포장단위", "수량중량", "내용량", "판매옵션", "옵션구성", "판매단위"],
  },

  // ── 가격·재고 ───────────────────────────────────────────────────────────
  {
    id: "price",
    label: "판매가",
    group: "가격·재고",
    type: "number",
    critical: true,
    aliases: ["판매가", "판매가격", "가격", "정상가", "소비자가", "salePrice", "price"],
  },
  {
    id: "discountPrice",
    label: "할인가",
    group: "가격·재고",
    type: "number",
    aliases: ["할인가", "할인판매가", "즉시할인가", "할인금액", "discountPrice"],
  },
  {
    id: "supplyPrice",
    label: "공급가",
    group: "가격·재고",
    type: "number",
    aliases: ["공급가", "공급가격", "매입가", "원가", "supplyPrice"],
  },
  {
    id: "stock",
    label: "재고수량",
    group: "가격·재고",
    type: "number",
    critical: true,
    aliases: ["재고", "재고수량", "수량", "판매수량", "stockQuantity", "quantity", "보유재고"],
  },
  {
    id: "taxType",
    label: "부가세 구분",
    group: "가격·재고",
    type: "text",
    aliases: ["부가세", "부가세구분", "과세구분", "면세여부", "과세여부", "taxType"],
    note: "미가공 농산물은 대개 면세.",
  },
  {
    id: "purchaseLimit",
    label: "구매수량 제한",
    group: "가격·재고",
    type: "text",
    aliases: ["구매수량제한", "최대구매수량", "1회구매수량", "구매제한", "최소구매수량"],
  },

  // ── 옵션 ────────────────────────────────────────────────────────────────
  { id: "optionType", label: "옵션 구분", group: "옵션", type: "text", aliases: ["옵션구분", "옵션타입", "옵션유형", "조합형단독형", "옵션사용", "옵션사용여부", "옵션방식"] },
  { id: "optionName", label: "옵션명", group: "옵션", type: "text", aliases: ["옵션명", "옵션이름", "옵션항목", "구매옵션유형1", "구매옵션유형", "optionName"] },
  { id: "optionValue", label: "옵션값", group: "옵션", type: "text", aliases: ["옵션값", "옵션상세", "옵션내용", "구매옵션값1", "구매옵션값", "optionValue"] },
  { id: "optionPrice", label: "옵션가", group: "옵션", type: "number", aliases: ["옵션가", "옵션가격", "옵션추가금액", "추가금액", "optionPrice"] },
  { id: "optionStock", label: "옵션 재고", group: "옵션", type: "number", aliases: ["옵션재고", "옵션재고수량", "옵션수량"] },

  // ── 이미지·상세 ─────────────────────────────────────────────────────────
  {
    id: "mainImage",
    label: "대표 이미지",
    group: "이미지·상세",
    type: "text",
    critical: true,
    aliases: ["대표이미지", "대표이미지url", "메인이미지", "썸네일", "대표사진", "representativeImage", "mainImage", "상품이미지", "목록이미지", "이미지등록목록", "기본이미지", "이미지url"],
  },
  {
    id: "extraImages",
    label: "추가 이미지",
    group: "이미지·상세",
    type: "text",
    aliases: ["추가이미지", "추가이미지url", "서브이미지", "부가이미지", "optionalImages", "이미지등록추가", "여분이미지"],
    note: "여러 장은 채널 규칙에 맞춰 구분자로 이어 붙인다.",
  },
  {
    id: "detailImage",
    label: "상세 이미지",
    group: "이미지·상세",
    type: "text",
    aliases: ["상세이미지", "이미지등록상세", "상세이미지url", "상세컷", "detailImage"],
  },
  {
    id: "detailContent",
    label: "상세설명",
    group: "이미지·상세",
    type: "longtext",
    critical: true,
    aliases: ["상세설명", "상품상세", "상세페이지", "상품설명", "상세내용", "detailContent", "상세html", "상품상세html", "상세설명html", "상세페이지html", "상세정보"],
  },
  { id: "feature", label: "상품 특징", group: "이미지·상세", type: "longtext", aliases: ["상품특징", "특징", "셀링포인트", "핵심포인트", "상품요약설명", "요약설명", "간단설명", "상품요약"] },

  // ── 배송·반품 ───────────────────────────────────────────────────────────
  { id: "deliveryType", label: "배송방법", group: "배송·반품", type: "text", aliases: ["배송방법", "배송유형", "배송구분", "택배구분", "deliveryType", "배송정보", "배송조건", "배송설정"] },
  { id: "deliveryCompany", label: "택배사", group: "배송·반품", type: "text", aliases: ["택배사", "택배사코드", "배송사", "배송사코드", "deliveryCompany"] },
  {
    id: "deliveryFeeType",
    label: "배송비 유형",
    group: "배송·반품",
    type: "text",
    aliases: ["배송비유형", "배송비종류", "무료배송여부", "배송비설정", "deliveryFeeType"],
  },
  { id: "deliveryFee", label: "배송비", group: "배송·반품", type: "number", aliases: ["배송비", "기본배송비", "배송요금", "deliveryFee"] },
  { id: "returnFee", label: "반품배송비", group: "배송·반품", type: "number", aliases: ["반품배송비", "반품비", "returnFee", "returnDeliveryFee"] },
  { id: "exchangeFee", label: "교환배송비", group: "배송·반품", type: "number", aliases: ["교환배송비", "교환비", "exchangeFee"] },
  { id: "shipFromAddress", label: "출고지", group: "배송·반품", type: "text", aliases: ["출고지", "출고지주소", "발송지", "상품출고지"] },
  { id: "returnAddress", label: "반품·교환지", group: "배송·반품", type: "text", aliases: ["반품교환지", "반품지", "교환지", "반품주소", "회수지"] },

  // ── 고시·표시 ───────────────────────────────────────────────────────────
  {
    id: "infoNoticeGroup",
    label: "상품정보제공고시 상품군",
    group: "고시·표시",
    type: "text",
    critical: true,
    aliases: ["상품정보제공고시", "정보고시", "고시상품군", "상품군", "정보제공고시", "productInfoProvidedNotice", "정보고시상품군", "고시분류"],
  },
  { id: "infoNoticeItems", label: "고시 항목값", group: "고시·표시", type: "longtext", aliases: ["고시항목", "고시정보", "정보고시내용", "상품정보고시항목"] },
  { id: "storage", label: "보관방법", group: "고시·표시", type: "text", aliases: ["보관방법", "보관", "취급방법", "보관및취급"] },
  { id: "expiry", label: "소비기한", group: "고시·표시", type: "text", aliases: ["소비기한", "유통기한", "품질유지기한", "소비기한정보"] },
  { id: "certification", label: "인증·표시", group: "고시·표시", type: "text", aliases: ["인증", "인증정보", "인증번호", "친환경인증", "표시사항"] },
  { id: "asPhone", label: "A/S·상담 전화", group: "고시·표시", type: "text", aliases: ["as전화번호", "소비자상담", "고객센터", "상담전화", "afterServiceTelephoneNumber", "고객센터전화", "cs전화", "소비자상담실"] },
  { id: "asGuide", label: "A/S 안내", group: "고시·표시", type: "longtext", aliases: ["as안내내용", "as정보", "교환반품안내", "afterServiceGuideContent", "as안내", "as안내문구", "as정책"] },

  // ── 노출·상태 ───────────────────────────────────────────────────────────
  { id: "keywords", label: "검색 태그", group: "노출·상태", type: "text", aliases: ["태그", "검색태그", "키워드", "검색키워드", "seo태그", "sellerTags", "검색어", "상품검색어", "키워드태그", "seo키워드"] },
  { id: "saleStatus", label: "판매상태", group: "노출·상태", type: "text", aliases: ["판매상태", "전시상태", "판매전시상태", "판매여부", "statusType"] },
  { id: "channelExpose", label: "채널 노출", group: "노출·상태", type: "text", aliases: ["네이버쇼핑", "채널노출", "노출설정", "쇼핑연동", "전시여부", "진열상태", "진열여부", "노출여부"] },
  { id: "productCondition", label: "상품상태", group: "노출·상태", type: "text", aliases: ["상품상태", "신상품중고", "상품컨디션", "productCondition"] },
  { id: "minorPurchase", label: "미성년자 구매", group: "노출·상태", type: "text", aliases: ["미성년자구매", "미성년자구매여부", "성인인증", "minorPurchasable"] },
];

export const CANONICAL_BY_ID: Record<string, CanonicalField> = Object.fromEntries(
  CANONICAL_FIELDS.map((f) => [f.id, f]),
);

export const CRITICAL_FIELD_IDS = CANONICAL_FIELDS.filter((f) => f.critical).map((f) => f.id);

/** 한 상품(또는 한 옵션 행)의 값. 키는 CanonicalField.id */
export type CanonicalRow = Record<string, string | number | undefined>;

/**
 * 숫자 칸에 들어갈 값을 판정한다.
 *
 * 단순히 숫자가 아닌 문자를 지워버리면 안 된다.
 * "택배 / 무료배송 / 제주 3,000원 / 울릉 11,12" 같은 안내 문구가
 * 30001112 라는 엉터리 숫자로 둔갑해 그대로 채널에 등록되기 때문이다.
 *
 * 그래서 "깔끔한 숫자"일 때만 숫자로 바꾸고, 설명이 섞여 있으면 글자 그대로 둔다.
 * 사람이 미리보기에서 보고 고칠 수 있게 하는 편이 조용히 틀리는 것보다 낫다.
 */
export function parseNumberLike(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, "").replace(/원$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
