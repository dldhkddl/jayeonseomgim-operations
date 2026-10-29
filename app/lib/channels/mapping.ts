/**
 * 채널 양식 해석 & 매핑 엔진
 *
 * 흐름
 *   1) 채널 관리자에서 받은 "빈 대량등록 엑셀 양식"을 업로드한다.
 *   2) analyzeTemplate() 이 헤더 행을 찾아내고, 각 컬럼을 공통 스키마에 자동 매칭한다.
 *   3) 사람이 화면에서 애매한 매핑만 손본다. (신뢰도 낮은 것부터 보여준다)
 *   4) fillTemplate() 이 "원본 양식 파일 그 자체"에 데이터 행을 채워 넣는다.
 *
 * 핵심 설계 결정
 *   - 엑셀을 새로 만들지 않고 업로드된 양식 워크북을 그대로 재사용한다.
 *     채널 양식에는 숨은 시트·주석·드롭다운·안내문이 들어있는데, 새로 만들면 다 날아가고
 *     컬럼 순서가 한 칸만 밀려도 채널이 통째로 반려한다. 원본을 채우면 순서 불일치가 구조적으로 불가능하다.
 *   - 매핑은 코드가 아니라 데이터(JSON)다. 채널이 양식을 바꾸면 재업로드 한 번으로 끝난다.
 */

import { CANONICAL_BY_ID, CANONICAL_FIELDS, CRITICAL_FIELD_IDS, parseNumberLike, type CanonicalRow } from "./canonical.ts";
import { resolveCoupangSellertoolValue } from "./coupang-sellertool.ts";

type XLSXModule = typeof import("xlsx");

let xlsxPromise: Promise<XLSXModule> | null = null;
export function loadXlsx(): Promise<XLSXModule> {
  if (!xlsxPromise) xlsxPromise = import("xlsx");
  return xlsxPromise;
}

// ── 헤더 정규화 ───────────────────────────────────────────────────────────

/**
 * "판매가(원) *" → "판매가"  (dropParens=true)
 * "이미지등록(상세)" → "이미지등록상세"  (dropParens=false)
 *
 * 괄호는 부연설명일 때도 있고("판매가(원)") 의미의 핵심일 때도 있어서("이미지등록(상세)")
 * 두 가지로 정규화한 뒤 더 잘 맞는 쪽을 쓴다.
 */
