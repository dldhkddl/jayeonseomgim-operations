import { importFilledWorkbook, inspectImport, type ImportIssue } from "./importer.ts";
import { analyzeTemplate, fillTemplate, validateMapping, type TemplateAnalysis } from "./mapping.ts";
import type { CanonicalRow } from "./canonical.ts";

export type TargetTemplateOptions = {
  channelId: string;
  channelLabel: string;
  fileName: string;
};

const FULL_CONVERSION_FIELDS = [
  "productName", "sellerProductCode", "price", "stock", "mainImage", "extraImages", "detailContent", "infoNoticeGroup",
] as const;

/** 상품정보 수정용처럼 일부 항목만 받는 양식인지 판별한다. */
export function missingFullConversionFields(template: TemplateAnalysis): string[] {
  const mapped = new Set(template.columns.map((column) => column.fieldId).filter(Boolean));
  return FULL_CONVERSION_FIELDS.filter((field) => !mapped.has(field));
}

function isBlank(value: unknown): boolean {
  return String(value ?? "").trim() === "";
}

/** 사용자가 이미 입력한 값은 유지하고, 이전에 정한 개인용 자동등록 기본값만 채운다. */
export function applyConversionDefaults(rows: CanonicalRow[]): CanonicalRow[] {
  const usedCodes = new Set(rows.map((row) => String(row.sellerProductCode ?? "").trim()).filter(Boolean));
  return rows.map((row, index) => {
    const next = { ...row };
    if (isBlank(next.sellerProductCode)) {
      const channelNo = String(next.channelProductNo ?? "").replace(/\D/g, "");
      const base = channelNo ? `NV-${channelNo}` : `DAMDA-${index + 1}`;
      let candidate = base.slice(0, 30);
      let suffix = 2;
      while (usedCodes.has(candidate)) {
        const tail = `-${suffix++}`;
        candidate = `${base.slice(0, 30 - tail.length)}${tail}`;
      }
      next.sellerProductCode = candidate;
      usedCodes.add(candidate);
    }
    if (isBlank(next.stock)) next.stock = 30;
    if (isBlank(next.origin)) next.origin = "국산";
    if (isBlank(next.infoNoticeGroup)) next.infoNoticeGroup = "농수축산물";
    return next;
  });
}

export function analyzeTargetTemplate(buffer: ArrayBuffer, options: TargetTemplateOptions): Promise<TemplateAnalysis> {
  return analyzeTemplate(buffer, options);
}

export type ChannelConversionResult = {
  bytes: Uint8Array;
  extension: "xlsx" | "xlsm";
  rowCount: number;
  sourceSheetName: string;
  issues: ImportIssue[];
};

/** 채워진 어느 채널 엑셀이든 공통 행으로 읽은 뒤 대상 채널의 원본 양식에 넣는다. */
export async function convertChannelWorkbook(
  sourceBuffer: ArrayBuffer,
  options: { sourceFileName: string; targetTemplate: TemplateAnalysis; sourceRows?: CanonicalRow[] },
): Promise<ChannelConversionResult> {
  const imported = await importFilledWorkbook(sourceBuffer, { fileName: options.sourceFileName });
  const rows = applyConversionDefaults(options.sourceRows ?? imported.picked.rows);
  if (!rows.length) {
    throw new Error("상품 데이터가 없습니다. 상품이 채워진 엑셀이 아니라 빈 양식만 올렸는지 확인해 주세요.");
  }
  const blockingIssues = validateMapping(options.targetTemplate, rows).filter((issue) => issue.level === "error");
  if (blockingIssues.length) {
    const missingFields = blockingIssues
      .map((issue) => issue.message.match(/"([^"]+)"/)?.[1])
      .filter((field): field is string => Boolean(field));
    if (missingFields.length) {
      throw new Error(`${missingFields.map((field) => `"${field}"`).join(", ")} 값이 원본 엑셀에 없습니다. 상품 관리에서 채운 뒤 다시 변환해 주세요.`);
    }
    throw new Error(blockingIssues.map((issue) => issue.message).join(" "));
  }

  return {
    bytes: await fillTemplate(options.targetTemplate, rows, { clearSampleRows: true }),
    extension: /\.xlsm$/i.test(options.targetTemplate.fileName) ? "xlsm" : "xlsx",
    rowCount: rows.length,
    sourceSheetName: imported.picked.sheetName,
    issues: inspectImport(imported.picked),
  };
}
