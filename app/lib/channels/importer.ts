/**
 * 이미 값이 채워진 등록표 → 공통 스키마 역변환 (Import)
 *
 * 왜 필요한가
 *   내보내기(fillTemplate)만 있으면 "앱에서 새로 입력한 상품"만 다른 채널로 보낼 수 있다.
 *   이미 만들어 둔 스마트스토어 등록표를 쿠팡으로 옮기려면 반대 방향이 필요하다.
 *      채워진 엑셀 ──(import)──▶ 공통 스키마 ──(fillTemplate)──▶ 다른 채널 양식
 *
 * 헤더 해석은 내보내기와 같은 엔진(matchField/detectHeaderRow)을 쓴다.
 * 읽을 때와 쓸 때의 해석이 갈리면 왕복에서 값이 조용히 어긋나기 때문이다.
 */

import { CANONICAL_BY_ID, CRITICAL_FIELD_IDS, parseNumberLike, type CanonicalRow } from "./canonical.ts";
import { detectDataStartRow, detectHeaderRow, loadXlsx, matchField, sheetToMatrix, type ColumnMapping } from "./mapping.ts";

export type ImportedSheet = {
  sheetName: string;
  headerRow: number;
  columns: ColumnMapping[];
  rows: CanonicalRow[];
  /** 데이터로 보지 않고 건너뛴 행 수 (빈 행, 안내 문구 행 등) */
  skippedRows: number;
  /** 공통 스키마에 자리가 없어 버려진 헤더들 */
  unmappedHeaders: string[];
};

export type ImportResult = {
  fileName: string;
  /** 헤더 매칭 점수가 가장 높은 시트를 고른 결과 */
  picked: ImportedSheet;
  /** 파일 안의 다른 시트 이름들 (사용자가 바꿔 고를 수 있게) */
  otherSheets: string[];
};

/** 셀 값을 필드 타입에 맞춰 정규화. "39,900원" → 39900 */
function normalizeValue(raw: unknown, fieldId: string): string | number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;

  const field = CANONICAL_BY_ID[fieldId];
  if (field?.type === "number") {
    // 설명이 섞인 값("제주 3,000원 / 울릉 11,000원")은 숫자로 억지 변환하지 않는다
    const n = parseNumberLike(s);
    return n !== null ? n : s;
  }
  // 엑셀 줄바꿈은 살리되 앞뒤 공백만 정리
  return s.replace(/\r\n/g, "\n").trim();
}

/**
 * 실제 스마트스토어 "일괄수정" 양식은 헤더 바로 아래에 "필수/비필수/조건부필수" 같은
 * 작성 가이드 마커 행과, 셀마다 몇 문단짜리 안내문이 들어있는 설명 행을 두고, 그다음에야
 * 진짜 데이터가 시작된다. 이 두 종류를 상품으로 오인하면 안 되므로 데이터 행 판정에서 걸러낸다.
 */
const GUIDE_MARKER_WORDS = new Set(["필수", "비필수", "조건부필수", "선택", "선택입력", "필수입력", "선택사항", "필수사항"]);

/**
 * 데이터 행인지 판정.
 * 표 아래 "※ 실제 계약정보 확인 필요" 같은 안내 문구를 상품으로 오인하면
 * 채널에 쓰레기 행이 등록되므로, 의미 있는 컬럼이 2개 이상 찬 행만 통과시킨다.
 */
function looksLikeDataRow(cells: unknown[], columns: ColumnMapping[]): boolean {
  let filled = 0;
  let markerHits = 0;
  let paragraphHits = 0;
  for (const c of columns) {
    if (!c.fieldId) continue;
    const v = String(cells[c.col] ?? "").trim();
    if (!v) continue;
    filled += 1;
    if (GUIDE_MARKER_WORDS.has(v)) markerHits += 1;
    // 진짜 데이터(사진 여러 장, A/S 안내문 등)도 길 수 있어 길이만으로는 못 거른다.
    // 다만 문단 구분(빈 줄)까지 있는 건 사람이 읽으라고 쓴 작성 가이드일 때뿐이다.
    if (v.includes("\n\n")) paragraphHits += 1;
  }
  if (filled < 2) return false;
  // 채워진 칸 대부분이 "필수/비필수" 마커면 상품이 아니라 작성 가이드 행이다
  if (markerHits >= 2 && markerHits >= filled - 1) return false;
  // 여러 칸에 걸쳐 문단 구분된 안내문이 들어있으면 상품 데이터가 아니라 설명 행이다
  if (paragraphHits >= 2) return false;
  return true;
}