export function normalizeHeader(raw: unknown, dropParens = true): string {
  let s = String(raw ?? "").replace(/\r?\n/g, " ");
  if (dropParens) s = s.replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, " ");
  return s
    .replace(/[*※★☆:：;<>|~!@#$%^&+=?"'`\-–—_/\\.,·・()[\]（）]/g, " ")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
}

/** Dice 계수. 0~1 */
function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const ba = bigrams(a);
  const bb = new Map<string, number>();
  for (const g of bigrams(b)) bb.set(g, (bb.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of ba) {
    const n = bb.get(g) ?? 0;
    if (n > 0) {
      hit += 1;
      bb.set(g, n - 1);
    }
  }
  return (2 * hit) / (ba.length + bigrams(b).length);
}

export type FieldMatch = {
  fieldId: string;
  confidence: number;
  /** 매칭에 쓰인 별칭의 길이. 동점일 때 더 구체적인 쪽을 고르는 근거 */
  specificity: number;
};

/** 헤더 문자열 하나를 공통 스키마 필드에 매칭. 없으면 null */
export function matchField(header: string): FieldMatch | null {
  const forms = [...new Set([normalizeHeader(header, true), normalizeHeader(header, false)])].filter(Boolean);
  if (!forms.length) return null;
  if (forms.includes(normalizeHeader("상품고시정보 카테고리", false))) {
    return { fieldId: "infoNoticeGroup", confidence: 1, specificity: forms[0].length };
  }

  let best: FieldMatch | null = null;
  for (const field of CANONICAL_FIELDS) {
    const candidates = [field.label, field.id, ...field.aliases].map((a) => normalizeHeader(a, false)).filter(Boolean);
    for (const c of candidates) {
      for (const h of forms) {
        let score = 0;
        if (h === c) score = 1;
        else if (c.length >= 2 && h.includes(c)) score = 0.62 + 0.28 * (c.length / h.length);
        else if (h.length >= 2 && c.includes(h)) score = 0.58 + 0.24 * (h.length / c.length);
        else {
          const sim = diceSimilarity(h, c);
          if (sim >= 0.62) score = sim * 0.85;
        }
        if (score > 0 && (!best || score > best.confidence || (score === best.confidence && c.length > best.specificity))) {
          best = { fieldId: field.id, confidence: Math.min(1, score), specificity: c.length };
        }
      }
    }
  }
  return best && best.confidence >= 0.55 ? best : null;
}

// ── 양식 해석 ─────────────────────────────────────────────────────────────

export type ColumnMapping = {
  /** 0-based 컬럼 인덱스 */
  col: number;
  header: string;
  /** null = 이 컬럼은 비워둔다 */
  fieldId: string | null;
  confidence: number;
  source: "auto" | "manual" | "none";
};

export type TemplateAnalysis = {
  channelId: string;
  channelLabel: string;
  fileName: string;
  sheetName: string;
  /** 0-based. 이 행이 헤더, 데이터는 headerRow+1부터 */
  headerRow: number;
  /** 0-based. Template rows above this index are preserved as instructions/metadata. */
  dataStartRow: number;
  /** 헤더 아래에 이미 들어있던 예시 데이터 행 수 */
  sampleRowCount: number;
  columns: ColumnMapping[];
  /** base64 원본 양식. 이걸 그대로 채워서 내보낸다 */
  templateBase64: string;
  createdAt: string;
  /** 앱에 내장된 연습용 양식인가. true면 실제 등록 전에 교체해야 한다 */
  builtin?: boolean;
};

export function detectDataStartRow(matrix: unknown[][], headerRow: number): number {
  const scanEnd = Math.min(matrix.length, headerRow + 8);
  for (let r = headerRow + 1; r < scanEnd; r += 1) {
    for (const value of matrix[r] ?? []) {
      const text = String(value ?? "").replace(/\s+/g, " ").trim();
      const match = text.match(/상품정보는\s*(\d+)행부터\s*입력/);
      if (match) return Math.max(headerRow + 1, Number(match[1]) - 1);
    }
  }
  return headerRow + 1;
}

const HEADER_SCAN_DEPTH = 15;

/**
 * 시트가 스스로 신고한 범위(`!ref`)가 실제 데이터보다 작게 잘못 적혀 있는 파일이 실제로 있다
 * (예: 스마트스토어 "일괄수정" 다운로드 파일 — `!ref`는 A1:CP5인데 실제 데이터는 32행까지 있음).
 * `!ref`만 믿고 읽으면 뒤쪽 진짜 상품 행이 통째로 사라지므로, 실제로 값이 들어있는 셀 주소를
 * 전부 훑어서 진짜 범위를 다시 계산한 뒤 그 범위로 읽는다.
 */
function actualUsedRange(XLSX: XLSXModule, ws: import("xlsx").WorkSheet): string | undefined {
  let maxR = -1;
  let maxC = -1;
  let minR = Infinity;
  let minC = Infinity;
  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    const cell = (ws as Record<string, { v?: unknown } | undefined>)[key];
    if (!cell || cell.v === undefined || cell.v === null || cell.v === "") continue;
    const addr = XLSX.utils.decode_cell(key);
    if (addr.r > maxR) maxR = addr.r;
    if (addr.c > maxC) maxC = addr.c;
    if (addr.r < minR) minR = addr.r;
    if (addr.c < minC) minC = addr.c;
  }
  if (maxR < 0) return undefined;
  return XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
}

export function sheetToMatrix(XLSX: XLSXModule, ws: import("xlsx").WorkSheet): unknown[][] {
  const declared = ws["!ref"];
  const real = actualUsedRange(XLSX, ws);
  // 실제 범위가 신고된 범위보다 더 넓으면(=신고 범위가 데이터를 못 담고 있으면) 실제 범위로 읽는다
  const range = real && (!declared || isWiderRange(XLSX, real, declared)) ? real : declared;
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null, raw: true, range }) as unknown[][];
}

