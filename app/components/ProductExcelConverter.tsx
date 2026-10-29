"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import BackToDashboardLink from "./BackToDashboardLink";

import { buildBuiltinTemplate } from "../lib/channels/builtin";
import { CHANNELS, loadTemplates, saveTemplate } from "../lib/channels/channels";
import { analyzeTargetTemplate, convertChannelWorkbook, missingFullConversionFields } from "../lib/channels/converter";
import { enrichImportedRowsFromProducts } from "../lib/channels/conversion-enrichment";
import { importFilledWorkbook, inspectImport, type ImportResult } from "../lib/channels/importer";
import type { TemplateAnalysis } from "../lib/channels/mapping";
import { applyNaverImportedDetails, type NaverImportedDetails } from "../lib/naverProductImport";
import type { Product } from "../lib/products";
import styles from "./ProductExcelConverter.module.css";

const TARGETS = CHANNELS.filter((channel) => ["smartstore", "coupang", "cafe24"].includes(channel.id));

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const macroEnabled = /\.xlsm$/i.test(fileName);
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: macroEnabled
      ? "application/vnd.ms-excel.sheet.macroEnabled.12"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeName(value: string) {
  return value.replace(/\.(xlsx?|xlsm)$/i, "").replace(/[\\/:*?"<>|]/g, "_").trim() || "상품";
}

export default function ProductExcelConverter() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceBuffer, setSourceBuffer] = useState<ArrayBuffer | null>(null);
  const [sourceResult, setSourceResult] = useState<ImportResult | null>(null);
  const [templates, setTemplates] = useState<Record<string, TemplateAnalysis>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function prepareTemplates() {
      const saved = loadTemplates();
      const entries = await Promise.all(TARGETS.map(async (channel) => {
        const stored = saved[channel.id];
        const template = stored && missingFullConversionFields(stored).length === 0
          ? stored
          : await buildBuiltinTemplate(channel.id, channel.label);
        return [channel.id, template] as const;
      }));
      if (alive) setTemplates(Object.fromEntries(entries.filter((entry) => entry[1])) as Record<string, TemplateAnalysis>);
    }
    void prepareTemplates();
    return () => { alive = false; };
  }, []);

  const sourceIssues = useMemo(
    () => sourceResult ? inspectImport(sourceResult.picked) : [],
    [sourceResult],
  );

  async function readSource(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("source");
    setError("");
    setMessage("");
    try {
      const buffer = await file.arrayBuffer();
      const result = await importFilledWorkbook(buffer, { fileName: file.name });
      if (!result.picked.rows.length) {
        throw new Error("상품 데이터가 없습니다. 상품이 채워진 엑셀이 아니라 빈 양식만 올렸는지 확인해 주세요.");
      }
      let rows = result.picked.rows;
      try {
        const catalogResponse = await fetch("/api/products");
        const catalog = await catalogResponse.json() as { products?: Product[] };
        if (catalogResponse.ok && Array.isArray(catalog.products)) {
          rows = enrichImportedRowsFromProducts(rows, catalog.products);
        }
      } catch {
        // 공용 상품 저장소가 잠시 unavailable이어도 원본 엑셀 변환은 계속한다.
      }

      const missingDetailNos = rows
        .filter((row) => !String(row.detailContent ?? "").trim())
        .map((row) => String(row.channelProductNo ?? "").trim())
        .filter((value) => /^\d+$/.test(value));
      if (missingDetailNos.length) {
        try {
          const detailResponse = await fetch("/api/naver/import-details", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ channelProductNos: missingDetailNos }),
          });
          const detailResult = await detailResponse.json() as { details?: Record<string, NaverImportedDetails> };
          if (detailResponse.ok) rows = applyNaverImportedDetails(rows, detailResult.details ?? {});
        } catch {
          // 저장된 상세가 없는 상품만 네이버 조회를 시도한다. 실패는 아래 누락 검사에서 보여 준다.
        }
      }

      const enrichedResult: ImportResult = {
        ...result,
        picked: { ...result.picked, rows },
      };
      setSourceFile(file);
      setSourceBuffer(buffer);
      setSourceResult(enrichedResult);
      const detailCount = rows.filter((row) => String(row.detailContent ?? "").trim()).length;
      setMessage(`${file.name}에서 상품 ${rows.length}개를 읽었습니다. 기존 상세페이지 ${detailCount}개를 함께 준비했습니다.`);
    } catch (reason) {
      setSourceFile(null);
      setSourceBuffer(null);
      setSourceResult(null);
      setError(reason instanceof Error ? reason.message : "엑셀을 읽지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function readTargetTemplate(channelId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const channel = TARGETS.find((item) => item.id === channelId)!;
    setBusy(`template:${channelId}`);
    setError("");
    try {
      const analysis = await analyzeTargetTemplate(await file.arrayBuffer(), {
        channelId,
        channelLabel: channel.label,
        fileName: file.name,
      });
      const missing = missingFullConversionFields(analysis);
      if (missing.length) {
        const labels: Record<string, string> = {
          sellerProductCode: "판매자 상품코드", price: "판매가", stock: "재고수량", mainImage: "대표 이미지",
          extraImages: "추가 이미지", detailContent: "상세페이지 HTML", infoNoticeGroup: "상품정보제공고시 상품군",
        };
        throw new Error(`이 파일은 전체 상품 등록 양식이 아닙니다. ${missing.map((field) => labels[field] ?? field).join(", ")} 열이 없어 변환하면 정보가 사라집니다. 각 채널의 '상품 등록' 빈 양식을 올려 주세요.`);
      }
      const saved = saveTemplate(analysis);
      if (!saved.ok) throw new Error(saved.message ?? "양식을 저장하지 못했습니다.");
      setTemplates((current) => ({ ...current, [channelId]: analysis }));
      setMessage(`${channel.label} 실제 양식을 저장했습니다. 다음 변환에도 자동으로 사용합니다.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "대상 양식을 읽지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function convert(channelId: string) {
    if (!sourceBuffer || !sourceFile || !sourceResult) {
      setError("먼저 상품 데이터가 들어 있는 원본 엑셀을 올려 주세요.");
      return;
    }
    const channel = TARGETS.find((item) => item.id === channelId)!;
    const targetTemplate = templates[channelId];
    if (!targetTemplate) {
      setError(`${channel.label} 등록 양식을 먼저 올려 주세요.`);
      return;
    }
    setBusy(`convert:${channelId}`);
    setError("");
    try {
      const result = await convertChannelWorkbook(sourceBuffer, {
        sourceFileName: sourceFile.name,
        targetTemplate,
        sourceRows: sourceResult.picked.rows,
      });
      downloadBytes(result.bytes, `${channel.label}_${safeName(sourceFile.name)}_${result.rowCount}개.${result.extension}`);
      setMessage(`${channel.label} 양식으로 상품 ${result.rowCount}개를 변환했습니다.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "변환하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <BackToDashboardLink />
        <span>담다 AI</span>
      </nav>

      <header className={styles.hero}>
        <p>CHANNEL EXCEL CONVERTER</p>
        <h1>한 채널의 상품 엑셀을<br/><em>다른 채널 양식으로.</em></h1>
        <span>네이버·쿠팡·카페24 중 어디에서 받은 파일이든 상품 정보를 읽어 원하는 채널 양식에 채웁니다.</span>
      </header>

      <section className={styles.panel}>
        <div className={styles.panelTitle}>
          <span>1</span>
          <div><h2>원본 상품 엑셀</h2><p>상품 데이터가 실제로 들어 있는 파일을 선택하세요. 채널은 자동으로 판별합니다.</p></div>
        </div>
        <label className={styles.sourceBox}>
          <span className={styles.fileIcon}>XLS</span>
          <span><b>{sourceFile?.name ?? "원본 엑셀 선택"}</b><small>{sourceResult ? `${sourceResult.picked.sheetName} 시트 · 상품 ${sourceResult.picked.rows.length}개` : "네이버·쿠팡·카페24 엑셀"}</small></span>
          <em>{busy === "source" ? "읽는 중…" : sourceFile ? "변경" : "선택"}</em>
          <input aria-label="원본 상품 엑셀 선택" type="file" accept=".xlsx,.xlsm,.xls" onChange={readSource} disabled={busy !== null} />
        </label>
        {sourceIssues.length > 0 && (
          <ul className={styles.issues}>{sourceIssues.map((issue, index) => <li className={styles[issue.level]} key={`${issue.message}-${index}`}>{issue.message}</li>)}</ul>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelTitle}>
          <span>2</span>
          <div><h2>받을 채널 선택</h2><p>처음 한 번만 각 관리자에서 받은 실제 상품 등록 양식을 올리면 다음부터 바로 변환됩니다.</p></div>
        </div>
        <div className={styles.targetGrid}>
          {TARGETS.map((channel) => {
            const template = templates[channel.id];
            const converting = busy === `convert:${channel.id}`;
            const templateBusy = busy === `template:${channel.id}`;
            const mapped = template?.columns.filter((column) => column.fieldId).length ?? 0;
            return (
              <article className={styles.targetCard} key={channel.id}>
                <div className={styles.targetHead}><span>{channel.label.slice(0, 1)}</span><div><h3>{channel.label}</h3><small>{template?.builtin ? "내장 참고 양식" : template?.fileName ?? "양식 없음"}</small></div></div>
                <p>{template ? `컬럼 ${template.columns.length}개 중 ${mapped}개 자동 연결` : "실제 등록 양식을 올려 주세요."}</p>
                {template?.builtin && <div className={styles.warning}>실제 등록 전 관리자에서 받은 공식 양식으로 교체하는 것을 권장합니다.</div>}
                <div className={styles.actions}>
                  <label>
                    {templateBusy ? "읽는 중…" : template?.builtin ? "실제 양식 올리기" : "양식 교체"}
                    <input aria-label={`${channel.label} 대상 양식 선택`} type="file" accept=".xlsx,.xlsm,.xls" onChange={(event) => readTargetTemplate(channel.id, event)} disabled={busy !== null} />
                  </label>
                  <button type="button" onClick={() => convert(channel.id)} disabled={!sourceResult || busy !== null}>
                    {converting ? "변환 중…" : `${channel.label}로 변환`}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {message && <p className={styles.success} role="status">{message}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.footer}>파일은 서버에 저장하거나 전송하지 않고 이 브라우저 안에서만 처리됩니다.</p>
    </main>
  );
}
