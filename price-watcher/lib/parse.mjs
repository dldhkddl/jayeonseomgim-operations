// 유연 파서: config의 컬럼 별칭으로 헤더를 찾아 표준 형태로 정규화한다.
// 농장 엑셀 헤더 이름/순서가 바뀌어도 config.columns 에 별칭만 추가하면 동작한다.
import xlsx from "xlsx";

/** 문자열 정규화(공백·괄호·단위표기 흔들림 흡수) */
function norm(s) {
  return String(s ?? "").replace(/\s+/g, "").replace(/[()（）]/g, "").toLowerCase();
}

/** 숫자만 뽑기: "12,900원" -> 12900, "3.5" -> 3.5 */
function toNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 헤더 행(문자열 배열)에서 각 표준필드가 어느 열 인덱스인지 찾는다 */
function mapHeaders(headerRow, columnAliases) {
  const normalizedHeader = headerRow.map(norm);
  const map = {};
  for (const [field, aliases] of Object.entries(columnAliases)) {
    let idx = -1;
    for (const alias of aliases) {
      const a = norm(alias);
      // 정확일치 우선, 없으면 포함 매칭
      idx = normalizedHeader.findIndex((h) => h === a);
      if (idx === -1) idx = normalizedHeader.findIndex((h) => h.includes(a));
      if (idx !== -1) break;
    }
    map[field] = idx;
  }
  return map;
}

/**
 * 엑셀 파일 -> 표준 상품 배열
 * 반환: { rows: Map<key, item>, meta: {...} }
 * item = { key, code, name, spec, supply, stock, status, soldOut, raw }
 */
export function parseWorkbook(filePath, config) {
  const wb = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = config.sheet || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`시트를 찾을 수 없습니다: ${sheetName} (파일: ${filePath})`);

  const matrix = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  const headerIdx = (config.headerRow || 1) - 1;
  const headerRow = matrix[headerIdx] || [];
  const colMap = mapHeaders(headerRow, config.columns);

  if (colMap.name === -1 && colMap.code === -1) {
    throw new Error(
      `헤더에서 '상품명/상품코드' 열을 못 찾았습니다. config.columns 별칭에 실제 헤더 이름을 추가하세요.\n` +
      `발견된 헤더: ${JSON.stringify(headerRow)}`
    );
  }

  const soldOutKw = (config.soldOutKeywords || []).map(norm);
  const rows = new Map();
  const dupes = [];

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || row.every((c) => c === "" || c == null)) continue;

    const cell = (i) => (i >= 0 ? row[i] : undefined);
    const code = String(cell(colMap.code) ?? "").trim();
    const name = String(cell(colMap.name) ?? "").trim();
    if (!code && !name) continue;

    const supply = toNumber(cell(colMap.supply));
    const stock = toNumber(cell(colMap.stock));
    const statusRaw = String(cell(colMap.status) ?? "").trim();

    const soldOut =
      (stock != null && stock <= 0) ||
      soldOutKw.some((kw) => kw && norm(statusRaw).includes(kw));

    // 키: 상품코드 우선(가장 안정적), 없으면 상품명
    const key = code || `name:${name}`;

    const item = {
      key,
      code: code || null,
      name: name || null,
      spec: String(cell(colMap.spec) ?? "").trim() || null,
      supply,
      stock,
      status: statusRaw || null,
      soldOut,
      raw: row,
    };

    if (rows.has(key)) dupes.push(key);
    rows.set(key, item);
  }

  return {
    rows,
    meta: {
      file: filePath,
      sheet: sheetName,
      headerRow: headerRow,
      colMap,
      count: rows.size,
      duplicateKeys: [...new Set(dupes)],
    },
  };
}
