"use client";

import { useEffect, useMemo, useState } from "react";
import { CHANNELS } from "../lib/channels/channels";
import {
  DEFAULT_FEES,
  breakEvenPrice,
  calcMargin,
  feeFor,
  initialMarginState,
  loadCost,
  loadFees,
  pct,
  priceForTargetMargin,
  roundPrice,
  saveCost,
  saveFees,
  totalCost,
  won,
  type CostInput,
  type FeeInput,
} from "../lib/margin";

type Props = {
  /** 현재 상품의 판매가 (문자열이어도 됨) */
  currentPrice?: string | number;
  /** 면세 상품인가 (미가공 농산물 = 면세) */
  taxFree?: boolean;
  /** 계산한 가격을 채널 판매가로 적용 */
  onApplyPrice?: (channelId: string, price: number) => void;
  /** 이미 적용된 채널별 가격 */
  appliedPrices?: Record<string, number>;
  onNotice?: (message: string) => void;
};

const COST_FIELDS: { key: keyof CostInput; label: string; hint: string }[] = [
  { key: "supply", label: "매입가", hint: "사입 원가" },
  { key: "packaging", label: "포장비", hint: "박스·완충재·스티커" },
  { key: "shipping", label: "택배비", hint: "무료배송이면 판매자 부담분" },
  { key: "other", label: "기타", hint: "광고비 등 건당 배분" },
];

const num = (v: string | number | undefined) => Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;

