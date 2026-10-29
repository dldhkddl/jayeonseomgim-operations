/**
 * 내보내기 미리보기
 *
 * 엑셀을 받아서 열어봐야 확인되는 걸 화면에서 먼저 보여준다.
 * 중요한 건 fillTemplate()과 **같은 규칙**으로 값을 만든다는 점이다.
 * 미리보기와 실제 파일이 다르면 미리보기가 오히려 해롭다.
 */

import { CANONICAL_BY_ID, CRITICAL_FIELD_IDS, parseNumberLike, type CanonicalRow } from "./canonical";
import type { ColumnMapping } from "./mapping";

export type CellState =
  /** 이 컬럼은 공통 스키마에 연결되지 않아 빈 칸으로 나간다 */
  | "unmapped"
  /** 값이 들어간다 */
  | "filled"
  /** 연결은 됐는데 값이 없다 (필수 아님) */
  | "empty"
  /** 필수 항목인데 비었다 */
  | "missing";

export type PreviewCell = {
  col: number;
  header: string;
  fieldId: string | null;
  state: CellState;
  /** 화면에 표시할 문자열 */
  display: string;
  /** 숫자로 들어가는 값인가 (엑셀에서 우측 정렬됨) */
  numeric: boolean;
};

export type PreviewRow = {
  index: number;
  cells: PreviewCell[];
};

export type PreviewTable = {
  columns: { col: number; header: string; fieldId: string | null; mapped: boolean }[];
  rows: PreviewRow[];
  /** 값이 하나라도 채워지는 컬럼 번호들 */
  usedCols: number[];
  summary: { total: number; filled: number; missing: number; unmapped: number };
};

/** fillTemplate의 toCell()과 동일한 규칙으로 표시값을 만든다 */
function formatValue(raw: unknown, type: "text" | "longtext" | "number"): { display: string; numeric: boolean } {
  if (raw === undefined || raw === null) return { display: "", numeric: false };
  const s = String(raw).trim();
  if (s === "") return { display: "", numeric: false };
  if (type === "number") {
    const n = parseNumberLike(s);
    if (n !== null) return { display: n.toLocaleString(), numeric: true };
  }
  return { display: s, numeric: false };
}

export function buildPreview(columns: ColumnMapping[], rows: CanonicalRow[]): PreviewTable {
  const cols = columns.map((c) => ({
    col: c.col,
    header: c.header || `(빈 헤더 ${c.col + 1})`,
    fieldId: c.fieldId,
    mapped: Boolean(c.fieldId),
  }));

  let filled = 0;
  let missing = 0;

  const previewRows: PreviewRow[] = rows.map((row, index) => ({
    index,
    cells: columns.map((c) => {
      if (!c.fieldId) {
        return {
          col: c.col,
          header: c.header,
          fieldId: null,
          state: "unmapped" as CellState,
          display: "",
          numeric: false,
        };
      }
      const field = CANONICAL_BY_ID[c.fieldId];
      const { display, numeric } = formatValue(row[c.fieldId], field?.type ?? "text");
      let state: CellState;
      if (display) {
        state = "filled";
        filled += 1;
      } else if (CRITICAL_FIELD_IDS.includes(c.fieldId)) {
        state = "missing";
        missing += 1;
      } else {
        state = "empty";
      }
      return { col: c.col, header: c.header, fieldId: c.fieldId, state, display, numeric };
    }),
  }));

  const usedCols = cols
    .filter((c) => c.mapped && previewRows.some((r) => r.cells.find((x) => x.col === c.col)?.display))
    .map((c) => c.col);

  return {
    columns: cols,
    rows: previewRows,
    usedCols,
    summary: {
      total: columns.length * rows.length,
      filled,
      missing,
      unmapped: columns.filter((c) => !c.fieldId).length,
    },
  };
}

/**
 * 채널 양식을 아직 안 올렸을 때 쓰는 미리보기.
 * 공통 스키마 중 값이 있는 항목만 컬럼으로 세운다.
 */
export function buildCanonicalPreview(rows: CanonicalRow[]): PreviewTable {
  const usedFieldIds = Object.keys(CANONICAL_BY_ID).filter((id) =>
    rows.some((r) => String(r[id] ?? "").trim() !== ""),
  );
  const columns: ColumnMapping[] = usedFieldIds.map((id, i) => ({
    col: i,
    header: CANONICAL_BY_ID[id].label,
    fieldId: id,
    confidence: 1,
    source: "manual",
  }));
  return buildPreview(columns, rows);
}
