/**
 * 채널별 기본 양식 (내장)
 *
 * 양식 파일을 올리지 않아도 채널 탭만 누르면 바로 변환되도록,
 * 각 채널의 대량등록 컬럼 구성을 코드에 넣어 둔다.
 *
 * ⚠ 한계를 분명히 해둔다
 *   여기 적힌 컬럼 이름은 각 채널의 일반적인 표기를 따른 것이지, 공식 양식을 그대로 옮긴 게 아니다.
 *   채널은 컬럼 이름이나 순서가 조금만 달라도 파일 전체를 반려한다.
 *   그래서 화면에서 "연습용"임을 계속 표시하고, 실제 양식으로 교체하도록 안내한다.
 *
 * 교체 방법: 채널 관리자에서 받은 빈 양식을 올리면 이 기본값을 덮어쓴다.
 */

import { analyzeTemplate, loadXlsx, type TemplateAnalysis } from "./mapping.ts";

export const BUILTIN_HEADERS: Record<string, string[]> = {
  smartstore: [
    "카테고리ID", "상품명", "판매가", "재고수량", "대표이미지 URL", "추가이미지 URL", "상세설명",
    "판매자 상품코드", "브랜드", "제조사", "모델명", "원산지코드", "부가세", "미성년자 구매", "상품상태",
    "배송방법", "배송비유형", "기본배송비", "반품배송비", "교환배송비", "출고지", "반품/교환지",
    "A/S 전화번호", "A/S 안내내용", "상품정보제공고시 상품군", "태그(최대 10개)", "판매상태", "옵션명", "옵션값", "옵션가",
  ],
  coupang: [
    "노출상품명", "카테고리", "판매가격", "재고수량", "대표이미지", "추가이미지", "상세설명", "셀러상품코드", "브랜드",
    "제조사", "원산지", "과세여부", "배송비종류", "기본배송비", "반품배송비", "출고지주소", "반품지주소",
    "A/S 안내", "고객센터", "검색어", "옵션명", "옵션값", "상품군",
  ],
  cafe24: [
    "상품코드", "자체상품코드", "진열상태", "판매상태", "상품분류 번호", "상품명", "영문 상품명", "상품 요약설명",
    "상품 상세설명", "모델명", "소비자가", "공급가", "상품가", "과세구분", "제조사", "공급사", "브랜드", "원산지",
    "이미지등록(목록)", "추가이미지", "이미지등록(상세)", "배송정보", "배송비", "옵션사용", "옵션항목명", "옵션값", "재고수량",
    "상품 검색어", "성인인증", "상품정보제공고시 상품군",
  ],
  "11st": [
    "셀러상품코드", "카테고리코드", "상품명", "판매가", "할인판매가", "판매수량", "상품이미지", "부가이미지",
    "상세HTML", "브랜드명", "제조사명", "원산지명", "면세여부", "배송유형", "배송비설정", "반품비", "교환비",
    "출고지", "회수지", "고객센터", "A/S 안내", "정보고시 상품군", "키워드", "전시상태",
  ],
};

export function hasBuiltin(channelId: string): boolean {
  return Boolean(BUILTIN_HEADERS[channelId]?.length);
}

/**
 * 내장 컬럼 구성으로 빈 양식 워크북을 만든 뒤, 업로드된 양식과 **똑같은 경로**로 해석한다.
 * 해석 코드를 따로 두면 기본 양식과 실제 양식의 동작이 갈리므로, 반드시 같은 함수를 태운다.
 */
export async function buildBuiltinTemplate(channelId: string, channelLabel: string): Promise<TemplateAnalysis | null> {
  const headers = BUILTIN_HEADERS[channelId];
  if (!headers?.length) return null;

  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([
    [`⚠ 연습용 기본 양식입니다 — ${channelLabel} 관리자에서 받은 실제 양식으로 교체한 뒤 등록하세요`],
    headers,
  ]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, h.length * 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "상품등록");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  const analysis = await analyzeTemplate(bytes, {
    channelId,
    channelLabel,
    fileName: `${channelLabel} 기본 양식 (연습용)`,
  });
  return { ...analysis, builtin: true };
}
