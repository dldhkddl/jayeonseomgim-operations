"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { CANONICAL_FIELDS, type CanonicalRow } from "../lib/channels/canonical";
import {
  CHANNELS,
  exportMappingJson,
  loadTemplates,
  removeTemplate,
  saveTemplate,
  type TemplateStore,
} from "../lib/channels/channels";
import {
  analyzeTemplate,
  buildFallbackWorkbook,
  fillTemplate,
  validateMapping,
  type ColumnMapping,
  type MappingIssue,
  type TemplateAnalysis,
} from "../lib/channels/mapping";
import { applyDefaults } from "../lib/channels/importer";
import { buildBuiltinTemplate } from "../lib/channels/builtin";
import ValueRulesPanel from "./ValueRules";
import {
  applyDomesticOriginFormat,
  applyValueRules,
  inspectValueRules,
  matchRules,
  type ValueRule,
} from "../lib/channels/valuemap";
import SellerDefaultsPanel from "./SellerDefaults";
import { countFilled, type SellerDefaults } from "../lib/channels/defaults";
import { isPubliclyReachable, uploadImages, urlToFile, type UploadedMedia } from "../lib/media";
import MarginCalculator from "./MarginCalculator";
import ExportPreview from "./ExportPreview";
import { orderedImages, productLabel, type Product } from "../lib/products";

type Props = {
  /** 목록에서 체크한 상품들. 이것만 엑셀로 나간다 */
  products: Product[];
  /** 이미지 업로드 결과 등을 상품에 되돌려 저장 */
  onUpdateProducts: (next: Product[]) => void;
  onNotice?: (message: string) => void;
  /** 상세페이지 PNG 캡처. 상품을 하나만 골랐을 때 상세 이미지로 함께 올린다 */
  onCaptureDetail?: () => Promise<string | null>;
};

function confidenceTone(c: ColumnMapping): "ok" | "check" | "none" {
  if (!c.fieldId) return "none";
  if (c.source === "manual" || c.confidence >= 0.85) return "ok";
  return "check";
}

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").trim() || "상품";

/**
 * 상품의 사진을 이미지 필드에 반영한다. 이미 값이 있으면 그대로 둔다.
 * images는 표지가 맨 앞에 오도록 정렬된 상태여야 한다 (orderedImages 결과).
 */
function withImages(data: CanonicalRow, images: string[]): CanonicalRow {
  if (!images.length) return data;
  const next = { ...data };
  if (!String(next.mainImage ?? "").trim()) next.mainImage = images[0];
  if (!String(next.extraImages ?? "").trim() && images.length > 1) next.extraImages = images.slice(1).join(",");
  return next;
}

