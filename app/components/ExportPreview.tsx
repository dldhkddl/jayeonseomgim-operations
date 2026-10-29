"use client";

import { useMemo, useState } from "react";
import type { CanonicalRow } from "../lib/channels/canonical";
import type { ColumnMapping } from "../lib/channels/mapping";
import { buildCanonicalPreview, buildPreview } from "../lib/channels/preview";

type Props = {
  /** 채널 양식의 컬럼. 없으면 공통 스키마 기준으로 보여준다 */
  columns?: ColumnMapping[];
  rows: CanonicalRow[];
  /** 표 위에 붙는 설명 (예: "쿠팡 양식") */
  label: string;
};

export default function ExportPreview({ columns, rows, label }: Props) {
  const [onlyUsed, setOnlyUsed] = useState(true);
  const [open, setOpen] = useState(true);

  const table = useMemo(
    () => (columns && columns.length ? buildPreview(columns, rows) : buildCanonicalPreview(rows)),
    [columns, rows],
  );

  const visibleCols = useMemo(() => {
    if (!onlyUsed) return table.columns;
    const used = new Set(table.usedCols);
    // 값이 있는 컬럼 + 비어 있는 필수 컬럼은 항상 보여준다 (놓치면 안 되므로)
    return table.columns.filter(
      (c) =>
        used.has(c.col) ||
        table.rows.some((r) => r.cells.find((x) => x.col === c.col)?.state === "missing"),
    );
  }, [table, onlyUsed]);

  const hiddenCount = table.columns.length - visibleCols.length;

  if (!rows.length) return null;

  return (
    <div className="pvw">
      <button className="pvwHead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="pvwCaret">{open ? "▾" : "▸"}</span>
        <b>내보낼 내용 미리보기</b>
        <small>
          {label} · {rows.length}행 × {table.columns.length}칸
          {table.summary.missing > 0 && <em> · 필수 빈칸 {table.summary.missing}</em>}
        </small>
      </button>

      {open && (
        <div className="pvwBody">
          <div className="pvwBar">
            <label>
              <input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} />
              값 있는 칸만 보기
              {onlyUsed && hiddenCount > 0 && <i> (빈 칸 {hiddenCount}개 숨김)</i>}
            </label>
            <div className="pvwLegend">
              <span className="lg filled" /> 채워짐
              <span className="lg missing" /> 필수 빈칸
              <span className="lg unmapped" /> 미연결
            </div>
          </div>

          <div className="pvwScroll">
            <table className="pvwTable">
              <thead>
                <tr>
                  <th className="pvwNo">#</th>
                  {visibleCols.map((c) => (
                    <th key={c.col} className={c.mapped ? "" : "unmapped"} title={c.header}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.index}>
                    <td className="pvwNo">{r.index + 1}</td>
                    {visibleCols.map((c) => {
                      const cell = r.cells.find((x) => x.col === c.col);
                      if (!cell) return <td key={c.col} />;
                      return (
                        <td
                          key={c.col}
                          className={`${cell.state} ${cell.numeric ? "num" : ""}`}
                          title={cell.display || (cell.state === "missing" ? "필수 항목인데 비어 있습니다" : "")}
                        >
                          {cell.display || (cell.state === "missing" ? "필수 누락" : "")}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="pvwFoot">
            여기 보이는 값이 그대로 엑셀에 들어갑니다. 컬럼 순서도 실제 양식과 같습니다.
            {table.summary.unmapped > 0 && ` 연결되지 않은 컬럼 ${table.summary.unmapped}개는 빈 칸으로 나갑니다.`}
          </p>
        </div>
      )}
    </div>
  );
}
