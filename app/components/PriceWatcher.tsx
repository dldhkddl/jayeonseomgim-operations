"use client";

import { ChangeEvent, useMemo, useState } from "react";
import BackToDashboardLink from "./BackToDashboardLink";
import {
  ABNORMAL_CHANGE_THRESHOLD,
  isAbnormalChange,
  parsePriceSheet,
  suggestedSellingPrice,
  type PriceRow,
} from "../lib/price-watcher";
import styles from "./PriceWatcher.module.css";

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

export default function PriceWatcher() {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [targetMargin, setTargetMargin] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const buffer = await file.arrayBuffer();
      const result = parsePriceSheet(buffer);
      if (!result.rows.length) throw new Error("읽을 수 있는 품목이 없습니다. 열 이름을 확인해 주세요.");
      setFileName(file.name);
      setRows(result.rows);
      const abnormalCount = result.rows.filter((row) => isAbnormalChange(row.changeRate)).length;
      setMessage(
        `${file.name}에서 품목 ${result.rows.length}개를 읽었습니다.`
        + (result.skipped ? ` (${result.skipped}행은 값이 없어 건너뜀)` : "")
        + (abnormalCount ? ` 변동폭이 큰 품목 ${abnormalCount}개는 표에서 강조 표시했습니다.` : ""),
      );
    } catch (reason) {
      setFileName("");
      setRows([]);
      setError(reason instanceof Error ? reason.message : "엑셀을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => Math.abs(b.changeRate) - Math.abs(a.changeRate)),
    [rows],
  );

  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <BackToDashboardLink />
        <span>담다 AI</span>
      </nav>

      <header className={styles.hero}>
        <p>PRICE WATCHER</p>
        <h1>매주 받는 매입단가 엑셀을<br/><em>한눈에 비교합니다.</em></h1>
        <span>
          품목명·전주단가·이번주단가 열이 있는 엑셀을 올리면 변동률과 목표 마진율 기준 참고 판매가를 계산해 보여줍니다.
          이 화면은 참고용이며, 실제 스마트스토어·쿠팡 등록가는 자동으로 바뀌지 않습니다. 반영은 직접 각 채널 관리자에서 해 주세요.
        </span>
      </header>

      <section className={styles.panel}>
        <div className={styles.panelTitle}>
          <span>1</span>
          <div><h2>매입단가 엑셀</h2><p>메일로 받은 주간 단가표를 그대로 올리세요.</p></div>
        </div>
        <label className={styles.sourceBox}>
          <span className={styles.fileIcon}>XLS</span>
          <span>
            <b>{fileName || "매입단가 엑셀 선택"}</b>
            <small>{rows.length ? `품목 ${rows.length}개` : "품목명 · 전주단가 · 이번주단가 열 필요"}</small>
          </span>
          <em>{busy ? "읽는 중…" : fileName ? "변경" : "선택"}</em>
          <input aria-label="매입단가 엑셀 선택" type="file" accept=".xlsx,.xlsm,.xls" onChange={readFile} disabled={busy} />
        </label>
      </section>

      {rows.length > 0 && (
        <section className={styles.panel}>
          <div className={styles.panelTitle}>
            <span>2</span>
            <div>
              <h2>목표 마진율</h2>
              <p>이번주 매입단가를 원가로 놓고 목표 마진율을 만족하는 참고 판매가를 계산합니다.</p>
            </div>
          </div>
          <label className={styles.marginInput}>
            목표 마진율
            <input
              type="number"
              min={0}
              max={99}
              step={1}
              value={targetMargin}
              onChange={(event) => setTargetMargin(Number(event.target.value))}
            />
            %
          </label>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>품목명</th>
                  <th>전주단가</th>
                  <th>이번주단가</th>
                  <th>변동률</th>
                  <th>참고 판매가 ({targetMargin}% 마진)</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => {
                  const abnormal = isAbnormalChange(row.changeRate);
                  const suggested = suggestedSellingPrice(row.currentPrice, targetMargin);
                  return (
                    <tr key={`${row.name}-${index}`} className={abnormal ? styles.abnormalRow : undefined}>
                      <td>{row.name}</td>
                      <td>{won(row.prevPrice)}</td>
                      <td>{won(row.currentPrice)}</td>
                      <td className={row.changeRate > 0 ? styles.up : row.changeRate < 0 ? styles.down : undefined}>
                        {pct(row.changeRate)}
                        {abnormal && <span className={styles.badge}>변동폭 큼</span>}
                      </td>
                      <td>{suggested !== null ? won(suggested) : "계산 불가"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={styles.tableFootnote}>
            변동폭 큼 = 전주 대비 {(ABNORMAL_CHANGE_THRESHOLD * 100).toFixed(0)}% 이상 변동. 자동으로 보류하거나 반영하지 않고 표시만 합니다.
          </p>
        </section>
      )}

      {message && <p className={styles.success} role="status">{message}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.footer}>파일은 서버에 저장하거나 전송하지 않고 이 브라우저 안에서만 처리됩니다.</p>
    </main>
  );
}