function isWiderRange(XLSX: XLSXModule, a: string, b: string): boolean {
  const ra = XLSX.utils.decode_range(a);
  const rb = XLSX.utils.decode_range(b);
  return ra.e.r > rb.e.r || ra.e.c > rb.e.c;
}

/** 안내문·제목 행을 건너뛰고 진짜 헤더 행을 찾는다. 매칭 성공 컬럼 수가 가장 많은 행. */
export function detectHeaderRow(matrix: unknown[][]): { row: number; score: number } {
  let bestRow = 0;
  let bestScore = -1;
  const depth = Math.min(HEADER_SCAN_DEPTH, matrix.length);
  for (let r = 0; r < depth; r += 1) {
    const cells = matrix[r] ?? [];
    const filled = cells.filter((c) => String(c ?? "").trim() !== "").length;
    if (filled < 2) continue;
    let matched = 0;
    for (const c of cells) {
      const m = matchField(String(c ?? ""));
      if (m && m.confidence >= 0.7) matched += 1;
    }
    // 매칭 수가 1순위, 채워진 셀 수가 2순위
    const score = matched * 10 + Math.min(filled, 60) / 10;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return { row: bestRow, score: bestScore };
}

export type AnalyzeOptions = {
  channelId: string;
  channelLabel: string;
  fileName: string;
  /** 지정하지 않으면 헤더 매칭 점수가 가장 높은 시트 */
  sheetName?: string;
};

export async function analyzeTemplate(buffer: ArrayBuffer, opts: AnalyzeOptions): Promise<TemplateAnalysis> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buffer, { type: "array", cellStyles: true });

  const candidates = opts.sheetName ? [opts.sheetName] : wb.SheetNames;
  let picked = { sheetName: candidates[0], headerRow: 0, matrix: [] as unknown[][], score: -1 };

  for (const name of candidates) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const matrix = sheetToMatrix(XLSX, ws);
    if (!matrix.length) continue;
    const { row, score } = detectHeaderRow(matrix);
    if (score > picked.score) picked = { sheetName: name, headerRow: row, matrix, score };
  }

  const headerCells = picked.matrix[picked.headerRow] ?? [];

  // 1차: 컬럼별 최선 매칭
  const columns: ColumnMapping[] = headerCells.map((cell, col) => {
    const header = String(cell ?? "").trim();
    const m = header ? matchField(header) : null;
    return m
      ? { col, header, fieldId: m.fieldId, confidence: m.confidence, source: "auto" as const }
      : { col, header, fieldId: null, confidence: 0, source: "none" as const };
  });

  // 2차: 같은 필드를 두 컬럼이 다투면 "더 구체적인 헤더"가 이긴다.
  //  예) 카페24의 "상품코드"(채널 발급) vs "자체상품코드"(셀러 코드) → 후자가 판매자 상품코드.
  //  진 쪽은 비워두되 confidence를 남겨 UI에서 "확인 필요"로 뜨게 한다.
  const bestByField = new Map<string, { col: number; confidence: number; specificity: number }>();
  headerCells.forEach((cell, col) => {
    const m = String(cell ?? "").trim() ? matchField(String(cell)) : null;
    if (!m) return;
    const prev = bestByField.get(m.fieldId);
    const better =
      !prev || m.confidence > prev.confidence || (m.confidence === prev.confidence && m.specificity > prev.specificity);
    if (better) bestByField.set(m.fieldId, { col, confidence: m.confidence, specificity: m.specificity });
  });
  for (const c of columns) {
    if (!c.fieldId) continue;
    const winner = bestByField.get(c.fieldId);
    if (winner && winner.col !== c.col) {
      c.fieldId = null;
      c.source = "none";
    }
  }

  const dataStartRow = detectDataStartRow(picked.matrix, picked.headerRow);
  const sampleRowCount = picked.matrix
    .slice(dataStartRow)
    .filter((r) => (r ?? []).some((c) => String(c ?? "").trim() !== "")).length;

  return {
    channelId: opts.channelId,
    channelLabel: opts.channelLabel,
    fileName: opts.fileName,
    sheetName: picked.sheetName,
    headerRow: picked.headerRow,
    dataStartRow,
    sampleRowCount,
    columns,
    templateBase64: arrayBufferToBase64(buffer),
    createdAt: new Date().toISOString(),
  };
}

