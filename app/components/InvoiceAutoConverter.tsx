"use client";

import { useMemo, useState } from "react";
import BackToDashboardLink from "./BackToDashboardLink";
import CoupangInvoiceConverter from "./CoupangInvoiceConverter";

import { NAVER_DELIVERY_COMPANIES } from "../lib/channels/deliveryCompanies";
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
import type { DispatchRow, NaverOrder, ShipmentMatch } from "../lib/invoice/types";
import { invoiceWorkflowState } from "../lib/invoice/workflow";
import { parseNaverOrders, parseSupplierRows, supplierInvoiceFilename, writeDispatchWorkbook, writeSupplierInvoiceWorkbook } from "../lib/invoice/workbook";
import styles from "./InvoiceAutoConverter.module.css";
import statusStyles from "./InvoiceAutoConverterStatus.module.css";

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
  return CARRIER_ALIASES[compact] ?? NAVER_DELIVERY_COMPANIES.find((item) => item.label.replace(/\s/g, "") === compact)?.label ?? fallback;
}

function carrierCode(value: string, fallback: string): string {
  const label = carrierLabel(value, fallback);
  return NAVER_DELIVERY_COMPANIES.find((item) => item.label === label)?.code ?? "";
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

export default function InvoiceAutoConverter() {
  const [naverFile, setNaverFile] = useState<File | null>(null);
  const [supplierFile, setSupplierFile] = useState<File | null>(null);
  const [naverPassword, setNaverPassword] = useState("");
  const [supplierPassword, setSupplierPassword] = useState("");
  const [defaultCarrier, setDefaultCarrier] = useState("CJ대한통운");
  const [orders, setOrders] = useState<NaverOrder[]>([]);
  const [matches, setMatches] = useState<ShipmentMatch[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [supplierExportBusy, setSupplierExportBusy] = useState(false);
  const [storedOrdersLoaded, setStoredOrdersLoaded] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [notice, setNotice] = useState("");
  const [reviewItems, setReviewItems] = useState<PreDispatchReviewItem[]>([]);
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, ReviewDecision>>({});
  const [reviewSourceFingerprint, setReviewSourceFingerprint] = useState("");
  const workflow = invoiceWorkflowState(Boolean(naverFile) || storedOrdersLoaded, Boolean(supplierFile));

  const preDispatchSummary = useMemo(
    () => summarizePreDispatchReview(reviewItems, reviewDecisions),
    [reviewItems, reviewDecisions],
  );
  const approvedOrders = useMemo(
    () => dispatchableOrders(reviewItems, reviewDecisions),
    [reviewItems, reviewDecisions],
  );
  const normalReviewItems = useMemo(
    () => reviewItems.filter((item) => item.issues.length === 0),
    [reviewItems],
  );
  const attentionReviewItems = useMemo(
    () => reviewItems.filter((item) => item.issues.length > 0 || reviewDecisions[item.key] === "excluded"),
    [reviewItems, reviewDecisions],
  );

  const summary = useMemo(() => ({
    ready: matches.filter((match) => match.status === "auto_matched" || match.status === "confirmed").length,
    review: matches.filter((match) => match.status === "review_required").length,
    excluded: matches.filter((match) => match.status === "excluded").length,
  }), [matches]);

  function resetPreDispatchReview() {
    setReviewItems([]);
    setReviewDecisions({});
    setReviewSourceFingerprint("");
  }

  function beginPreDispatchReview(nextOrders: NaverOrder[]) {
    setOrders(nextOrders);
    setReviewItems(reviewPreDispatchOrders(nextOrders));
    setReviewDecisions({});
    setReviewSourceFingerprint(reviewFingerprint(nextOrders));
    setMatches([]);
  }

  async function startPreDispatchReview() {
    if (!naverFile && !storedOrdersLoaded) {
      setError("저장 주문을 불러오거나 네이버 주문 엑셀을 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const nextOrders = naverFile
        ? parseNaverOrders(await decryptOfficeWorkbook(await naverFile.arrayBuffer(), naverPassword, "네이버 주문 엑셀"))
        : orders;
      if (!nextOrders.length) throw new Error("네이버 엑셀에서 처리할 주문을 찾지 못했습니다.");
      beginPreDispatchReview(nextOrders);
      setNotice(`배송정보 ${nextOrders.length}건을 검사했습니다. 확인 필요 항목만 처리해 주세요.`);
    } catch (cause) {
      resetPreDispatchReview();
      setError(cause instanceof Error ? cause.message : "배송정보 검수 중 오류가 발생했습니다.");
    } finally {
      setNaverPassword("");
      setBusy(false);
    }
  }

  function decideReviewItem(key: string, decision: ReviewDecision) {
    setReviewDecisions((current) => ({ ...current, [key]: decision }));
  }

  async function runMatching() {
    if (!naverFile && !storedOrdersLoaded) {
      setError("저장 주문을 불러오거나 네이버 주문 엑셀을 선택해 주세요.");
      return;
    }
    if (!supplierFile) {
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const supplierBytes = await decryptOfficeWorkbook(await supplierFile.arrayBuffer(), supplierPassword, "공급처 송장 엑셀");
      const nextOrders = reviewItems.length
        ? approvedOrders
        : naverFile
          ? parseNaverOrders(await decryptOfficeWorkbook(await naverFile.arrayBuffer(), naverPassword, "네이버 주문 엑셀"))
          : orders;
      const supplierRows = parseSupplierRows(supplierBytes);
      if (!nextOrders.length) throw new Error("네이버 엑셀에서 처리할 주문을 찾지 못했습니다.");
      if (!supplierRows.length) throw new Error("공급처 엑셀에서 송장번호가 있는 행을 찾지 못했습니다.");
      if (!reviewItems.length) setOrders(nextOrders);
      setMatches(matchShipments(nextOrders, groupSupplierRowsByTracking(supplierRows)));
    } catch (cause) {
      setMatches([]);
      setError(cause instanceof Error ? cause.message : "엑셀 처리 중 오류가 발생했습니다.");
    } finally {
      setNaverPassword("");
      setSupplierPassword("");
      setBusy(false);
    }
  }

  async function downloadSupplierInvoice() {
    if (!reviewItems.length) {
      setError("먼저 배송정보 검수를 시작해 주세요.");
      return;
    }
    if (reviewFingerprint(orders) !== reviewSourceFingerprint) {
      resetPreDispatchReview();
      setError("검수 후 주문 정보가 변경되었습니다. 배송정보를 다시 검수해 주세요.");
      return;
    }
    if (!preDispatchSummary.canExport) {
      setError("확인 필요와 차단 항목을 모두 처리한 뒤 공급처 엑셀을 만들어 주세요.");
      return;
    }
    setSupplierExportBusy(true);
    setError("");
    try {
      if (!approvedOrders.length) throw new Error("공급처에 전달할 주문이 없습니다.");
      const bytes = await writeSupplierInvoiceWorkbook(approvedOrders);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = supplierInvoiceFilename(new Date());
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`검수 완료된 주문 ${approvedOrders.length}건으로 공급처 엑셀을 만들었습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "공급처 송장 엑셀을 만드는 중 오류가 발생했습니다.");
    } finally {
      setNaverPassword("");
      setSupplierExportBusy(false);
    }
  }

  async function loadStoredOrders() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/orders/naver/fulfillment", { cache: "no-store" });
      const data = await response.json() as { items?: NaverOrder[]; error?: string };
      if (!response.ok) throw new Error(data.error || "저장 주문을 불러오지 못했습니다.");
      const nextOrders = data.items ?? [];
      if (!nextOrders.length) throw new Error("저장된 네이버 주문이 없습니다. 주문 수집을 먼저 실행해 주세요.");
      beginPreDispatchReview(nextOrders); setStoredOrdersLoaded(true); setNaverFile(null);
      setNotice(`저장된 네이버 주문 ${nextOrders.length}건을 불러와 배송정보를 검사했습니다.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장 주문 조회 오류"); }
    finally { setBusy(false); }
  }

  function chooseOrder(index: number, productOrderId: string) {
    const alreadyAssigned = matches.some((match, matchIndex) => matchIndex !== index
      && (match.status === "auto_matched" || match.status === "confirmed")
      && match.orders.some((order) => order.productOrderId === productOrderId));
    if (alreadyAssigned) {
      setError("선택한 주문은 이미 다른 송장에 연결되어 있습니다.");
      return;
    }
    setError("");
    setMatches((current) => current.map((match, matchIndex) => {
      if (matchIndex !== index) return match;
      const order = orders.find((item) => item.productOrderId === productOrderId);
      return order ? { ...match, orders: [order], status: "confirmed", reason: "사용자가 주문을 확인했습니다." } : match;
    }));
  }

  function exclude(index: number) {
    setMatches((current) => current.map((match, matchIndex) => matchIndex === index
      ? { ...match, orders: [], status: "excluded", reason: "사용자가 발송처리에서 제외했습니다." }
      : match));
  }

  function confirmedRows(): DispatchRow[] {
    return matches.flatMap((match) => {
      if (match.status !== "auto_matched" && match.status !== "confirmed") return [];
      return match.orders.map((order) => ({
        productOrderId: order.productOrderId,
        deliveryMethod: "택배,등기,소포",
        carrier: carrierLabel(match.shipment.carrier, defaultCarrier),
        trackingNumber: match.shipment.trackingNumber,
      }));
    });
  }

  function download() {
    const rows = confirmedRows();
    if (!rows.length) {
      setError("내려받을 확정 주문이 없습니다. 확인 필요 항목을 먼저 처리해 주세요.");
      return;
    }
    if (new Set(rows.map((row) => row.productOrderId)).size !== rows.length) {
      setError("한 주문이 여러 송장에 중복 연결되어 있습니다. 확인 필요 항목을 다시 선택해 주세요.");
      return;
    }
    const blob = new Blob([writeDispatchWorkbook(rows)], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `네이버_발송처리_${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function sendToNaver() {
    const rows = confirmedRows();
    if (!rows.length) { setError("전송할 확정 주문이 없습니다."); return; }
    if (new Set(rows.map((row) => row.productOrderId)).size !== rows.length) { setError("같은 주문이 여러 송장에 중복 연결되어 있습니다."); return; }
    if (!window.confirm(`확정된 송장 ${rows.length}건을 네이버에 실제 발송 처리할까요? 처리 후에는 주문 상태가 변경됩니다.`)) return;
    setDispatching(true); setError(""); setNotice("");
    try {
      const payload = rows.map((row) => ({ productOrderId: row.productOrderId, deliveryMethod: "DELIVERY" as const, deliveryCompanyCode: carrierCode(row.carrier, defaultCarrier), trackingNumber: row.trackingNumber }));
      if (payload.some((row) => !row.deliveryCompanyCode)) throw new Error("네이버 택배사 코드로 변환할 수 없는 항목이 있습니다.");
      const response = await fetch("/api/orders/naver/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: payload }) });
      const data = await response.json() as { successIds?: string[]; failures?: Array<{ message?: string }>; error?: string };
      if (!response.ok) throw new Error(data.error || "네이버 송장 전송에 실패했습니다.");
      const failed = data.failures?.length ?? 0;
      setNotice(`네이버 송장 전송 완료 · 성공 ${data.successIds?.length ?? 0}건${failed ? ` · 실패 ${failed}건` : ""}`);
      if (!failed) setMatches([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "네이버 송장 전송 오류"); }
    finally { setDispatching(false); }
  }

  return (
    <main className={styles.page}>
      <nav className={styles.nav}><BackToDashboardLink /><span>담다 AI</span></nav>
      <header className={styles.hero}>
        <p>INVOICE AUTOMATION</p>
        <h1>공급처 송장을<br/><em>네이버 양식으로 한 번에</em></h1>
        <span>주문과 송장을 자동 대조하고, 확인이 필요한 건만 골라 보여드립니다.</span>
      </header>

      <section className={styles.panel}>
        <div className={styles.panelTitle}><span>1</span><div><h2>엑셀 파일 선택</h2><p>파일과 비밀번호는 이 브라우저 안에서만 처리됩니다.</p></div></div>
        <div className={styles.fileGrid}>
          <div><button className={styles.primary} type="button" onClick={() => void loadStoredOrders()} disabled={busy}>{storedOrdersLoaded ? `저장 주문 ${orders.length}건 불러옴` : "수집된 네이버 주문 불러오기"}</button><FileBox label="네이버 주문 엑셀" hint="기존 엑셀 방식도 계속 사용 가능" file={naverFile} onChange={(file) => { setNaverFile(file); setStoredOrdersLoaded(false); setOrders([]); resetPreDispatchReview(); setMatches([]); setError(""); setNotice(""); }}/><input className={styles.password} type="password" value={naverPassword} onChange={(event) => setNaverPassword(event.target.value)} placeholder="파일 암호가 있으면 입력" autoComplete="new-password" /><button className={styles.primary} onClick={() => void startPreDispatchReview()} disabled={!workflow.canCreateSupplierInvoice || busy || supplierExportBusy}>{busy ? "배송정보 확인 중…" : reviewItems.length ? "배송정보 다시 검수" : "배송정보 검수 시작"}</button></div>
          <div><FileBox label="공급처 송장 엑셀" hint="택배사·송장번호가 포함된 파일" file={supplierFile} onChange={setSupplierFile}/><input className={styles.password} type="password" value={supplierPassword} onChange={(event) => setSupplierPassword(event.target.value)} placeholder="파일 암호가 있으면 입력" autoComplete="new-password" /><p className={statusStyles.fileStatus} data-ready={workflow.canMatch}>{workflow.supplierStatus}</p></div>
        </div>
        <div className={styles.controls}>
          <label>택배사가 비어 있을 때<select value={defaultCarrier} onChange={(event) => setDefaultCarrier(event.target.value)}>{NAVER_DELIVERY_COMPANIES.map((carrier) => <option key={carrier.code} value={carrier.label}>{carrier.label}</option>)}</select></label>
          <button className={styles.primary} onClick={runMatching} disabled={!workflow.canMatch || busy || supplierExportBusy}>{busy ? "파일 확인 중…" : "자동 대조 시작"}</button>
        </div>
        {error && <div className={styles.error} role="alert">{error}</div>}
        {notice && <div className={styles.error} role="status">{notice}</div>}
      </section>

      {reviewItems.length > 0 && <section className={styles.panel}>
        <div className={styles.panelTitle}><span>2</span><div><h2>공급처 전달 전 배송정보 검수</h2><p>정상 주문은 접어두고, 확인하거나 제외해야 할 주문만 먼저 보여드립니다.</p></div></div>
        <div className={styles.reviewStats}>
          <div data-state="ready"><b>{preDispatchSummary.ready}</b><span>전달 가능</span></div>
          <div data-state="warning"><b>{preDispatchSummary.warning}</b><span>확인 필요</span></div>
          <div data-state="blocking"><b>{preDispatchSummary.blocking}</b><span>전달 차단</span></div>
          <div data-state="excluded"><b>{preDispatchSummary.excluded}</b><span>제외</span></div>
        </div>

        {normalReviewItems.length > 0 && <details className={styles.normalOrders}>
          <summary>정상 주문 {normalReviewItems.length}건 보기</summary>
          <div>{normalReviewItems.map((item) => <p key={item.key}><b>{item.order.recipientName}</b><span>{item.order.productName} × {item.order.quantity}</span><small>{item.order.address}</small></p>)}</div>
        </details>}

        {attentionReviewItems.length > 0
          ? <div className={styles.reviewList}>{attentionReviewItems.map((item) => {
            const state = preDispatchItemState(item, reviewDecisions[item.key]);
            const stateLabel = state === "blocking" ? "전달 차단" : state === "warning" ? "확인 필요" : state === "excluded" ? "제외됨" : "확인 완료";
            return <article className={`${styles.reviewItem} ${styles[state]}`} key={item.key}>
              <div className={styles.reviewHead}><span>{stateLabel}</span><b>{item.order.recipientName || "수취인명 없음"}</b><small>{item.order.productOrderId || "상품주문번호 없음"}</small></div>
              <div className={styles.reviewBody}>
                <p><b>{item.order.phone1 || item.order.phone2 || "전화번호 없음"}</b><span>{item.order.address || "주소 없음"}</span></p>
                <p><b>{item.order.productName || "상품명 없음"}</b><span>수량 {item.order.quantity}</span></p>
                {item.order.deliveryMessage && <p className={styles.deliveryMessage}>배송메시지 · {item.order.deliveryMessage}</p>}
                <ul className={styles.issueList}>{item.issues.map((issue) => <li key={issue.code} data-severity={issue.severity}>{issue.message}</li>)}</ul>
              </div>
              <div className={styles.reviewActions}>
                {state === "warning" && <button className={styles.primary} type="button" onClick={() => decideReviewItem(item.key, "confirmed")}>내용 확인 완료</button>}
                {state === "ready" && item.issues.length > 0 && <button type="button" onClick={() => decideReviewItem(item.key, "pending")}>확인 취소</button>}
                {state !== "excluded" && <button type="button" onClick={() => decideReviewItem(item.key, "excluded")}>이번 전달에서 제외</button>}
                {state === "excluded" && <button type="button" onClick={() => decideReviewItem(item.key, "pending")}>제외 되돌리기</button>}
              </div>
            </article>;
          })}</div>
          : <div className={styles.reviewComplete}>모든 주문의 배송정보가 정상입니다.</div>}

        <div className={styles.reviewExportBar}>
          <div><b>{preDispatchSummary.canExport ? `공급처 전달 가능 ${approvedOrders.length}건` : "아직 공급처에 전달할 수 없습니다."}</b><span>{preDispatchSummary.blocking > 0 ? "차단 항목은 수정할 수 없으면 이번 전달에서 제외해 주세요." : preDispatchSummary.warning > 0 ? "확인 필요 항목의 이름·전화번호·주소를 확인해 주세요." : `제외 ${preDispatchSummary.excluded}건을 빼고 엑셀을 만듭니다.`}</span></div>
          <button className={styles.primary} type="button" onClick={() => void downloadSupplierInvoice()} disabled={!preDispatchSummary.canExport || supplierExportBusy || busy}>{supplierExportBusy ? "공급처 엑셀 만드는 중…" : "검수 완료 · 공급처 엑셀 만들기"}</button>
        </div>
      </section>}

      {matches.length > 0 && <section className={styles.panel}>
        <div className={styles.panelTitle}><span>3</span><div><h2>송장 대조 결과</h2><p>초록색은 바로 내려받을 수 있고, 주황색만 확인하면 됩니다.</p></div></div>
        <div className={styles.stats}>
          <div><b>{summary.ready}</b><span>발송 준비</span></div><div><b>{summary.review}</b><span>확인 필요</span></div><div><b>{summary.excluded}</b><span>제외</span></div>
        </div>
        <div className={styles.resultList}>
          {matches.map((match, index) => <article className={`${styles.result} ${styles[match.status]}`} key={`${match.shipment.trackingNumber}-${index}`}>
            <div className={styles.resultHead}><span>{match.status === "auto_matched" || match.status === "confirmed" ? "발송 준비" : match.status === "excluded" ? "제외됨" : "확인 필요"}</span><b>{match.shipment.trackingNumber}</b><small>{carrierLabel(match.shipment.carrier, defaultCarrier)}</small></div>
            <div className={styles.resultBody}>
              <div><b>{match.shipment.recipientName || "수취인 정보 없음"}</b><small>{match.shipment.address || "주소 정보 없음"}</small><p>{match.shipment.items.map((item) => `${item.productName} × ${item.quantity}`).join(" · ")}</p></div>
              {(match.status === "auto_matched" || match.status === "confirmed") && <div className={styles.matchedOrders}>{match.orders.map((order) => <span key={order.productOrderId}>{order.productName}<small>{order.productOrderId}</small></span>)}</div>}
              {match.status === "review_required" && <div className={styles.reviewControls}><select defaultValue="" onChange={(event) => chooseOrder(index, event.target.value)}><option value="" disabled>연결할 주문 선택</option>{orders.map((order) => <option key={order.productOrderId} value={order.productOrderId}>{order.recipientName} · {order.productName} · {order.productOrderId}</option>)}</select><button onClick={() => exclude(index)}>이번 발송에서 제외</button></div>}
            </div>
            <p className={styles.reason}>{match.reason}</p>
          </article>)}
        </div>
        <div className={styles.downloadBar}><div><b>{summary.ready}개 송장 확정</b><span>엑셀로 내려받거나 네이버 API로 실제 발송 처리할 수 있습니다.</span></div><button className={styles.primary} onClick={download}>네이버 발송처리 양식 다운로드</button><button className={styles.primary} onClick={() => void sendToNaver()} disabled={dispatching}>{dispatching ? "네이버 전송 중…" : "네이버로 송장 전송"}</button></div>
      </section>}

      <CoupangInvoiceConverter />

      <footer className={styles.footer}>원본 파일은 서버에 저장하거나 전송하지 않습니다.</footer>
    </main>
  );
}
