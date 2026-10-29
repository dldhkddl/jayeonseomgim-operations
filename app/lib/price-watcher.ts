import * as XLSX from "xlsx";
import { sellingPriceForTargetProductMargin } from "./margin-calculator";

export type PriceRow = {
  name: string;
  prevPrice: number;
  currentPrice: number;
  changeRate: number;
};

export type ParsedPriceSheet = {
  rows: PriceRow[];
  skipped: number;
};

const NAME_HEADERS = ["품목명", "상품명", "품목"];
const PREV_HEADERS = ["전주단가", "전주가격", "전주단가(원)", "지난주단가", "지난주가격"];
const CURRENT_HEADERS = ["이번주단가", "이번주가격", "이번주단가(원)", "금주단가", "금주가격"];

function normalizeHeader(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function findColumn(headerRow: unknown[], candidates: string[]): number {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headerRow.findIndex((cell) => normalizedCandidates.includes(normalizeHeader(cell)));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[,원\s]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 매주 받는 매입단가 엑셀을 읽어 품목별 전주·이번주 단가와 변동률을 뽑는다. 서버로 보내지 않고 브라우저 안에서만 처리한다. */
export function parsePriceSheet(buffer: ArrayBuffer): ParsedPriceSheet {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("시트를 찾을 수 없습니다.");

  const table = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, blankrows: false });
  if (table.length < 2) throw new Error("품목 데이터가 없습니다.");

  const [headerRow, ...dataRows] = table;
  const nameCol = findColumn(headerRow, NAME_HEADERS);
  const prevCol = findColumn(headerRow, PREV_HEADERS);
  const currentCol = findColumn(headerRow, CURRENT_HEADERS);

  if (nameCol === -1 || prevCol === -1 || currentCol === -1) {
    throw new Error("열 이름을 확인해 주세요. '품목명', '전주단가', '이번주단가' 열이 필요합니다.");
  }

  let skipped = 0;
  const rows: PriceRow[] = [];
  for (const row of dataRows) {
    const name = String(row[nameCol] ?? "").trim();
    const prevPrice = toNumber(row[prevCol]);
    const currentPrice = toNumber(row[currentCol]);
    if (!name || prevPrice === null || currentPrice === null) {
      if (row.some((cell) => String(cell ?? "").trim())) skipped += 1;
      continue;
    }
    const changeRate = prevPrice > 0 ? (currentPrice - prevPrice) / prevPrice : 0;
    rows.push({ name, prevPrice, currentPrice, changeRate });
  }

  return { rows, skipped };
}

/** 스펙 문서 예시값. 반영 여부를 자동으로 결정하지 않고, 눈에 띄게 표시만 하는 용도. */
export const ABNORMAL_CHANGE_THRESHOLD = 0.2;

export function isAbnormalChange(changeRate: number): boolean {
  return Math.abs(changeRate) >= ABNORMAL_CHANGE_THRESHOLD;
}

/** 이번주 매입단가를 원가로 놓고 목표 마진율을 만족하는 참고 판매가를 계산한다. 실제 채널가는 사람이 직접 반영한다. */
export function suggestedSellingPrice(currentPrice: number, targetMarginPercent: number): number | null {
  return sellingPriceForTargetProductMargin(currentPrice, targetMarginPercent, 100);
}