// ── 품질 점검 ─────────────────────────────────────────────────────────────

export type MappingIssue = {
  level: "error" | "warn";
  message: string;
};

/** 내보내기 전에 돌리는 데이터 계약 검사. error가 하나라도 있으면 내보내기를 막는다. */
export function validateMapping(analysis: TemplateAnalysis, rows: CanonicalRow[]): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const mapped = analysis.columns.filter((c) => c.fieldId);

  if (!mapped.length) {
    issues.push({ level: "error", message: "매핑된 컬럼이 하나도 없습니다. 헤더 행이 잘못 잡혔는지 확인하세요." });
    return issues;
  }
  if (!rows.length) {
    issues.push({ level: "error", message: "내보낼 상품 행이 없습니다." });
    return issues;
  }

  const mappedFieldIds = new Set(mapped.map((c) => c.fieldId as string));

  // 양식에는 있는데 채울 값이 비어있는 필수 항목
  for (const fieldId of CRITICAL_FIELD_IDS) {
    if (!mappedFieldIds.has(fieldId)) continue;
    const emptyCount = rows.filter((r) => String(r[fieldId] ?? "").trim() === "").length;
    if (emptyCount === rows.length) {
      issues.push({ level: "error", message: `필수 항목 "${CANONICAL_BY_ID[fieldId].label}"이(가) 모든 행에서 비어 있습니다.` });
    } else if (emptyCount > 0) {
      issues.push({ level: "warn", message: `"${CANONICAL_BY_ID[fieldId].label}"이(가) ${emptyCount}개 행에서 비어 있습니다.` });
    }
  }

  // 양식이 요구하는데 매핑되지 않은 필수 항목
  const unmappedCritical = analysis.columns.filter((c) => {
    if (c.fieldId) return false;
    const m = matchField(c.header);
    return m && CRITICAL_FIELD_IDS.includes(m.fieldId);
  });
  for (const c of unmappedCritical) {
    issues.push({ level: "warn", message: `양식의 "${c.header}" 컬럼이 매핑되지 않았습니다. 필수 항목일 수 있습니다.` });
  }

  const lowConfidence = analysis.columns.filter((c) => c.source === "auto" && c.confidence < 0.75);
  if (lowConfidence.length) {
    issues.push({
      level: "warn",
      message: `자동 매칭 신뢰도가 낮은 컬럼 ${lowConfidence.length}개: ${lowConfidence.slice(0, 5).map((c) => c.header).join(", ")}${lowConfidence.length > 5 ? " 외" : ""}`,
    });
  }

  // 판매자 상품코드 중복 = 채널에서 덮어쓰기 사고
  if (mappedFieldIds.has("sellerProductCode")) {
    const codes = rows.map((r) => String(r.sellerProductCode ?? "").trim()).filter(Boolean);
    const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dup.length) issues.push({ level: "error", message: `판매자 상품코드가 중복됩니다: ${[...new Set(dup)].join(", ")}` });
  }

  return issues;
}

// ── 양식 채우기 ───────────────────────────────────────────────────────────

export type FillOptions = {
  /** 양식에 들어있던 예시 행을 지우고 채운다 (기본 true) */
  clearSampleRows?: boolean;
};

function toCell(value: unknown, type: "text" | "longtext" | "number"): { t: "n" | "s"; v: number | string } | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (s === "") return null;
  if (type === "number") {
    const n = parseNumberLike(s);
    if (n !== null) return { t: "n", v: n };
    // 숫자로 못 읽으면 원문을 그대로 남긴다 (엉터리 숫자를 만들지 않는다)
  }
  return { t: "s", v: s };
}

