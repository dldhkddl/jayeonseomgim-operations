"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import BackToDashboardLink from "../components/BackToDashboardLink";
import {
  calculateChannelMargins,
  DEFAULT_CHANNEL_FEES,
  sellingPriceForTargetProductMargin,
  type ChannelFeeRates,
  type MarginChannel,
  type MarginInput,
} from "../lib/margin-calculator";
import styles from "./margin-calculator.module.css";
import targetStyles from "./target-margin.module.css";

type MoneyField = Exclude<keyof MarginInput, "taxable">;

const CHANNEL_LABEL: Record<MarginChannel, string> = { naver: "네이버", coupang: "쿠팡", cafe24: "카페24" };
const CHANNEL_NOTE: Record<MarginChannel, string> = {
  naver: "Npay·판매 수수료 참고값",
  coupang: "카테고리 판매 수수료 참고값",
  cafe24: "국내 카드 PG 수수료 참고값",
};
const MONEY_FIELDS: Array<{ key: MoneyField; label: string; hint: string }> = [
  { key: "sellingPrice", label: "상품 판매가", hint: "할인 후 고객 결제 상품금액" },
  { key: "productCost", label: "상품 매입원가", hint: "상품 1건의 실제 매입 금액" },
  { key: "customerShippingFee", label: "고객이 낸 배송비", hint: "무료배송이면 0원" },
  { key: "actualShippingCost", label: "실제 택배비", hint: "판매자가 부담하는 배송비" },
  { key: "packagingCost", label: "포장비", hint: "박스·완충재·아이스팩 등" },
  { key: "advertisingCost", label: "건당 광고비", hint: "주문 1건에 배분한 광고비" },
  { key: "otherCost", label: "기타 비용", hint: "인건비·쿠폰 부담금 등" },
];
const EMPTY_INPUT: MarginInput = {
  sellingPrice: 0,
  productCost: 0,
  customerShippingFee: 0,
  actualShippingCost: 0,
  packagingCost: 0,
  advertisingCost: 0,
  otherCost: 0,
  taxable: false,
};