export default function MarginCalculator({
  currentPrice,
  taxFree = true,
  onApplyPrice,
  appliedPrices = {},
  onNotice,
}: Props) {
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState<CostInput>(() => initialMarginState().cost);
  const [fees, setFees] = useState<Record<string, FeeInput>>(() => initialMarginState().fees);
  const [price, setPrice] = useState<number>(num(currentPrice));
  const [target, setTarget] = useState(25);
  const [roundUnit, setRoundUnit] = useState(100);
  const [isTaxFree, setIsTaxFree] = useState(taxFree);
  const [mode, setMode] = useState<"check" | "target">("check");

  useEffect(() => {
    // localStorage는 hydration이 끝난 뒤 읽어야 서버 HTML과 첫 클라이언트 렌더가 일치한다.
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      setCost(loadCost());
      setFees(loadFees());
    });
    return () => {
      alive = false;
    };
  }, []);

  function setCostField(key: keyof CostInput, value: string) {
    const next = { ...cost, [key]: num(value) };
    setCost(next);
    saveCost(next);
  }

  function feeOf(channelId: string): FeeInput {
    return fees[channelId] ?? feeFor(channelId);
  }

  function setFeeField(channelId: string, patch: Partial<FeeInput>) {
    const next = { ...fees, [channelId]: { ...feeOf(channelId), ...patch } };
    setFees(next);
    saveFees(next);
  }

  const rows = useMemo(
    () =>
      CHANNELS.map((c) => {
        const fee = feeOf(c.id);
        const result = calcMargin(price, cost, fee, isTaxFree);
        const suggested = priceForTargetMargin(target / 100, cost, fee, isTaxFree);
        const breakEven = breakEvenPrice(cost, fee, isTaxFree);
        return {
          channel: c,
          fee,
          result,
          suggested: suggested === null ? null : roundPrice(suggested, roundUnit),
          breakEven: breakEven === null ? null : roundPrice(breakEven, roundUnit),
        };
      }),
    // feeOf/cost/price 변경 시 재계산
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fees, cost, price, target, roundUnit, isTaxFree],
  );

  const costSum = totalCost(cost);
  const noCost = costSum === 0;

  function applyAll() {
    if (!onApplyPrice) return;
    let applied = 0;
    for (const r of rows) {
      if (r.suggested === null) continue;
      onApplyPrice(r.channel.id, r.suggested);
      applied += 1;
    }
    onNotice?.(
      applied
        ? `채널 ${applied}곳의 판매가를 마진 ${target}% 기준으로 적용했습니다.`
        : "적용할 수 있는 가격이 없습니다. 목표 마진율을 낮춰 보세요.",
    );
  }

  return (
    <div className="mgn">
      <button className="mgnHead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="mgnCaret">{open ? "▾" : "▸"}</span>
        <b>마진 계산기</b>
        <small>
          {noCost ? "원가를 입력하면 채널별 마진이 나옵니다" : `원가 ${won(costSum)} 기준`}
          {Object.keys(appliedPrices).length > 0 && <em> · 판매가 적용됨 {Object.keys(appliedPrices).length}곳</em>}
        </small>
      </button>

      {open && (
        <div className="mgnBody">
          {/* 원가 */}
          <div className="mgnSection">
            <div className="mgnSectionHead">
              <b>1. 원가</b>
              <small>한 개 팔 때 실제로 나가는 돈</small>
            </div>
            <div className="mgnCostGrid">
              {COST_FIELDS.map((f) => (
                <label key={f.key}>
                  <span>
                    {f.label}
                    <i>{f.hint}</i>
                  </span>
                  <input
                    inputMode="numeric"
                    value={cost[f.key] || ""}
                    placeholder="0"
                    onChange={(e) => setCostField(f.key, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="mgnCostSum">
              합계 <b>{won(costSum)}</b>
              <label className="mgnTax">
                <input type="checkbox" checked={isTaxFree} onChange={(e) => setIsTaxFree(e.target.checked)} />
                면세 상품 (미가공 농산물)
              </label>
            </div>
          </div>

          {/* 모드 */}
          <div className="mgnSection">
            <div className="mgnSegment">
              <button className={mode === "check" ? "on" : ""} onClick={() => setMode("check")}>
                이 가격의 마진 보기
              </button>
              <button className={mode === "target" ? "on" : ""} onClick={() => setMode("target")}>
                목표 마진으로 가격 뽑기
              </button>
            </div>

            {mode === "check" ? (
              <label className="mgnInline">
                <span>판매가</span>
                <input inputMode="numeric" value={price || ""} onChange={(e) => setPrice(num(e.target.value))} />
                <i>원</i>
              </label>
            ) : (
              <div className="mgnInlineRow">
                <label className="mgnInline">
                  <span>목표 마진율</span>
                  <input inputMode="numeric" value={target} onChange={(e) => setTarget(num(e.target.value))} />
                  <i>%</i>
                </label>
                <label className="mgnInline">
                  <span>끝자리</span>
                  <select value={roundUnit} onChange={(e) => setRoundUnit(Number(e.target.value))}>
                    <option value={1}>1원</option>
                    <option value={10}>10원</option>
                    <option value={100}>100원</option>
                    <option value={1000}>1,000원</option>
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* 채널별 결과 */}
          <div className="mgnSection">
            <div className="mgnSectionHead">
              <b>2. 채널별</b>
              <small>수수료율은 카테고리·등급마다 다릅니다. 정산 화면에서 확인하고 고쳐 쓰세요.</small>
            </div>

            <div className="mgnTable">
              <div className="mgnRow mgnRowHead">
                <span>채널</span>
                <span>수수료</span>
                {mode === "check" ? (
                  <>
                    <span>정산액</span>
                    <span>마진</span>
                  </>
                ) : (
                  <>
                    <span>손익분기</span>
                    <span>권장가</span>
                  </>
                )}
              </div>

              {rows.map(({ channel, fee, result, suggested, breakEven }) => {
                const loss = mode === "check" && price > 0 && result.margin < 0;
                return (
                  <div className={`mgnRow ${loss ? "loss" : ""}`} key={channel.id}>
                    <span className="mgnCh">
                      {channel.label}
                      {appliedPrices[channel.id] ? <b className="mgnApplied">{won(appliedPrices[channel.id])}</b> : null}
                    </span>
                    <span className="mgnFee">
                      <input
                        inputMode="decimal"
                        value={fee.rate}
                        onChange={(e) => setFeeField(channel.id, { rate: num(e.target.value) })}
                      />
                      <i>%</i>
                      <label title="수수료에 부가세 10% 별도">
                        <input
                          type="checkbox"
                          checked={fee.feeVat}
                          onChange={(e) => setFeeField(channel.id, { feeVat: e.target.checked })}
                        />
                        VAT
                      </label>
                    </span>
                    {mode === "check" ? (
                      <>
                        <span>{price > 0 ? won(result.settlement) : "—"}</span>
                        <span className="mgnMargin">
                          {price > 0 ? (
                            <>
                              <b>{won(result.margin)}</b>
                              <i>{pct(result.marginRate)}</i>
                            </>
                          ) : (
                            "—"
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        <span>{breakEven !== null ? won(breakEven) : "—"}</span>
                        <span className="mgnSuggest">
                          {suggested !== null ? (
                            <>
                              <b>{won(suggested)}</b>
                              {onApplyPrice && (
                                <button className="linkBtn" onClick={() => onApplyPrice(channel.id, suggested)}>
                                  적용
                                </button>
                              )}
                            </>
                          ) : (
                            <i className="mgnImpossible">불가능</i>
                          )}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {mode === "target" && onApplyPrice && (
              <button className="secondary mgnApplyAll" onClick={applyAll} disabled={noCost}>
                모든 채널에 권장가 적용
              </button>
            )}

            {noCost && <p className="mgnHint">원가를 입력해야 마진이 계산됩니다.</p>}
            {mode === "check" && rows.some((r) => r.result.margin < 0) && price > 0 && (
              <p className="mgnLossWarn">빨간 줄은 팔수록 손해나는 채널입니다.</p>
            )}
          </div>

          <details className="mgnNotes">
            <summary>수수료 기본값 근거</summary>
            <ul>
              {CHANNELS.map((c) => (
                <li key={c.id}>
                  <b>{c.label}</b> {DEFAULT_FEES[c.id]?.note ?? "요율을 직접 확인해 주세요."}
                </li>
              ))}
              <li>
                <b>계산 방식</b> 판매가 − 수수료 − 수수료 부가세 − 고정비 = 정산액. 여기서 매출 부가세(과세 상품만)와 원가를 빼면 마진입니다.
              </li>
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
