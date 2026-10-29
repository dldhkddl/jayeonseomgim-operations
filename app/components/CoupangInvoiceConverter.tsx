"use client";

import { useMemo, useState } from "react";

import { NAVER_DELIVERY_COMPANIES } from "../lib/channels/deliveryCompanies";
import {
  parseCoupangOrderWorkbook,
  parseCoupangSupplierRows,
  writeCoupangDispatchWorkbook,
  writeCoupangSupplierInvoiceWorkbook,
  type CoupangDispatchSheet,
  type CoupangOrder,
} from "../lib/invoice/coupang-workbook";
import { decryptOfficeWorkbook } from "../lib/invoice/decrypt";
import { groupSupplierRowsByTracking, matchShipments } from "../lib/invoice/matcher";
import {
  dispatchableOrders,
  preDispatchItemState,
  reviewFingerprint,
  reviewPreDispatchOrders,
  summarizePreDispatchReview,
  type PreDispatchReviewItem,
  type ReviewDecision,
} from "../lib/invoice/pre-dispatch-review";
import type { ShipmentMatch } from "../lib/invoice/types";
import { coupangInvoiceWorkflowState } from "../lib/invoice/workflow";
import styles from "./InvoiceAutoConverter.module.css";

const CARRIER_ALIASES: Record<string, string> = {
  CJ: "CJ대한통운",
  CJ대한통운: "CJ대한통운",
  대한통운: "CJ대한통운",
  롯데: "롯데택배",
  롯데택배: "롯데택배",
  현대택배: "롯데택배",
  한진: "한진택배",
  한진택배: "한진택배",
  로젠: "로젠택배",
  로젠택배: "로젠택배",
  우체국: "우체국택배",
  우체국택배: "우체국택배",
};

function carrierLabel(value: string, fallback: string): string {
  const compact = value.replace(/\s/g, "");
  return CARRIER_ALIASES[compact]
    ?? NAVER_DELIVERY_COMPANIES.find((item) => item.label.replace(/\s/g, "") === compact)?.label
    ?? fallback;
}

function FileBox({ label, hint, file, onChange }: { label: string; hint: string; file: File | null; onChange: (file: File | null) => void }) {
  return (
    <label className={styles.fileBox}>
      <span className={styles.fileIcon}>XLS</span>
      <span><b>{label}</b><small>{file ? file.name : hint}</small></span>
      <input type="file" accept=".xls,.xlsx" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
      <em>{file ? "변경" : "선택"}</em>
    </label>
  );
}

