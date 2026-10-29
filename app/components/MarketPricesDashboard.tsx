"use client";

import { useMemo, useState } from "react";
import MarketPriceLineChart from "./MarketPriceLineChart.tsx";
import BackToDashboardLink from "./BackToDashboardLink";
import { buildMarketPriceTrend, filterMarketPrices, filterMarketPricesByQuery, formatMarketPackageUnit, marketGradeOptions, marketPackageOptions, summarizeMarketPrices } from "../lib/market-prices/summary.ts";
import type { GarakMarketPrice } from "../lib/market-prices/types.ts";

type Price = GarakMarketPrice;

const won = new Intl.NumberFormat("ko-KR");
const dateLabel = (value: string) => value.length === 8 ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;

export default function MarketPricesDashboard() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Price[]>([]);
  const [selected, setSelected] = useState<Price | null>(null);
  const [selectedUnit, setSelectedUnit] = useState("all");
  const [selectedGrade, setSelectedGrade] = useState("all");
  const [loadedHistory, setLoadedHistory] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [notice, setNotice] = useState("최근 가격을 불러오세요.");

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setAuthError("");
    const response = await fetch("/api/market-prices/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      setAuthError("비밀번호가 올바르지 않습니다.");
      return;
    }
    setAuthed(true);
    await search();
  }

  async function fetchStoredRows(query: string) {
    const response = await fetch(`/api/market-prices/search?q=${encodeURIComponent(query)}&from=${daysAgo(30)}&to=${today()}`);
    if (!response.ok) throw new Error("가격 데이터를 불러오지 못했습니다.");
    return response.json() as Promise<{ rows?: Price[]; refreshedAt?: string }>;
  }

  async function search() {
    const query = q.trim();
    if (!query) {
      setRows([]);
      setSelected(null);
      setSelectedUnit("all");
      setSelectedGrade("all");
      setLoadedHistory(new Set());
      setNotice("검색할 과일명을 입력해 주세요.");
      return;
    }
    setLoading(true);
    setNotice("공식 가격 데이터를 확인하는 중입니다…");
    try {
      const refresh = await fetch(`/api/market-prices/ingest?item=${encodeURIComponent(query)}`, { method: "POST" });
      if (!refresh.ok) {
        const failure = await refresh.json().catch(() => ({})) as { error?: string };
        throw new Error(failure.error ?? "가락시장 가격을 갱신하지 못했습니다.");
      }
      const data = await fetchStoredRows(query);
      const nextRows = data.rows ?? [];
      setRows(nextRows);
      setSelected(nextRows[0] ?? null);
      setSelectedUnit("all");
      setSelectedGrade("all");
      setLoadedHistory(new Set());
      setNotice(data.refreshedAt ? `마지막 조회 ${new Date(data.refreshedAt).toLocaleString("ko-KR")}` : "조회 완료");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "조회에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function selectForChart(row: Price) {
    setSelected(row);
    if (loadedHistory.has(row.itemName)) return;
    setHistoryLoading(true);
    setNotice(`${row.itemName} 최근 30일 실제 가격을 수집하는 중입니다…`);
    try {
      const response = await fetch(`/api/market-prices/ingest?item=${encodeURIComponent(row.itemName)}&days=30`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string; failedDates?: string[] };
      if (!response.ok) throw new Error(result.error ?? "과거 가격을 불러오지 못했습니다.");
      const data = await fetchStoredRows(q.trim());
      const nextRows = data.rows ?? [];
      setRows(nextRows);
      setSelected(nextRows.find((candidate) => candidate.itemCode === row.itemCode && candidate.grade === row.grade && candidate.unitQuantity === row.unitQuantity) ?? row);
      setLoadedHistory((current) => new Set(current).add(row.itemName));
      const missing = result.failedDates?.length ?? 0;
      setNotice(missing > 0 ? `30일 실제 가격을 불러왔습니다. 거래 정보가 없는 ${missing}일은 값을 만들지 않고 실제 거래일끼리 연결합니다.` : "최근 30일 실제 가격을 불러왔습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "과거 가격 조회에 실패했습니다.");
    } finally {
      setHistoryLoading(false);
    }
  }

  const queryRows = useMemo(() => filterMarketPricesByQuery(rows, q), [rows, q]);
  const rowsForUnitOptions = useMemo(() => filterMarketPrices(queryRows, { unit: "all", grade: selectedGrade }), [queryRows, selectedGrade]);
  const rowsForGradeOptions = useMemo(() => filterMarketPrices(queryRows, { unit: selectedUnit, grade: "all" }), [queryRows, selectedUnit]);
  const unitOptions = useMemo(() => marketPackageOptions(rowsForUnitOptions), [rowsForUnitOptions]);
  const gradeOptions = useMemo(() => marketGradeOptions(rowsForGradeOptions), [rowsForGradeOptions]);
  const visibleRows = useMemo(() => filterMarketPrices(queryRows, { unit: selectedUnit, grade: selectedGrade }), [queryRows, selectedGrade, selectedUnit]);
  const latest = useMemo(() => {
    const seen = new Set<string>();
    return visibleRows.filter((row) => {
      const key = `${row.itemCode}:${row.grade}:${row.unitQuantity}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [visibleRows]);
  const summary = useMemo(() => summarizeMarketPrices(visibleRows), [visibleRows]);
  const chartRows = useMemo(() => selected ? buildMarketPriceTrend(queryRows, selected) : [], [queryRows, selected]);

  function changeUnit(value: string) {
    const gradeRows = filterMarketPrices(queryRows, { unit: value, grade: selectedGrade });
    const nextGrade = selectedGrade === "all" || gradeRows.length > 0 ? selectedGrade : "all";
    const nextRows = filterMarketPrices(queryRows, { unit: value, grade: nextGrade });
    setSelectedUnit(value);
    setSelectedGrade(nextGrade);
    setSelected(nextRows[0] ?? null);
  }

  function changeGrade(value: string) {
    const unitRows = filterMarketPrices(queryRows, { unit: selectedUnit, grade: value });
    const nextUnit = selectedUnit === "all" || unitRows.length > 0 ? selectedUnit : "all";
    const nextRows = filterMarketPrices(queryRows, { unit: nextUnit, grade: value });
    setSelectedGrade(value);
    setSelectedUnit(nextUnit);
    setSelected(nextRows[0] ?? null);
  }

  if (!authed) return <main className="marketGate">
    <div className="marketGateCard">
      <BackToDashboardLink className="marketGateBack" />
      <p className="marketEyebrow">GARAK MARKET · FRUIT PRICES</p>
      <h1>가락시장 과일 시세</h1>
      <p>업무용 공유 대시보드입니다. 공용 비밀번호를 입력하면 최근 30일 경매가를 확인할 수 있습니다.</p>
      <form onSubmit={login}>
        <input aria-label="공용 비밀번호" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="공용 비밀번호" autoFocus />
        <button className="marketPrimary">입장하기</button>
      </form>
      {authError && <small className="marketError">{authError}</small>}
    </div>
  </main>;

  return <main className="marketPage">
    <header className="marketHeader">
      <div><p className="marketEyebrow">GARAK MARKET · FRUIT PRICES</p><h1>가락시장 과일 시세</h1><p>검색할 때마다 최신 공식 경매 가격을 품목·등급별로 가져옵니다.</p></div>
      <BackToDashboardLink className="marketBack" />
    </header>
    <section className="marketToolbar">
      <input aria-label="과일 검색" value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void search()} placeholder="복숭아, 샤인머스캣, 참외…" />
      <button className="marketPrimary" onClick={() => void search()} disabled={loading}>{loading ? "조회 중…" : "검색"}</button>
    </section>
    <p className="marketNotice" aria-live="polite">{notice}</p>
    {latest.length === 0 ? <div className="marketEmpty">검색할 과일명을 입력해 주세요.</div> : <>
      <section className="marketFilterBar">
        <label htmlFor="market-package-unit">포장 kg</label>
        <select id="market-package-unit" value={selectedUnit} onChange={(event) => changeUnit(event.target.value)}>
          <option value="all">전체 포장단위</option>
          {unitOptions.map((unit) => <option key={unit} value={unit}>{formatMarketPackageUnit(unit)}</option>)}
        </select>
        <label htmlFor="market-grade">등급</label>
        <select id="market-grade" value={selectedGrade} onChange={(event) => changeGrade(event.target.value)}>
          <option value="all">전체 등급</option>
          {gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
        </select>
        <small>선택한 kg·등급 기준으로 최고가·최저가, 카드, 표, 차트를 계산합니다.</small>
      </section>
      {summary && <section className="marketSummary" aria-label="검색 기간 가격 요약">
        <article className="marketSummaryCard marketSummaryHigh"><span>검색 기간 최고가</span><b>{won.format(summary.highest.averagePrice)}원</b><small>{summary.highest.itemName} · {summary.highest.grade || "등급 미상"} · {formatMarketPackageUnit(summary.highest.unitQuantity)} · {dateLabel(summary.highest.priceDate)}</small></article>
        <article className="marketSummaryCard marketSummaryLow"><span>검색 기간 최저가</span><b>{won.format(summary.lowest.averagePrice)}원</b><small>{summary.lowest.itemName} · {summary.lowest.grade || "등급 미상"} · {formatMarketPackageUnit(summary.lowest.unitQuantity)} · {dateLabel(summary.lowest.priceDate)}</small></article>
        <article className="marketSummaryCard"><span>최고·최저 가격 차이</span><b>{won.format(summary.spread)}원</b><small>{selectedUnit === "all" && selectedGrade === "all" ? "검색된 모든 품종·등급·포장단위 기준" : `${selectedUnit === "all" ? "전체 포장단위" : formatMarketPackageUnit(Number(selectedUnit))} · ${selectedGrade === "all" ? "전체 등급" : selectedGrade} 기준`}</small></article>
      </section>}
      <section className="marketCards">
        {latest.slice(0, 8).map((row) => <button className={`marketCard ${selected?.itemCode === row.itemCode && selected.grade === row.grade && selected.unitQuantity === row.unitQuantity ? "selected" : ""}`} key={row.id} onClick={() => void selectForChart(row)}>
          <span>{row.itemName} · {row.grade || "등급 미상"}</span>
          <b>{won.format(row.averagePrice)}원</b>
          <small>{dateLabel(row.priceDate)} · {formatMarketPackageUnit(row.unitQuantity)}</small>
        </button>)}
      </section>
      <section className="marketGrid">
        <div className="marketPanel marketTrendPanel">
          <div className="marketPanelHead"><h2>{selected?.itemName ?? "품목"} · {selected?.grade ?? "등급"} · {selected ? formatMarketPackageUnit(selected.unitQuantity) : "포장단위"}</h2><small>최근 30일 · 실제 평균가</small></div>
          <MarketPriceLineChart rows={chartRows} loading={historyLoading} />
        </div>
        <div className="marketPanel">
          <div className="marketPanelHead"><h2>가격 상세</h2><small>포장단위·등급별 원자료</small></div>
          <div className="marketTableWrap"><table><thead><tr><th>일자</th><th>품목</th><th>등급</th><th>포장단위</th><th>평균가</th><th>차트</th></tr></thead><tbody>{visibleRows.slice(0, 100).map((row) => <tr key={row.id}><td>{dateLabel(row.priceDate)}</td><td>{row.itemName}</td><td>{row.grade || "-"}</td><td>{formatMarketPackageUnit(row.unitQuantity)}</td><td>{won.format(row.averagePrice)}원</td><td><button className="marketTableAction" onClick={() => void selectForChart(row)}>보기</button></td></tr>)}</tbody></table></div>
        </div>
      </section>
    </>}
  </main>;
}

function today() { return new Date().toISOString().slice(0, 10).replaceAll("-", ""); }
function daysAgo(days: number) { return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10).replaceAll("-", ""); }