function won(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

export default function MarginCalculator() {
  const [input, setInput] = useState<MarginInput>(EMPTY_INPUT);
  const [feeRates, setFeeRates] = useState<ChannelFeeRates>(DEFAULT_CHANNEL_FEES);
  const [targetMargin, setTargetMargin] = useState("");
  const results = useMemo(() => calculateChannelMargins(input, feeRates), [input, feeRates]);
  const targetMarginNumber = targetMargin === "" ? Number.NaN : Number(targetMargin);
  const recommendedSellingPrice = sellingPriceForTargetProductMargin(input.productCost, targetMarginNumber);
  const targetPriceMessage = input.productCost <= 0
    ? "상품 매입 원가를 입력해 주세요."
    : targetMargin === ""
      ? "목표 마진율을 입력해 주세요."
      : targetMarginNumber >= 100
        ? "목표 마진율은 100%보다 작아야 합니다."
        : targetMarginNumber < 0 || !Number.isFinite(targetMarginNumber)
          ? "0% 이상의 목표 마진율을 입력해 주세요."
          : "상품 매입 원가 기준 · 100원 단위 올림";

  function updateMoney(key: MoneyField, value: string) {
    setInput((current) => ({ ...current, [key]: numericValue(value) }));
  }

  function updateFee(channel: MarginChannel, value: string) {
    setFeeRates((current) => ({ ...current, [channel]: Math.min(numericValue(value), 100) }));
  }

  function reset() {
    setInput(EMPTY_INPUT);
    setFeeRates(DEFAULT_CHANNEL_FEES);
    setTargetMargin("");
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><span>果</span><div><b>담다 AI</b><small>채널별 마진 계산기</small></div></Link>
        <BackToDashboardLink className={styles.back} />
      </header>

      <section className={styles.hero}>
        <div><span>MARGIN COMPARISON</span><h1>같은 상품의 수익을<br/><em>채널별로 비교하세요.</em></h1><p>비용은 한 번만 입력하고 네이버·쿠팡·카페24의 예상 순이익과 마진율을 동시에 확인합니다.</p></div>
        <div className={styles.heroMeta}><b>3</b><span>판매 채널 비교</span></div>
      </section>

      <section className={styles.content}>
        <div className={styles.inputPanel}>
          <div className={styles.panelHead}><div><small>01 · COMMON COST</small><h2>공통 판매 조건</h2><p>모든 금액은 상품 1건 기준으로 입력하세요.</p></div><button type="button" onClick={reset}>전체 초기화</button></div>
          <div className={styles.inputGrid}>
            {MONEY_FIELDS.map((field) => (
              <label key={field.key}><span>{field.label}</span><div><input type="number" min="0" step="100" value={input[field.key] || ""} onChange={(event) => updateMoney(field.key, event.target.value)} placeholder="0"/><b>원</b></div><small>{field.hint}</small></label>
            ))}
            <label className={styles.taxField}><span>과세 구분</span><select value={input.taxable ? "taxable" : "taxFree"} onChange={(event) => setInput((current) => ({ ...current, taxable: event.target.value === "taxable" }))}><option value="taxFree">면세 상품</option><option value="taxable">과세 상품</option></select><small>과세 선택 시 매출의 1/11을 예상 부가세로 반영합니다.</small></label>
          </div>
          <section className={targetStyles.targetPanel} aria-labelledby="target-margin-title">
            <div className={targetStyles.targetIntro}>
              <small>PRODUCT MARGIN TARGET</small>
              <h3 id="target-margin-title">목표 마진 판매가</h3>
              <p>상품 매입 원가만 기준으로 계산하며 100원 단위로 올림합니다.</p>
            </div>
            <label className={targetStyles.targetInput}>
              <span>목표 마진율</span>
              <div>
                <input
                  aria-label="목표 마진율"
                  type="number"
                  min="0"
                  max="99.99"
                  step="0.1"
                  value={targetMargin}
                  onChange={(event) => setTargetMargin(event.target.value)}
                  placeholder="예: 20"
                />
                <b>%</b>
              </div>
            </label>
            <div className={targetStyles.targetResult} aria-live="polite">
              <span>권장 판매가</span>
              <strong>{recommendedSellingPrice === null ? "-" : won(recommendedSellingPrice)}</strong>
              <small>{targetPriceMessage}</small>
            </div>
            <button
              className={targetStyles.targetButton}
              type="button"
              disabled={recommendedSellingPrice === null}
              onClick={() => setInput((current) => ({
                ...current,
                sellingPrice: recommendedSellingPrice ?? current.sellingPrice,
              }))}
            >
              판매가에 적용
            </button>
          </section>
        </div>

        <div className={styles.resultHead}><div><small>02 · CHANNEL RESULT</small><h2>채널별 예상 마진</h2></div><p>수수료는 판매자 등급·카테고리·계약에 따라 다릅니다. 실제 적용 요율로 수정해 주세요.</p></div>
        <div className={styles.resultGrid} aria-live="polite">
          {results.map((result) => (
            <article className={`${styles.resultCard} ${result.isBest ? styles.best : ""}`} key={result.channel}>
              <div className={styles.cardTop}><div><small>{result.channel.toUpperCase()}</small><h3>{CHANNEL_LABEL[result.channel]}</h3></div>{result.isBest && <span>최고 마진</span>}</div>
              <label className={styles.feeInput}><span>예상 수수료율</span><div><input aria-label={`${CHANNEL_LABEL[result.channel]} 예상 수수료율`} type="number" min="0" max="100" step="0.01" value={feeRates[result.channel]} onChange={(event) => updateFee(result.channel, event.target.value)}/><b>%</b></div><small>{CHANNEL_NOTE[result.channel]}</small></label>
              <div className={styles.profit}><small>예상 순이익</small><strong className={result.profit < 0 ? styles.negative : ""}>{won(result.profit)}</strong><span>마진율 {result.marginRate.toLocaleString("ko-KR")}%</span></div>
              <dl>
                <div><dt>총 결제금액</dt><dd>{won(result.revenue)}</dd></div>
                <div><dt>채널 수수료</dt><dd>-{won(result.platformFee)}</dd></div>
                <div><dt>고정 비용</dt><dd>-{won(result.fixedCost)}</dd></div>
                {input.taxable && <div><dt>예상 부가세</dt><dd>-{won(result.estimatedVat)}</dd></div>}
                <div><dt>원가 대비 수익률</dt><dd>{result.roi.toLocaleString("ko-KR")}%</dd></div>
                <div><dt>손익분기 판매가</dt><dd>{won(result.breakEvenSellingPrice)}</dd></div>
              </dl>
              <p className={styles.gap}>{result.profitGap > 0 ? `최고 채널보다 ${won(result.profitGap)} 낮음` : "현재 조건에서 가장 높은 예상 순이익"}</p>
            </article>
          ))}
        </div>
        <p className={styles.disclaimer}>본 계산 결과는 참고용 예상치입니다. 쿠폰 분담금, 부가 서비스, 정산 조정액과 실제 세무 공제는 포함되지 않을 수 있습니다.</p>
      </section>
    </main>
  );
}