/** 업로드된 양식 워크북에 데이터를 채워 xlsx 바이트를 돌려준다. */
export async function fillTemplate(
  analysis: TemplateAnalysis,
  rows: CanonicalRow[],
  options: FillOptions = {},
): Promise<Uint8Array> {
  const { clearSampleRows = true } = options;
  const XLSX = await loadXlsx();
  const wb = XLSX.read(base64ToArrayBuffer(analysis.templateBase64), { type: "array", cellStyles: true, bookVBA: true });
  const ws = wb.Sheets[analysis.sheetName];
  if (!ws) throw new Error(`양식에서 시트를 찾을 수 없습니다: ${analysis.sheetName}`);

  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const firstDataRow = analysis.dataStartRow ?? detectDataStartRow(sheetToMatrix(XLSX, ws), analysis.headerRow);
  const maxCol = Math.max(range.e.c, ...analysis.columns.map((c) => c.col));
  const categoryColumn = analysis.columns.find((column) => column.fieldId === "category");
  const coupangSeedCells = new Map<number, import("xlsx").CellObject>();
  let templateCategory: unknown;
  if (analysis.channelId === "coupang" && categoryColumn) {
    for (let r = firstDataRow; r <= range.e.r; r += 1) {
      const value = ws[XLSX.utils.encode_cell({ r, c: categoryColumn.col })]?.v;
      if (String(value ?? "").trim()) {
        templateCategory = value;
        break;
      }
    }
    for (let c = range.s.c; c <= maxCol; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: firstDataRow, c })];
      if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
        coupangSeedCells.set(c, { ...cell });
      }
    }
  }

  if (clearSampleRows) {
    for (let r = firstDataRow; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= maxCol; c += 1) {
        delete ws[XLSX.utils.encode_cell({ r, c })];
      }
    }
  }

  rows.forEach((row, i) => {
    const r = firstDataRow + i;
    if (analysis.channelId === "coupang") {
      for (const [c, cell] of coupangSeedCells) {
        ws[XLSX.utils.encode_cell({ r, c })] = { ...cell };
      }
    }
    for (const col of analysis.columns) {
      const coupangOverride = analysis.channelId === "coupang"
        ? resolveCoupangSellertoolValue(col.header, row, {
            previousSeedValue: coupangSeedCells.get(col.col - 1)?.v,
          })
        : { handled: false as const };
      const field = col.fieldId ? CANONICAL_BY_ID[col.fieldId] : undefined;
      if (!coupangOverride.handled && !field) continue;
      const value = coupangOverride.handled
        ? coupangOverride.value
        : col.fieldId === "category" && templateCategory !== undefined
          ? templateCategory
          : row[col.fieldId as string];
      const cell = toCell(value, coupangOverride.type ?? field!.type);
      const addr = XLSX.utils.encode_cell({ r, c: col.col });
      if (cell) ws[addr] = { t: cell.t, v: cell.v, ...(cell.t === "n" ? { z: "#,##0" } : {}) };
      else if (!coupangSeedCells.has(col.col)) delete ws[addr];
    }
  });

  const lastRow = Math.max(range.e.r, firstDataRow + rows.length - 1);
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: range.s.r, c: range.s.c }, e: { r: lastRow, c: maxCol } });

  const macroEnabled = /\.xlsm$/i.test(analysis.fileName);
  return new Uint8Array(XLSX.write(wb, {
    type: "array",
    bookType: macroEnabled ? "xlsm" : "xlsx",
    bookVBA: macroEnabled,
  }) as ArrayBuffer);
}

/** 양식 파일이 아직 없을 때 쓰는 폴백: 매핑된 필드만으로 새 시트를 만든다. */
export async function buildFallbackWorkbook(rows: CanonicalRow[], fieldIds: string[]): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  const fields = fieldIds.map((id) => CANONICAL_BY_ID[id]).filter(Boolean);
  const aoa: unknown[][] = [fields.map((f) => f.label)];
  for (const row of rows) {
    aoa.push(
      fields.map((f) => {
        const cell = toCell(row[f.id], f.type);
        return cell ? cell.v : "";
      }),
    );
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = fields.map((f) => ({ wch: f.type === "longtext" ? 45 : 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "상품등록");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

// ── base64 유틸 (브라우저/워커 양쪽 동작) ──────────────────────────────────

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