function readSheet(
  XLSX: Awaited<ReturnType<typeof loadXlsx>>,
  wb: import("xlsx").WorkBook,
  sheetName: string,
): (ImportedSheet & { score: number }) | null {
  const ws = wb.Sheets[sheetName];
  if (!ws) return null;
  const matrix = sheetToMatrix(XLSX, ws);
  if (!matrix.length) return null;

  const { row: headerRow, score } = detectHeaderRow(matrix);
  const headerCells = matrix[headerRow] ?? [];

  // 내보내기와 동일한 중복 해소 규칙: 같은 필드를 다투면 더 구체적인 헤더가 이긴다
  const bestByField = new Map<string, { col: number; confidence: number; specificity: number }>();
  headerCells.forEach((cell, col) => {
    const m = String(cell ?? "").trim() ? matchField(String(cell)) : null;
    if (!m) return;
    const prev = bestByField.get(m.fieldId);
    if (!prev || m.confidence > prev.confidence || (m.confidence === prev.confidence && m.specificity > prev.specificity)) {
      bestByField.set(m.fieldId, { col, confidence: m.confidence, specificity: m.specificity });
    }
  });

  const columns: ColumnMapping[] = headerCells.map((cell, col) => {
    const header = String(cell ?? "").trim();
    const m = header ? matchField(header) : null;
    const winner = m ? bestByField.get(m.fieldId) : undefined;
    const keep = m && winner && winner.col === col;
    return keep
      ? { col, header, fieldId: m.fieldId, confidence: m.confidence, source: "auto" as const }
      : { col, header, fieldId: null, confidence: m?.confidence ?? 0, source: "none" as const };
  });

  const dataStartRow = detectDataStartRow(matrix, headerRow);
  const body = matrix.slice(dataStartRow);
  const rows: CanonicalRow[] = [];
  let skippedRows = matrix
    .slice(headerRow + 1, dataStartRow)
    .filter((cells) => (cells ?? []).some((cell) => String(cell ?? "").trim() !== "")).length;

  for (const cells of body) {
    if (!looksLikeDataRow(cells ?? [], columns)) {
      if ((cells ?? []).some((c) => String(c ?? "").trim() !== "")) skippedRows += 1;
      continue;
    }
    const row: CanonicalRow = {};
    for (const c of columns) {
      if (!c.fieldId) continue;
      const v = normalizeValue(cells[c.col], c.fieldId);
      if (v !== undefined) row[c.fieldId] = v;
    }
    rows.push(row);
  }

  return {
    sheetName,
    headerRow,
    columns,
    rows,
    skippedRows,
    unmappedHeaders: columns.filter((c) => !c.fieldId && c.header).map((c) => c.header),
    score: score + rows.length, // 헤더 품질 + 실제 데이터 양
  };
}

export async function importFilledWorkbook(
  buffer: ArrayBuffer,
  opts: { fileName: string; sheetName?: string },
): Promise<ImportResult> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buffer, { type: "array" });

  if (opts.sheetName) {
    const only = readSheet(XLSX, wb, opts.sheetName);
    if (!only) throw new Error(`시트를 읽을 수 없습니다: ${opts.sheetName}`);
    return { fileName: opts.fileName, picked: only, otherSheets: wb.SheetNames.filter((n) => n !== opts.sheetName) };
  }

  let best: (ImportedSheet & { score: number }) | null = null;
  for (const name of wb.SheetNames) {
    const r = readSheet(XLSX, wb, name);
    if (r && (!best || r.score > best.score)) best = r;
  }
  if (!best) throw new Error("읽을 수 있는 시트가 없습니다.");

  return { fileName: opts.fileName, picked: best, otherSheets: wb.SheetNames.filter((n) => n !== best.sheetName) };
}

// ── 가져온 데이터 품질 리포트 ─────────────────────────────────────────────

export type ImportIssue = { level: "error" | "warn" | "info"; message: string };

/**
 * 가져온 뒤 바로 다른 채널로 내보내면 위험한 지점을 짚는다.
 * 특히 "표에는 있는데 값이 안내문인" 경우 — 예: 원산지 칸에 "실제 산지 확인 필요"
 */
const PLACEHOLDER_PATTERN = /(확인\s*필요|미정|추후|예시|샘플|입력\s*요망|템플릿\s*선택)/;

export function inspectImport(result: ImportedSheet): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const { rows, columns } = result;

  if (!rows.length) {
    issues.push({ level: "error", message: "데이터 행을 찾지 못했습니다. 시트를 바꿔서 다시 시도해 보세요." });
    return issues;
  }

  const mappedIds = new Set(columns.filter((c) => c.fieldId).map((c) => c.fieldId as string));
  for (const fieldId of CRITICAL_FIELD_IDS) {
    if (mappedIds.has(fieldId)) continue;
    if (rows.some((row) => String(row[fieldId] ?? "").trim() !== "")) continue;
    issues.push({ level: "warn", message: `"${CANONICAL_BY_ID[fieldId].label}" 컬럼이 원본에 없습니다. 내보내기 전에 채워야 합니다.` });
  }

  // 안내문이 값으로 들어온 칸
  const placeholders = new Map<string, number>();
  for (const row of rows) {
    for (const [fieldId, v] of Object.entries(row)) {
      if (typeof v === "string" && PLACEHOLDER_PATTERN.test(v)) {
        placeholders.set(fieldId, (placeholders.get(fieldId) ?? 0) + 1);
      }
    }
  }
  for (const [fieldId, count] of placeholders) {
    issues.push({
      level: CRITICAL_FIELD_IDS.includes(fieldId) ? "error" : "warn",
      message: `"${CANONICAL_BY_ID[fieldId]?.label ?? fieldId}"에 확정되지 않은 값이 ${count}건 있습니다(예: "확인 필요"). 그대로 등록하면 안 됩니다.`,
    });
  }

  if (result.skippedRows > 0) {
    issues.push({ level: "info", message: `엑셀 작성 안내 행 ${result.skippedRows}개는 자동으로 제외했습니다.` });
  }
  if (result.unmappedHeaders.length) {
    issues.push({
      level: "info",
      message: `다른 채널에서 사용하지 않는 원본 전용 열 ${result.unmappedHeaders.length}개는 변환에서 제외합니다.`,
    });
  }

  return issues;
}

/** 가져온 행에 부족한 기본값을 채운다 (출고지·A/S 전화처럼 채널 공통값) */
export function applyDefaults(rows: CanonicalRow[], defaults: Partial<CanonicalRow>): CanonicalRow[] {
  return rows.map((r) => {
    const next = { ...r };
    for (const [k, v] of Object.entries(defaults)) {
      if (v === undefined || v === "") continue;
      if (String(next[k] ?? "").trim() === "") next[k] = v;
    }
    return next;
  });
}