export default function ChannelExcel({ products, onUpdateProducts, onNotice, onCaptureDetail }: Props) {
  const [channelId, setChannelId] = useState(CHANNELS[0].id);
  const [store, setStore] = useState<TemplateStore>(() => loadTemplates());
  const [analysis, setAnalysis] = useState<TemplateAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyCheck, setOnlyCheck] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [sellerDefaults, setSellerDefaults] = useState<SellerDefaults>({});
  const [uploading, setUploading] = useState(false);
  const [ignoreImageBlock, setIgnoreImageBlock] = useState(false);
  const [channelPrices, setChannelPrices] = useState<Record<string, number>>({});
  const [valueRules, setValueRules] = useState<ValueRule[]>([]);

  // 저장된 양식이 있으면 그걸 쓰고, 없으면 내장 기본 양식으로 바로 변환한다.
  // (양식 파일을 올리지 않아도 탭만 누르면 결과가 나오게)
  useEffect(() => {
    let alive = true;
    async function loadAnalysis() {
      await Promise.resolve();
      const saved = store[channelId];
      const next = saved ?? await buildBuiltinTemplate(
        channelId,
        CHANNELS.find((c) => c.id === channelId)?.label ?? channelId,
      );
      if (alive) setAnalysis(next);
    }
    void loadAnalysis().catch(() => {
      if (alive) setAnalysis(null);
    });
    return () => {
      alive = false;
    };
  }, [channelId, store]);

  const channel = CHANNELS.find((c) => c.id === channelId)!;

  const rows = useMemo<CanonicalRow[]>(() => {
    const base = products.map((p) => withImages(p.data, orderedImages(p)));
    const withDefaults = applyDefaults(base, sellerDefaults);
    // 채널별 표기로 치환 (카테고리 코드, 무료배송 표기 등)
    const converted = applyDomesticOriginFormat(applyValueRules(withDefaults, valueRules, channelId), channelId);
    const price = channelPrices[channelId];
    return price ? converted.map((r) => ({ ...r, price })) : converted;
  }, [products, sellerDefaults, valueRules, channelPrices, channelId]);

  const valueIssues = useMemo(
    () => (rows.length ? inspectValueRules(rows, valueRules, channelId, channel.label) : []),
    [rows, valueRules, channelId, channel.label],
  );

  // 채널 서버가 가져갈 수 없는 이미지 주소 (blob:, C:/..., localhost 등)
  const unreachableImages = useMemo(() => {
    const bad = new Set<string>();
    for (const r of rows) {
      for (const key of ["mainImage", "extraImages", "detailImage"] as const) {
        const raw = String(r[key] ?? "").trim();
        if (!raw) continue;
        for (const one of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
          if (!isPubliclyReachable(one)) bad.add(one);
        }
      }
    }
    return [...bad];
  }, [rows]);

  const issues: MappingIssue[] = useMemo(
    () => (analysis && rows.length ? validateMapping(analysis, rows) : []),
    [analysis, rows],
  );
  const imageBlocking = unreachableImages.length > 0 && !ignoreImageBlock;
  const blocking = issues.some((i) => i.level === "error") || imageBlocking;

  const mappedCount = analysis?.columns.filter((c) => c.fieldId).length ?? 0;
  const checkCount = analysis?.columns.filter((c) => confidenceTone(c) === "check").length ?? 0;
  const pendingImageCount = products.reduce(
    (n, p) => n + p.images.filter((src) => !isPubliclyReachable(src)).length,
    0,
  );

  async function onUploadTemplate(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const result = await analyzeTemplate(buf, { channelId, channelLabel: channel.label, fileName: file.name });
      const saved = saveTemplate(result);
      setAnalysis(result);
      setStore(loadTemplates());
      setExpanded(true);
      onNotice?.(
        saved.ok
          ? `${channel.label} 양식을 읽었습니다. ${result.columns.length}개 컬럼 중 ${result.columns.filter((c) => c.fieldId).length}개 자동 매칭.`
          : saved.message ?? "양식을 읽었지만 저장하지 못했습니다.",
      );
    } catch {
      onNotice?.("양식을 읽지 못했습니다. .xlsx 파일인지 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  /** 선택한 상품들의 사진을 인터넷에 올리고, 주소를 상품에 저장한다 */
  async function uploadSelectedImages() {
    if (!products.length) {
      onNotice?.("상품을 먼저 선택해 주세요.");
      return;
    }
    setUploading(true);
    try {
      const updated: Product[] = [];

      for (const p of products) {
        const local = p.images.filter((src) => !isPubliclyReachable(src));
        if (!local.length) continue;
        const files = await Promise.all(
          local.map((src, i) => urlToFile(src, `${safeName(productLabel(p))}-${i === 0 ? "대표" : i}.png`)),
        );
        const result: UploadedMedia[] = await uploadImages(files);

        // 로컬 사진을 올라간 주소로 교체 (순서 유지). 표지/상세 태그가 있던 사진이면 새 주소로 태그도 옮긴다.
        let n = 0;
        const renamed = new Map<string, string>();
        const nextImages = p.images.map((src) => {
          if (isPubliclyReachable(src)) return src;
          const url = result[n++]?.url ?? src;
          if (url !== src) renamed.set(src, url);
          return url;
        });
        const nextRoles = { ...(p.imageRoles ?? {}) };
        for (const [oldSrc, newUrl] of renamed) {
          if (nextRoles[oldSrc]) {
            nextRoles[newUrl] = nextRoles[oldSrc];
            delete nextRoles[oldSrc];
          }
        }
        const ordered = orderedImages({ images: nextImages, imageRoles: nextRoles });
        updated.push({
          ...p,
          images: nextImages,
          imageRoles: nextRoles,
          data: { ...p.data, mainImage: ordered[0], extraImages: ordered.slice(1).join(",") },
        });
      }

      // 상품을 하나만 골랐을 때만 상세페이지를 함께 올린다 (어느 상품 것인지 명확하므로)
      if (products.length === 1 && onCaptureDetail) {
        const dataUrl = await onCaptureDetail();
        if (dataUrl) {
          const file = await urlToFile(dataUrl, `${safeName(productLabel(products[0]))}-상세페이지.png`);
          const [detail] = await uploadImages([file]);
          if (detail) {
            const target = updated.find((u) => u.id === products[0].id) ?? { ...products[0] };
            const merged = { ...target, data: { ...target.data, detailImage: detail.url } };
            const i = updated.findIndex((u) => u.id === merged.id);
            if (i >= 0) updated[i] = merged;
            else updated.push(merged);
          }
        }
      }

      if (!updated.length) {
        onNotice?.("이미 전부 올라간 사진입니다.");
        return;
      }
      onUpdateProducts(updated);
      setIgnoreImageBlock(false);
      onNotice?.(`상품 ${updated.length}개의 사진을 올렸습니다. 주소가 엑셀 이미지 칸에 들어갑니다.`);
    } catch (err) {
      onNotice?.(err instanceof Error ? err.message : "이미지 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  }

  function updateColumn(col: number, fieldId: string) {
    if (!analysis) return;
    const next: TemplateAnalysis = {
      ...analysis,
      columns: analysis.columns.map((c) =>
        c.col === col ? { ...c, fieldId: fieldId || null, confidence: fieldId ? 1 : 0, source: fieldId ? "manual" : "none" } : c,
      ),
    };
    setAnalysis(next);
    saveTemplate(next);
  }

  function forget() {
    removeTemplate(channelId);
    setStore(loadTemplates());
    setAnalysis(null);
    onNotice?.(`${channel.label} 양식을 삭제했습니다.`);
  }

  async function exportExcel() {
    if (!analysis) return;
    setBusy(true);
    try {
      const bytes = await fillTemplate(analysis, rows, { clearSampleRows: true });
      const base = products.length === 1 ? safeName(productLabel(products[0])) : `상품${products.length}개`;
      downloadBytes(bytes, `${channel.label}_${base}_대량등록.xlsx`);
      onNotice?.(`${channel.label} 양식에 ${rows.length}개 행을 채워 저장했습니다.`);
    } catch (err) {
      onNotice?.(err instanceof Error ? err.message : "엑셀 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function exportFallback() {
    setBusy(true);
    try {
      const fieldIds = CANONICAL_FIELDS.filter((f) => rows.some((r) => String(r[f.id] ?? "").trim() !== "")).map((f) => f.id);
      const bytes = await buildFallbackWorkbook(rows, fieldIds);
      downloadBytes(bytes, `공통상품정보_${rows.length}개.xlsx`);
      onNotice?.("공통 상품정보 엑셀을 저장했습니다. 채널 양식을 올리면 채널 형식으로 변환됩니다.");
    } finally {
      setBusy(false);
    }
  }

  function downloadMapping() {
    if (!analysis) return;
    const url = URL.createObjectURL(new Blob([exportMappingJson(analysis)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${channel.label}_매핑표.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const visibleColumns = (analysis?.columns ?? []).filter((c) => (onlyCheck ? confidenceTone(c) !== "ok" : true));

  return (
    <section className="chx">
      <div className="chxHead">
        <div>
          <span>03</span>
          <h2>채널별 등록 엑셀</h2>
        </div>
        <small>
          {products.length ? `선택한 상품 ${products.length}개를 내보냅니다` : "위 목록에서 상품을 선택하세요"}
        </small>
      </div>

      {/* 기본값·마진 계산기는 상품을 고르기 전에도 쓸 수 있어야 한다 */}
      <SellerDefaultsPanel value={sellerDefaults} onChange={setSellerDefaults} onNotice={onNotice} />

      <ValueRulesPanel
        value={valueRules}
        onChange={setValueRules}
        activeChannelId={channelId}
        // 규칙에 걸리는 실제 상품명을 넘긴다. "사과"보다 "포항 산지직송 부사 사과 3kg"이 추천 정확도가 높다
        sampleFor={(rule) => {
          const hit = products.find((p) => matchRules(p.data, [rule], channelId).length > 0);
          return hit ? String(hit.data.productName ?? "") : undefined;
        }}
        onNotice={onNotice}
      />

      <MarginCalculator
        key={`${products[0]?.id ?? "none"}:${products[0]?.data.price ?? ""}`}
        currentPrice={products[0]?.data.price}
        taxFree={String(sellerDefaults.taxType ?? products[0]?.data.taxType ?? "면세").includes("면세")}
        appliedPrices={channelPrices}
        onApplyPrice={(id, p) => setChannelPrices((prev) => ({ ...prev, [id]: p }))}
        onNotice={onNotice}
      />

      {!products.length ? (
        <div className="chxEmpty">
          <p>
            <b>상품 목록에서 내보낼 상품을 체크</b>해 주세요. 여러 개를 한 번에 고를 수 있습니다.
          </p>
          <small>체크한 상품만 엑셀에 들어갑니다. 위 마진 계산기는 지금도 쓸 수 있습니다.</small>
        </div>
      ) : (
        <>
          <div className="imgBox">
            <div className="imgBoxTop">
              <div>
                <b>이미지 주소</b>
                <small>
                  {pendingImageCount
                    ? `아직 안 올린 사진 ${pendingImageCount}장 — 채널은 파일이 아니라 인터넷 주소를 받습니다`
                    : "선택한 상품의 사진이 모두 올라가 있습니다"}
                </small>
              </div>
              <div className="chxCardBtns">
                <button className="secondary" onClick={uploadSelectedImages} disabled={uploading || !pendingImageCount}>
                  {uploading ? "올리는 중…" : "사진 인터넷에 올리기"}
                </button>
              </div>
            </div>

            {unreachableImages.length > 0 && (
              <div className="imgWarn">
                <p>
                  채널이 가져갈 수 없는 이미지 주소가 <b>{unreachableImages.length}개</b> 있습니다. 이대로 등록하면 이미지가 안 보이거나 반려됩니다.
                </p>
                <code>{unreachableImages[0]}</code>
                <label>
                  <input type="checkbox" checked={ignoreImageBlock} onChange={(e) => setIgnoreImageBlock(e.target.checked)} />
                  확인했습니다. 그래도 내보내기
                </label>
              </div>
            )}
          </div>

          <div className="chxTabs">
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                className={c.id === channelId ? "on" : ""}
                onClick={() => {
                  setChannelId(c.id);
                  setExpanded(false);
                  setAnalysis(null);
                }}
              >
                {c.label}
                {store[c.id] && <i aria-label="양식 등록됨" />}
              </button>
            ))}
          </div>

          {!analysis ? (
            <>
              <div className="chxEmpty">
                <p>
                  <b>{channel.label} 대량등록 엑셀 양식</b>을 올려 주세요. 컬럼 이름을 읽어 상품 정보와 자동으로 짝지어 둡니다.
                </p>
                <small>{channel.hint}</small>
                <div className="chxEmptyActions">
                  <label className="chxUpload">
                    {busy ? "읽는 중…" : "양식 파일 올리기"}
                    <input type="file" accept=".xlsx,.xlsm,.xls" onChange={onUploadTemplate} disabled={busy} />
                  </label>
                  <button className="secondary" onClick={exportFallback} disabled={busy}>
                    공통 정보만 먼저 받기
                  </button>
                </div>
              </div>
              <ExportPreview rows={rows} label="공통 상품정보" />
            </>
          ) : (
            <>
              <div className={`chxCard ${analysis.builtin ? "builtin" : ""}`}>
                <div className="chxCardTop">
                  <div>
                    <b>
                      {analysis.fileName}
                      {analysis.builtin && <i className="chxBadge">연습용</i>}
                    </b>
                    <small>
                      시트 {analysis.sheetName} · 헤더 {analysis.headerRow + 1}행 · 컬럼 {analysis.columns.length}개 중 {mappedCount}개 매핑
                      {checkCount > 0 && <em> · 확인 필요 {checkCount}</em>}
                    </small>
                  </div>
                  <div className="chxCardBtns">
                    <button className="linkBtn" onClick={() => setExpanded((v) => !v)}>
                      {expanded ? "매핑 접기" : "매핑 확인"}
                    </button>
                    <label className={`linkBtn asLabel ${analysis.builtin ? "accent" : ""}`}>
                      {analysis.builtin ? "실제 양식 올리기" : "양식 교체"}
                      <input type="file" accept=".xlsx,.xlsm,.xls" onChange={onUploadTemplate} disabled={busy} />
                    </label>
                    {!analysis.builtin && (
                      <button className="linkBtn danger" onClick={forget}>
                        기본값으로 되돌리기
                      </button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="chxMap">
                    <div className="chxMapBar">
                      <label>
                        <input type="checkbox" checked={onlyCheck} onChange={(e) => setOnlyCheck(e.target.checked)} />
                        확인 필요한 컬럼만 보기
                      </label>
                      <button className="linkBtn" onClick={downloadMapping}>
                        매핑표 JSON 저장
                      </button>
                    </div>
                    <div className="chxMapList">
                      {visibleColumns.map((c) => {
                        const tone = confidenceTone(c);
                        return (
                          <div className={`chxMapRow ${tone}`} key={c.col}>
                            <span className="chxCol" title={c.header}>
                              {c.header || `(빈 헤더 ${c.col + 1})`}
                            </span>
                            <select value={c.fieldId ?? ""} onChange={(e) => updateColumn(c.col, e.target.value)}>
                              <option value="">— 비워둠 —</option>
                              {CANONICAL_FIELDS.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.group} · {f.label}
                                </option>
                              ))}
                            </select>
                            <b className={tone}>{tone === "ok" ? "확정" : tone === "check" ? "확인" : "미사용"}</b>
                          </div>
                        );
                      })}
                      {!visibleColumns.length && <p className="chxNone">확인이 필요한 컬럼이 없습니다.</p>}
                    </div>
                  </div>
                )}
              </div>

              <div className="chxRowInfo">
                <span className="chxSourceTag">상품 {products.length}개 선택됨</span>
                <p>
                  내보낼 행 <b>{rows.length}개</b>
                  {countFilled(sellerDefaults) > 0 && <span> · 기본값 {countFilled(sellerDefaults)}개 적용</span>}
                  {channelPrices[channelId] && (
                    <span className="chxPriced"> · {channel.label} 판매가 {channelPrices[channelId].toLocaleString()}원</span>
                  )}
                </p>
              </div>

              <ExportPreview columns={analysis.columns} rows={rows} label={`${channel.label} 양식`} />

              {analysis.builtin && (
                <p className="chxBuiltinWarn">
                  지금은 앱에 내장된 <b>연습용 양식</b>으로 변환하고 있습니다. 컬럼 이름이 실제와 조금 다를 수 있어
                  이 파일 그대로 올리면 반려될 수 있습니다. {channel.hint}에서 받은 양식을 올리면 정확해집니다.
                </p>
              )}

              {[...valueIssues, ...issues].length > 0 && (
                <ul className="chxIssues">
                  {[...valueIssues, ...issues].map((i, n) => (
                    <li key={n} className={i.level}>
                      {i.level === "error" ? "막힘" : "주의"} · {i.message}
                    </li>
                  ))}
                </ul>
              )}

              <button className="primary full" onClick={exportExcel} disabled={busy || blocking}>
                {busy ? "만드는 중…" : `${channel.label} 등록 엑셀 내려받기`}
              </button>
              {blocking && (
                <p className="chxBlocked">
                  {imageBlocking
                    ? "이미지 주소가 채널에서 열리지 않는 형태입니다. 사진을 인터넷에 올리거나, 위에서 확인 체크를 해 주세요."
                    : "필수 항목이 비어 있어 내보내기를 막았습니다. 위 항목을 채운 뒤 다시 시도해 주세요."}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