function downloadBytes(bytes: ArrayBuffer | Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export default function CoupangInvoiceConverter() {
  const [orderFile, setOrderFile] = useState<File | null>(null);
  const [orderPassword, setOrderPassword] = useState("");
  const [supplierFile, setSupplierFile] = useState<File | null>(null);
  const [supplierPassword, setSupplierPassword] = useState("");
  const [defaultCarrier, setDefaultCarrier] = useState("로젠택배");
  const [orders, setOrders] = useState<CoupangOrder[]>([]);
  const [sourceSheet, setSourceSheet] = useState<CoupangDispatchSheet | null>(null);
  const [reviewItems, setReviewItems] = useState<PreDispatchReviewItem[]>([]);
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, ReviewDecision>>({});
  const [reviewSourceFingerprint, setReviewSourceFingerprint] = useState("");
  const [matches, setMatches] = useState<ShipmentMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reviewSummary = useMemo(
    () => summarizePreDispatchReview(reviewItems, reviewDecisions),
    [reviewItems, reviewDecisions],
  );
  const approvedOrderIds = useMemo(
    () => new Set(dispatchableOrders(reviewItems, reviewDecisions).map((order) => order.productOrderId)),
    [reviewItems, reviewDecisions],
  );
  const approvedOrders = useMemo(
    () => orders.filter((order) => approvedOrderIds.has(order.productOrderId)),
    [orders, approvedOrderIds],
  );
  const matchSummary = useMemo(() => ({
    ready: matches.filter((match) => match.status === "auto_matched" || match.status === "confirmed").length,
    pending: matches.filter((match) => match.status === "review_required").length,
    excluded: matches.filter((match) => match.status === "excluded").length,
  }), [matches]);
  const reviewComplete = reviewItems.length > 0
    && reviewFingerprint(orders) === reviewSourceFingerprint
    && reviewSummary.canExport;
  const workflow = coupangInvoiceWorkflowState({
    hasOrderFile: Boolean(orderFile),
    reviewComplete,
    hasSupplierFile: Boolean(supplierFile),
    readyMatches: matchSummary.ready,
    pendingMatches: matchSummary.pending,
  });

  function resetAfterOrderChange(file: File | null) {
    setOrderFile(file);
    setOrders([]);
    setSourceSheet(null);
    setReviewItems([]);
    setReviewDecisions({});
    setReviewSourceFingerprint("");
    setSupplierFile(null);
    setMatches([]);
    setError("");
    setNotice("");
  }

  async function startReview() {
    if (!orderFile) { setError("쿠팡 주문 엑셀을 선택해 주세요."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const bytes = await decryptOfficeWorkbook(await orderFile.arrayBuffer(), orderPassword, "쿠팡 주문 엑셀");
      const parsed = parseCoupangOrderWorkbook(bytes);
      if (!parsed.orders.length) throw new Error("쿠팡 주문 엑셀에서 처리할 주문을 찾지 못했습니다.");
      const nextReviewItems = reviewPreDispatchOrders(parsed.orders);
      setOrders(parsed.orders);
      setSourceSheet(parsed.sheet);
      setReviewItems(nextReviewItems);
      setReviewDecisions({});
      setReviewSourceFingerprint(reviewFingerprint(parsed.orders));
      setMatches([]);
      setNotice(`쿠팡 배송정보 ${parsed.orders.length}건을 검사했습니다.`);
    } catch (cause) {
      setOrders([]); setSourceSheet(null); setReviewItems([]); setReviewDecisions({}); setMatches([]);
      setError(cause instanceof Error ? cause.message : "쿠팡 주문 엑셀을 확인하는 중 오류가 발생했습니다.");
    } finally {
      setOrderPassword("");
      setBusy(false);
    }
  }

  async function downloadSupplierInvoice() {
    if (!workflow.canCreateSupplierInvoice) { setError("확인 필요 항목을 모두 처리한 뒤 공급처 엑셀을 만들어 주세요."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const bytes = await writeCoupangSupplierInvoiceWorkbook(approvedOrders);
      downloadBytes(bytes, `샘플상점${today().replaceAll("-", ".")}_쿠팡.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      setNotice(`쿠팡 주문 ${approvedOrders.length}건으로 공급처 기본양식을 만들었습니다. 숨은 주문키 열은 삭제하지 마세요.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "쿠팡 공급처 엑셀을 만드는 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function runMatching() {
    if (!sourceSheet || !orders.length || !reviewComplete) { setError("쿠팡 주문 배송정보 검수부터 완료해 주세요."); return; }
    if (!supplierFile) { setError("송장이 입력된 쿠팡 공급처 엑셀을 선택해 주세요."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const bytes = await decryptOfficeWorkbook(await supplierFile.arrayBuffer(), supplierPassword, "쿠팡 공급처 송장 엑셀");
      const supplierRows = parseCoupangSupplierRows(bytes);
      if (!supplierRows.length) throw new Error("쿠팡 공급처 엑셀에서 송장번호가 입력된 행을 찾지 못했습니다.");
      const nextMatches = matchShipments(approvedOrders, groupSupplierRowsByTracking(supplierRows));
      setMatches(nextMatches);
      const pending = nextMatches.filter((match) => match.status === "review_required").length;
      setNotice(pending ? `송장 대조가 끝났습니다. 확인 필요 ${pending}건을 처리해 주세요.` : `송장 ${nextMatches.length}건을 안전하게 대조했습니다.`);
    } catch (cause) {
      setMatches([]);
      setError(cause instanceof Error ? cause.message : "쿠팡 송장을 대조하는 중 오류가 발생했습니다.");
    } finally {
      setSupplierPassword("");
      setBusy(false);
    }
  }

  function chooseOrder(matchIndex: number, productOrderId: string) {
    const assigned = matches.some((match, index) => index !== matchIndex
      && (match.status === "auto_matched" || match.status === "confirmed")
      && match.orders.some((order) => order.productOrderId === productOrderId));
    if (assigned) { setError("선택한 쿠팡 주문은 이미 다른 송장에 연결되어 있습니다."); return; }
    setMatches((current) => current.map((match, index) => {
      if (index !== matchIndex) return match;
      const order = match.candidates.find((candidate) => candidate.productOrderId === productOrderId);
      return order ? { ...match, orders: [order], status: "confirmed", reason: "사용자가 원본 주문을 확인했습니다." } : match;
    }));
    setError("");
  }

  function excludeMatch(matchIndex: number) {
    setMatches((current) => current.map((match, index) => index === matchIndex
      ? { ...match, orders: [], status: "excluded", reason: "사용자가 이번 발송에서 제외했습니다." }
      : match));
  }

  function downloadCoupangDispatch() {
    if (!sourceSheet) { setError("쿠팡 주문 원본을 다시 선택해 주세요."); return; }
    if (!workflow.canCreateCoupangDispatch) { setError("확인 필요 송장을 모두 처리한 뒤 쿠팡 파일을 만들어 주세요."); return; }
    const filled = new Map<string, { carrier: string; trackingNumber: string }>();
    for (const match of matches) {
      if (match.status !== "auto_matched" && match.status !== "confirmed") continue;
      for (const order of match.orders) {
        if (filled.has(order.productOrderId)) { setError("하나의 쿠팡 주문이 여러 송장에 중복 연결되어 있습니다."); return; }
        filled.set(order.productOrderId, {
          carrier: carrierLabel(match.shipment.carrier, defaultCarrier),
          trackingNumber: match.shipment.trackingNumber,
        });
      }
    }
    try {
      downloadBytes(
        writeCoupangDispatchWorkbook(sourceSheet, filled),
        `쿠팡_발송처리_${today()}.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      setNotice(`쿠팡 원본 ${filled.size}개 행에 택배사와 운송장번호만 입력했습니다.`);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "쿠팡 발송처리 파일을 만드는 중 오류가 발생했습니다.");
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelTitle}><span>4</span><div><h2>쿠팡 송장 양방향 변환</h2><p>쿠팡 주문을 공급처 기본양식으로 보내고, 입력된 송장을 쿠팡 원본 양식으로 안전하게 되돌립니다.</p></div></div>

      <div className={styles.fileGrid}>
        <div>
          <FileBox label="쿠팡 주문 엑셀" hint="쿠팡 윙에서 내려받은 주문 파일" file={orderFile} onChange={resetAfterOrderChange} />
          <input className={styles.password} type="password" value={orderPassword} onChange={(event) => setOrderPassword(event.target.value)} placeholder="파일 암호가 있으면 입력" autoComplete="new-password" />
        </div>
        <div className={styles.controls}>
          <button className={styles.primary} onClick={() => void startReview()} disabled={!workflow.canReview || busy}>{busy ? "확인 중…" : reviewItems.length ? "쿠팡 배송정보 다시 검수" : "쿠팡 배송정보 검수"}</button>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.reviewComplete} role="status">{notice}</div>}

      {reviewItems.length > 0 && <>
        <div className={styles.reviewStats}>
          <div><b>{reviewSummary.ready}</b><span>바로 사용</span></div>
          <div data-state="warning"><b>{reviewSummary.warning}</b><span>확인 필요</span></div>
          <div data-state="blocking"><b>{reviewSummary.blocking}</b><span>차단</span></div>
          <div data-state="excluded"><b>{reviewSummary.excluded}</b><span>제외</span></div>
        </div>
        <div className={styles.reviewList}>
          {reviewItems.filter((item) => item.issues.length > 0 || reviewDecisions[item.key] === "excluded").map((item) => {
            const state = preDispatchItemState(item, reviewDecisions[item.key]);
            const hasBlocking = item.issues.some((issue) => issue.severity === "blocking");
            return <article className={`${styles.reviewItem} ${styles[state]}`} key={item.key}>
              <div className={styles.reviewHead}><span>{state === "warning" ? "확인 필요" : state === "blocking" ? "차단" : state === "excluded" ? "제외" : "확인 완료"}</span><b>{item.order.recipientName || "수취인 없음"}</b><small>{item.order.sellerId} · {item.order.buyerId}</small></div>
              <div className={styles.reviewBody}>
                <p><b>{item.order.productName || "상품명 없음"}</b><span>수량 {item.order.quantity}</span></p>
                <p><span>{item.order.phone1 || "전화번호 없음"}</span><span>{item.order.address || "주소 없음"}</span></p>
                <ul className={styles.issueList}>{item.issues.map((issue) => <li data-severity={issue.severity} key={issue.code}>{issue.message}</li>)}</ul>
              </div>
              <div className={styles.reviewActions}>
                {!hasBlocking && state !== "ready" && <button className={styles.primary} onClick={() => setReviewDecisions((current) => ({ ...current, [item.key]: "confirmed" }))}>정보 확인 완료</button>}
                {state !== "excluded" && <button onClick={() => setReviewDecisions((current) => ({ ...current, [item.key]: "excluded" }))}>이번 발송에서 제외</button>}
              </div>
            </article>;
          })}
        </div>
        <div className={styles.reviewExportBar}>
          <div><b>쿠팡 → 공급처 기본양식</b><span>쿠팡 주문키 열은 송장 재대조에 사용되므로 삭제하면 안 됩니다.</span></div>
          <button className={styles.primary} onClick={() => void downloadSupplierInvoice()} disabled={!workflow.canCreateSupplierInvoice || busy}>쿠팡 공급처 엑셀 만들기</button>
        </div>
      </>}

      {reviewComplete && <div className={styles.fileGrid}>
        <div>
          <FileBox label="송장 입력된 쿠팡 공급처 엑셀" hint="위에서 만든 기본양식에 송장번호가 입력된 파일" file={supplierFile} onChange={(file) => { setSupplierFile(file); setMatches([]); setError(""); setNotice(""); }} />
          <input className={styles.password} type="password" value={supplierPassword} onChange={(event) => setSupplierPassword(event.target.value)} placeholder="파일 암호가 있으면 입력" autoComplete="new-password" />
        </div>
        <div className={styles.controls}>
          <label>택배사가 비어 있을 때<select value={defaultCarrier} onChange={(event) => setDefaultCarrier(event.target.value)}>{NAVER_DELIVERY_COMPANIES.map((carrier) => <option key={carrier.code} value={carrier.label}>{carrier.label}</option>)}</select></label>
          <button className={styles.primary} onClick={() => void runMatching()} disabled={!workflow.canMatch || busy}>{busy ? "대조 중…" : "쿠팡 송장 자동 대조"}</button>
        </div>
      </div>}

      {matches.length > 0 && <>
        <div className={styles.stats}>
          <div><b>{matchSummary.ready}</b><span>발송 준비</span></div>
          <div><b>{matchSummary.pending}</b><span>확인 필요</span></div>
          <div><b>{matchSummary.excluded}</b><span>제외</span></div>
        </div>
        <div className={styles.resultList}>
          {matches.map((match, index) => <article className={`${styles.result} ${styles[match.status]}`} key={`${match.shipment.trackingNumber}-${index}`}>
            <div className={styles.resultHead}><span>{match.status === "review_required" ? "확인 필요" : match.status === "excluded" ? "제외" : "발송 준비"}</span><b>{match.shipment.trackingNumber}</b><small>{carrierLabel(match.shipment.carrier, defaultCarrier)}</small></div>
            <div className={styles.resultBody}>
              <div><b>{match.shipment.recipientName || "수취인 없음"}</b><small>{match.shipment.address || "주소 없음"}</small><p>{match.shipment.items.map((item) => `${item.productName} × ${item.quantity}`).join(" · ")}</p></div>
              {(match.status === "auto_matched" || match.status === "confirmed") && <div className={styles.matchedOrders}>{match.orders.map((order) => <span key={order.productOrderId}>{order.productName}<small>{order.sellerId} · {order.buyerId}</small></span>)}</div>}
              {match.status === "review_required" && <div className={styles.reviewControls}>
                <select defaultValue="" onChange={(event) => chooseOrder(index, event.target.value)}><option value="" disabled>일치 후보 선택</option>{match.candidates.map((order) => <option key={order.productOrderId} value={order.productOrderId}>{order.recipientName} · {order.productName} · {order.sellerId}</option>)}</select>
                <button onClick={() => excludeMatch(index)}>이번 발송에서 제외</button>
              </div>}
            </div>
            <p className={styles.reason}>{match.reason}</p>
          </article>)}
        </div>
        <div className={styles.downloadBar}>
          <div><b>공급처 기본양식 → 쿠팡 발송처리</b><span>원본 쿠팡 행에서 택배사와 운송장번호만 입력합니다.</span></div>
          <button className={styles.primary} onClick={downloadCoupangDispatch} disabled={!workflow.canCreateCoupangDispatch}>쿠팡 발송처리 파일 다운로드</button>
        </div>
      </>}
    </section>
  );
}
