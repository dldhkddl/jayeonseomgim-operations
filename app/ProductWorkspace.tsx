"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import ChannelExcel from "./components/ChannelExcel";
import DetailBuilder from "./components/DetailBuilder";
import NaverCategoryPicker from "./components/NaverCategoryPicker";
import NaverCertificationFields from "./components/NaverCertificationFields";
import NaverUnitPriceFields from "./components/NaverUnitPriceFields";
import ProductList from "./components/ProductList";
import PremiumDetailPage from "./components/PremiumDetailPage";
import ProductGalleryPreview from "./components/ProductGalleryPreview";
import ProductWorkspaceHeader from "./components/ProductWorkspaceHeader";
import {
  addProductImages,
  applyEditorFields,
  detailPageImages,
  duplicateCodeGroups,
  duplicateProduct,
  effectiveImageRole,
  loadProducts,
  moveProductImage,
  newProduct,
  orderedImages,
  productLabel,
  productImageLabel,
  productsFromRows,
  removeMany,
  saveProducts,
  toEditorFields,
  toggleProductImageRole,
  upsert,
  type EditorFields,
  type ImageRole,
  type Product,
} from "./lib/products";
import { loadSharedProducts, saveSharedProducts } from "./lib/shared-product-storage";
import { importFilledWorkbook } from "./lib/channels/importer";
import type { CanonicalRow } from "./lib/channels/canonical";
import { isPubliclyReachable, uploadImages } from "./lib/media";
import { parseQuickCommand } from "./lib/quickCommand";
import { findTemplates, saveProductAsTemplate, type RankedTemplate } from "./lib/templates";
import { buildDetailHtml, existingDetailContent } from "./lib/channels/detail";
import { resolveDetailPreviewHtml } from "./lib/detail-editor";
import { recommendedProductTitle, resolveNaverContactPhone, resolveNaverProductTitle, resolveUnitPriceFields, validateNaverRegistration } from "./lib/naverRegistrationValidation";
import { extractDetailTheme, fallbackDetailTheme, premiumImageSlots } from "./lib/premiumDetail";
import { formatRegistrationError } from "./lib/registrationError";
import { loadSellerDefaults } from "./lib/channels/defaults";
import { applyNaverImportedDetails, type NaverImportedDetails } from "./lib/naverProductImport";

const EMPTY_FIELDS: EditorFields = {
  name: "", variety: "", origin: "", weight: "", price: "",
  stock: "", shipping: "", producer: "", storage: "", feature: "",
};

const SAMPLE: EditorFields = {
  name: "포항 산지직송 햇사과", variety: "부사", origin: "경상북도 포항시",
  weight: "3kg + 3kg", price: "39,900", stock: "100", shipping: "무료배송",
  producer: "명성농산", storage: "수령 후 냉장 보관", feature: "아삭한 식감, 풍부한 과즙, 산지에서 바로 발송",
};

const fields: { key: keyof EditorFields; label: string }[] = [
  { key: "name", label: "상품 기본명" }, { key: "variety", label: "품종" },
  { key: "origin", label: "원산지" }, { key: "producer", label: "생산자·판매자" },
  { key: "weight", label: "중량·구성" }, { key: "price", label: "판매가(원)" },
  { key: "stock", label: "재고" }, { key: "shipping", label: "배송 조건" },
  { key: "storage", label: "보관 방법" }, { key: "feature", label: "상품 특징" },
];

async function urlToFile(url: string, name: string): Promise<File> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "image/png" });
}

type CapacityRow = {
  id: string; label: string; prompt: string; refIndex: number;
  status: "idle" | "generating" | "done" | "error";
  resultUrl?: string; error?: string;
};

let rowSeq = 0;
function newCapacityRow(refIndex: number): CapacityRow {
  rowSeq += 1;
  return { id: `row-${rowSeq}`, label: "", prompt: "", refIndex, status: "idle" };
}

export default function ProductWorkspace() {
  // ── 상품 목록이 화면의 중심 ──────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState(false);

  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [notice, setNotice] = useState("");
  const detailPageRef = useRef<HTMLDivElement>(null);
  const detailEditorRef = useRef<HTMLDivElement>(null);
  const draggedImageIndexRef = useRef<number | null>(null);
  const productCodeInputRef = useRef<HTMLInputElement>(null);
  const [productCodeFocusRequest, setProductCodeFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [detailEditorOpenRequest, setDetailEditorOpenRequest] = useState(0);
  const [detailPreviewDraft, setDetailPreviewDraft] = useState<{ productId: string; html: string } | null>(null);

  const [registering, setRegistering] = useState(false);
  const [registeringCafe24, setRegisteringCafe24] = useState(false);
  const [capacityRows, setCapacityRows] = useState<CapacityRow[]>([newCapacityRow(0)]);

  const [autoImage, setAutoImage] = useState<{
    refIndex: number;
    prompt: string;
    status: "idle" | "generating" | "error";
    error?: string;
  }>({ refIndex: 0, prompt: "", status: "idle" });

  // ── 상품 템플릿 (서버 저장, "빠른 명령"이 찾아 씀) ──────────────────────
  const [templateName, setTemplateName] = useState("");
  const [templateAliases, setTemplateAliases] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  const [quickText, setQuickText] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickCandidates, setQuickCandidates] = useState<{
    parsed: ReturnType<typeof parseQuickCommand>;
    list: RankedTemplate[];
  } | null>(null);
  const [quickPreview, setQuickPreview] = useState<{
    parsed: ReturnType<typeof parseQuickCommand>;
    match: RankedTemplate;
    row: CanonicalRow;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const stored = loadProducts();
    setProducts(stored);
    void loadSharedProducts(stored).then((shared) => {
      if (!active) return;
      setProducts(shared);
      saveProducts(shared);
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  /**
   * blob:/data: 사진(아직 저장소에 안 올라간 것)은 새로고침·재접속하면 사라진다.
   * 이 상태로 창을 닫으려 하면 브라우저가 직접 경고하게 만든다 — "일정 시간 지나면 사진이 사라진다"는
   * 사고를 사후 설명이 아니라 그 순간에 막기 위해서다.
   */
  const unsavedImageCount = products.reduce(
    (n, p) => n + p.images.filter((src) => !isPubliclyReachable(src)).length,
    0,
  );
  const unsavedImageCountRef = useRef(0);
  unsavedImageCountRef.current = unsavedImageCount;
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (unsavedImageCountRef.current > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // 편집 대상이 바뀌면 템플릿 저장 입력칸도 그 상품 이름으로 다시 채운다
  useEffect(() => {
    const p = products.find((x) => x.id === editingId);
    setTemplateName(String(p?.data.productName ?? ""));
    setTemplateAliases("");
    setDetailPreviewDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  /** 목록이 바뀌면 곧바로 저장한다. 새로고침해도 남는다. */
  function commit(next: Product[], message?: string) {
    setProducts(next);
    const result = saveProducts(next);
    if (!result.ok && result.message) setNotice(result.message);
    else if (message) setNotice(message);
    void saveSharedProducts(next).catch(() => {
      setNotice("이 창에는 저장했지만 공용 상품 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    });
  }

  const editing = products.find((p) => p.id === editingId) ?? null;
  const product = editing ? toEditorFields(editing.data) : EMPTY_FIELDS;
  const images = editing?.images ?? [];
  /** 표지 사진이 맨 앞, 상세 사진이 그다음에 오도록 정렬 (태그 없으면 원래 순서) */
  const displayImages = editing ? orderedImages(editing) : images;
  const representativeImage = displayImages[0] ?? "";
  const premiumImages = editing ? detailPageImages(editing) : [];
  const detailDefaults = loaded ? loadSellerDefaults() : {};
  const detailPreviewHtml = editing
    ? resolveDetailPreviewHtml(
        existingDetailContent(editing.data),
        detailPreviewDraft?.productId === editing.id ? detailPreviewDraft.html : undefined,
      )
    : null;
  const detailTheme = useMemo(
    () => editing?.detailTheme ?? fallbackDetailTheme(product.name),
    [editing?.detailTheme, product.name],
  );
  const selectedProducts = products.filter((p) => selectedIds.includes(p.id));
  const duplicateProductCodeGroups = useMemo(() => duplicateCodeGroups(products), [products]);
  const duplicateProductCodeIds = useMemo(
    () => new Set(duplicateProductCodeGroups.flatMap((group) => group.productIds)),
    [duplicateProductCodeGroups],
  );
  const editingHasDuplicateCode = editing ? duplicateProductCodeIds.has(editing.id) : false;
  const unitPriceFields = resolveUnitPriceFields({
    ...editing?.data,
    weight: product.weight,
  });
  const naverIssues = editing
    ? validateNaverRegistration({
        title: editing.data.productName,
        category: editing.data.category,
        sellerProductCode: editing.data.sellerProductCode,
        price: editing.data.price,
        stock: editing.data.stock,
        origin: editing.data.origin,
        imageCount: displayImages.length,
        greenCertificationId: editing.data.greenCertificationId,
        greenCertificationName: editing.data.greenCertificationName,
        greenCertificationNumber: editing.data.greenCertificationNumber,
        ...unitPriceFields,
      })
    : [];

  useEffect(() => {
    if (!editingId) return;
    const fallback = fallbackDetailTheme(product.name);
    let cancelled = false;
    void extractDetailTheme(representativeImage, fallback).then((theme) => {
      if (cancelled) return;
      setProducts((current) => {
        const target = current.find((item) => item.id === editingId);
        if (!target || JSON.stringify(target.detailTheme) === JSON.stringify(theme)) return current;
        const next = upsert(current, { ...target, detailTheme: theme });
        saveProducts(next);
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [editingId, representativeImage, product.name]);

  useEffect(() => {
    if (!editingId || productCodeFocusRequest?.id !== editingId) return;
    const frame = window.requestAnimationFrame(() => {
      productCodeInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      productCodeInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingId, productCodeFocusRequest]);

  // ── 상품 조작 ──────────────────────────────────────────────────────────
  function createProduct() {
    const p = newProduct();
    const seeded = { ...p, data: applyEditorFields(p.data, products.length ? EMPTY_FIELDS : SAMPLE) };
    commit(upsert(products, seeded));
    setEditingId(seeded.id);
    setSelectedIds((prev) => [...prev, seeded.id]);
    setTab("edit");
  }

  function duplicate(id: string) {
    const src = products.find((p) => p.id === id);
    if (!src) return;
    const copy = duplicateProduct(src);
    commit(upsert(products, copy), `"${productLabel(src)}"를 복제했습니다. 상품코드는 비워 뒀습니다.`);
    setEditingId(copy.id);
  }

  function fixDuplicateCode(id: string) {
    setEditingId(id);
    setTab("edit");
    setProductCodeFocusRequest({ id, nonce: Date.now() });
  }

  function remove(ids: string[]) {
    commit(removeMany(products, ids), `상품 ${ids.length}개를 삭제했습니다.`);
    setSelectedIds((prev) => prev.filter((x) => !ids.includes(x)));
    if (editingId && ids.includes(editingId)) setEditingId(null);
  }

  function updateField(key: keyof EditorFields, value: string) {
    if (!editing) return;
    const next = { ...editing, data: applyEditorFields(editing.data, { ...product, [key]: value }) };
    commit(upsert(products, next));
  }

  function updateProductData(patch: Partial<CanonicalRow>) {
    if (!editing) return;
    commit(upsert(products, { ...editing, data: { ...editing.data, ...patch } }));
  }

  function setImages(updater: (prev: string[]) => string[]) {
    if (!editing) return;
    commit(upsert(products, { ...editing, images: updater(editing.images) }));
  }

  /**
   * 지금 편집 중인 상품의 사진을 이 프로그램 저장소(R2)에 올린다.
   * 채널·템플릿·빠른 명령이 전부 이 주소를 써야 해서, 사진을 다루는 화면 바로 여기에 버튼을 둔다.
   */
  async function uploadCurrentPhotos() {
    if (!editing) return;
    const local = editing.images.filter((src) => !isPubliclyReachable(src));
    if (!local.length) { setNotice("이미 전부 저장소에 올라간 사진입니다."); return; }
    setUploadingPhotos(true);
    try {
      const files = await Promise.all(local.map((src, i) => urlToFile(src, `${product.name || "상품"}-${i === 0 ? "대표" : i}.png`)));
      const uploaded = await uploadImages(files);
      let n = 0;
      const renamed = new Map<string, string>();
      const nextImages = editing.images.map((src) => {
        if (isPubliclyReachable(src)) return src;
        const url = uploaded[n++]?.url ?? src;
        if (url !== src) renamed.set(src, url);
        return url;
      });
      const nextRoles = { ...(editing.imageRoles ?? {}) };
      for (const [oldSrc, newUrl] of renamed) {
        if (nextRoles[oldSrc]) { nextRoles[newUrl] = nextRoles[oldSrc]; delete nextRoles[oldSrc]; }
      }
      commit(upsert(products, { ...editing, images: nextImages, imageRoles: nextRoles }));
      setNotice(`사진 ${uploaded.length}장을 저장소에 올렸습니다. 이제 템플릿 저장·채널 내보내기에 쓸 수 있습니다.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "사진을 올리지 못했습니다.");
    } finally {
      setUploadingPhotos(false);
    }
  }

  /** 대표는 한 장만 지정하고 상세 사진은 각각 독립적으로 선택·해제한다. */
  function setImageRole(src: string, role: ImageRole) {
    if (!editing) return;
    const nextImageState = toggleProductImageRole(editing, src, role);
    commit(upsert(products, { ...editing, ...nextImageState }));
  }

  function moveImage(fromIndex: number, toIndex: number) {
    if (!editing) return;
    const nextImageState = moveProductImage(editing, fromIndex, toIndex);
    commit(upsert(products, { ...editing, ...nextImageState }));
  }

  /** 이미지 업로드 등으로 바뀐 상품들을 목록에 반영 */
  function applyProductUpdates(updated: Product[]) {
    let next = products;
    for (const p of updated) next = upsert(next, p);
    commit(next);
  }

  function openDetailEditorFromPreview() {
    setTab("edit");
    setDetailEditorOpenRequest((value) => value + 1);
    requestAnimationFrame(() => {
      const editor = detailEditorRef.current;
      editor?.scrollIntoView({ behavior: "smooth", block: "start" });
      editor?.querySelector<HTMLButtonElement>(".dbdHead")?.focus();
    });
  }

  async function importExcel(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const result = await importFilledWorkbook(await file.arrayBuffer(), { fileName: file.name });
      let importedRows = result.picked.rows;
      const channelProductNos = importedRows
        .filter((row) => !String(row.detailContent ?? "").trim())
        .map((row) => String(row.channelProductNo ?? "").trim())
        .filter((value) => /^\d+$/.test(value));
      let importedDetailCount = 0;
      let failedDetailCount = 0;
      let detailFailureMessage = "";

      if (channelProductNos.length) {
        try {
          const response = await fetch("/api/naver/import-details", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelProductNos }),
          });
          const data = await response.json() as {
            details?: Record<string, NaverImportedDetails>;
            failed?: unknown[];
            error?: string;
            stage?: string;
            detail?: unknown;
          };
          if (!response.ok) {
            detailFailureMessage = formatRegistrationError("네이버", response.status, data);
            throw new Error(detailFailureMessage);
          }
          importedRows = applyNaverImportedDetails(importedRows, data.details ?? {});
          importedDetailCount = Object.keys(data.details ?? {}).length;
          failedDetailCount = data.failed?.length ?? 0;
        } catch (error) {
          failedDetailCount = channelProductNos.length;
          if (!detailFailureMessage) {
            detailFailureMessage = formatRegistrationError("네이버", 0, {
              error: error instanceof Error ? error.message : "",
            });
          }
        }
      }

      const incoming = productsFromRows(importedRows);
      const next = [...products, ...incoming];
      const detailMessage = channelProductNos.length
        ? ` · 기존 상세 ${importedDetailCount}개 불러옴${failedDetailCount ? `, ${failedDetailCount}개 조회 실패${detailFailureMessage ? ` (${detailFailureMessage})` : ""}` : ""}`
        : "";
      commit(next, `${file.name}에서 상품 ${incoming.length}개를 목록에 담았습니다${detailMessage}.`);
      setSelectedIds((prev) => [...prev, ...incoming.map((p) => p.id)]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "엑셀을 읽지 못했습니다.");
    } finally {
      setImporting(false);
    }
  }

  // ── AI 이미지 ──────────────────────────────────────────────────────────
  function addCapacityRow() {
    setCapacityRows((rows) => [...rows, newCapacityRow(0)]);
  }
  function removeCapacityRow(id: string) {
    setCapacityRows((rows) => rows.filter((r) => r.id !== id));
  }
  function updateCapacityRow(id: string, patch: Partial<CapacityRow>) {
    setCapacityRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function generateCapacityImage(id: string) {
    const row = capacityRows.find((r) => r.id === id);
    if (!row) return;
    if (!row.prompt.trim()) { setNotice("프롬프트를 입력해 주세요."); return; }
    const refSrc = images[row.refIndex];
    if (!refSrc) { setNotice("참조할 사진이 없습니다."); return; }

    updateCapacityRow(id, { status: "generating", error: undefined });
    try {
      const refFile = await urlToFile(refSrc, "reference.png");
      const form = new FormData();
      form.append("prompt", row.prompt);
      form.append("image", refFile);
      const res = await fetch("/api/ai/generate-image", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "이미지 생성에 실패했습니다.");
      updateCapacityRow(id, { status: "done", resultUrl: data.imageDataUrl });
    } catch (err) {
      updateCapacityRow(id, { status: "error", error: err instanceof Error ? err.message : "이미지 생성에 실패했습니다." });
    }
  }

  function addCapacityResultToGallery(id: string) {
    const row = capacityRows.find((r) => r.id === id);
    if (!row?.resultUrl) return;
    setImages((prev) => (prev.length >= 10 ? prev : [...prev, row.resultUrl!]));
    setNotice(`${row.label || "생성 이미지"}를 상품 사진에 추가했습니다.`);
  }

  /**
   * 참조 사진 한 장 + 느낌 프롬프트로 표지용·상세용 사진을 한 번에 만들어
   * 곧바로 갤러리에 넣고 역할을 태그한다 (수동으로 "추가" 누를 필요 없음).
   * 원산지·품종처럼 이미 입력된 사실만 프롬프트에 넣는다 — 없는 사실은 만들지 않는다.
   */
  async function generateCoverAndDetailImages() {
    if (premiumImageSlots(images.length).length) return generatePremiumSceneImages();
    if (!editing) return;
    if (!autoImage.prompt.trim()) { setNotice("사진 느낌을 적어 주세요. 예: 흐르는 과즙, 잘라진 단면"); return; }
    const refSrc = images[autoImage.refIndex];
    if (!refSrc) { setNotice("참조할 사진이 없습니다. 먼저 사진을 한 장 올려 주세요."); return; }

    setAutoImage((s) => ({ ...s, status: "generating", error: undefined }));
    try {
      const refFile = await urlToFile(refSrc, "reference.png");
      const known = [product.name, product.variety, product.origin].filter(Boolean).join(" ");
      const jobs: { role: ImageRole; prompt: string; label: string }[] = [
        {
          role: "cover",
          label: "표지",
          prompt: `${known} 상품의 표지(대표) 사진. ${autoImage.prompt}. 상품 전체가 한눈에 보이도록, 배경은 깔끔하게.`,
        },
        {
          role: "detail",
          label: "상세",
          prompt: `${known} 상품의 상세 클로즈업 사진. ${autoImage.prompt}. 질감과 디테일이 잘 보이도록.`,
        },
      ];

      const results: { role: ImageRole; url: string }[] = [];
      for (const job of jobs) {
        const form = new FormData();
        form.append("prompt", job.prompt);
        form.append("image", refFile);
        const res = await fetch("/api/ai/generate-image", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `${job.label} 사진 생성에 실패했습니다.`);
        results.push({ role: job.role, url: data.imageDataUrl });
      }

      const nextImages = [...images, ...results.map((r) => r.url)].slice(0, 10);
      const nextRoles = { ...(editing.imageRoles ?? {}) };
      for (const r of results) {
        if (r.role === "cover") {
          for (const key of Object.keys(nextRoles)) if (nextRoles[key] === "cover") delete nextRoles[key];
        }
        nextRoles[r.url] = r.role;
      }
      commit(upsert(products, { ...editing, images: nextImages, imageRoles: nextRoles }));
      setAutoImage((s) => ({ ...s, status: "idle" }));
      setNotice("표지·상세 사진을 만들어 상품 사진에 넣었습니다.");
    } catch (err) {
      setAutoImage((s) => ({ ...s, status: "error", error: err instanceof Error ? err.message : "생성에 실패했습니다." }));
    }
  }

  // ── 네이버 ─────────────────────────────────────────────────────────────
  async function generatePremiumSceneImages() {
    if (!editing) return;
    const refSrc = images[autoImage.refIndex] ?? images[0];
    if (!refSrc) { setNotice("먼저 기준이 될 상품 사진을 한 장 올려 주세요."); return; }
    const slots = premiumImageSlots(images.length).slice(0, Math.max(0, 10 - images.length));
    if (!slots.length) { setNotice("프리미엄 상세페이지에 필요한 연출 사진이 모두 준비됐습니다."); return; }

    setAutoImage((state) => ({ ...state, status: "generating", error: undefined }));
    try {
      const refFile = await urlToFile(refSrc, "premium-reference.png");
      const known = [product.name, product.variety, product.origin, product.weight].filter(Boolean).join(" ");
      const generated: string[] = [];
      for (const slot of slots) {
        const form = new FormData();
        form.append("prompt", `${known} 상품과 동일한 실제 상품을 참고한 ${slot.prompt}. ${autoImage.prompt.trim()} 과장된 문구나 글자는 넣지 않고 상품 사진만 자연스럽게 표현.`);
        form.append("image", refFile);
        const response = await fetch("/api/ai/generate-image", { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `${slot.label} 생성에 실패했습니다.`);
        generated.push(data.imageDataUrl);
      }
      const nextImages = [...images, ...generated];
      const nextRoles = { ...(editing.imageRoles ?? {}) };
      for (const src of generated) nextRoles[src] = "detail";
      commit(upsert(products, { ...editing, images: nextImages, imageRoles: nextRoles }));
      setAutoImage((state) => ({ ...state, status: "idle" }));
      setNotice(`부족했던 프리미엄 연출 사진 ${generated.length}장을 추가했습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "연출 사진 생성에 실패했습니다.";
      setAutoImage((state) => ({ ...state, status: "error", error: message }));
      setNotice(message);
    }
  }

  /** CanonicalRow에 있는 사실만으로 네이버 등록 폼 값을 만든다. 없는 값은 지어내지 않고 빈 문자열로 둔다. */
  function naverFieldsFromRow(row: CanonicalRow) {
    const origin = String(row.origin ?? "");
    const variety = String(row.variety ?? "");
    const weight = String(row.weightSpec ?? "");
    const shipping = String(row.deliveryFeeType ?? "");
    const producer = String(row.manufacturer ?? "");
    const storage = String(row.storage ?? "");
    const feature = String(row.feature ?? "");
    const title = resolveNaverProductTitle({ productName: row.productName, origin, variety, weight, shipping });
    const summary = `${origin}에서 정성껏 기른 ${variety}입니다. ${feature}을 한 상자에 담아 보내드립니다.`.trim();
    return {
      title, summary, origin, weight, storage, shipping, producer, feature,
      price: String(row.price ?? ""), stock: String(row.stock ?? ""),
    };
  }

  /** 상품 하나를 네이버 스마트스토어에 바로 등록한다. 편집 화면 밖(빠른 명령)에서도 쓸 수 있게 상품을 인자로 받는다. */
  async function registerProductToNaver(p: Product): Promise<{ ok: boolean; productNo?: string; error?: string }> {
    const fields = naverFieldsFromRow(p.data);
    const imgs = orderedImages(p);
    const sellerDefaults = loadSellerDefaults();
    const phone = resolveNaverContactPhone(p.data.asPhone, sellerDefaults.asPhone);
    const deliveryCompany = String(p.data.deliveryCompany ?? sellerDefaults.deliveryCompany ?? "").trim();
    const returnDeliveryFee = String(p.data.returnFee ?? sellerDefaults.returnFee ?? "").trim();
    const exchangeDeliveryFee = String(p.data.exchangeFee ?? sellerDefaults.exchangeFee ?? "").trim();
    const unitPriceFields = resolveUnitPriceFields({ ...p.data, weight: fields.weight });
    const issues = validateNaverRegistration({
      title: p.data.productName,
      category: p.data.category,
      sellerProductCode: p.data.sellerProductCode,
      price: p.data.price,
      stock: p.data.stock,
      origin: p.data.origin,
      phone,
      requirePhone: true,
      deliveryCompany,
      returnDeliveryFee,
      exchangeDeliveryFee,
      requireDelivery: true,
      imageCount: imgs.length,
      greenCertificationId: p.data.greenCertificationId,
      greenCertificationName: p.data.greenCertificationName,
      greenCertificationNumber: p.data.greenCertificationNumber,
      ...unitPriceFields,
    });
    if (issues.length) return { ok: false, error: issues.map((issue) => issue.message).join(" · ") };
    try {
      const files = await Promise.all(imgs.map((src, i) => urlToFile(src, `image-${i}.jpg`)));
      const form = new FormData();
      form.append("title", fields.title);
      form.append("summary", fields.summary);
      form.append("origin", fields.origin);
      form.append("weight", fields.weight);
      form.append("storage", fields.storage);
      form.append("shipping", fields.shipping);
      form.append("producer", fields.producer);
      form.append("feature", fields.feature);
      form.append("detailContent", existingDetailContent(p.data) ?? "");
      form.append("category", String(p.data.category ?? ""));
      form.append("sellerProductCode", String(p.data.sellerProductCode ?? ""));
      form.append("price", fields.price);
      form.append("stock", fields.stock);
      form.append("asPhone", phone);
      form.append("deliveryCompany", deliveryCompany);
      form.append("returnDeliveryFee", returnDeliveryFee);
      form.append("exchangeDeliveryFee", exchangeDeliveryFee);
      form.append("greenCertificationId", String(p.data.greenCertificationId ?? "EXCLUDED"));
      form.append("greenCertificationName", String(p.data.greenCertificationName ?? ""));
      form.append("greenCertificationNumber", String(p.data.greenCertificationNumber ?? ""));
      form.append("unitPriceYn", unitPriceFields.unitPriceYn);
      form.append("totalCapacityValue", unitPriceFields.totalCapacityValue);
      form.append("unitCapacity", unitPriceFields.unitCapacity);
      form.append("indicationUnit", unitPriceFields.indicationUnit);
      files.forEach((f) => form.append("images", f));

      const res = await fetch("/api/naver/register", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatRegistrationError("네이버", res.status, data));
      const productNo = data.result?.productNo ?? data.result?.originProductNo;
      return { ok: true, productNo: productNo ? String(productNo) : undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      return {
        ok: false,
        error: message && /[가-힣]/.test(message)
          ? message
          : formatRegistrationError("네이버", 0, { error: message }),
      };
    }
  }

  async function registerToNaver() {
    if (!editing) { setNotice("등록할 상품을 편집 화면에서 열어 주세요."); return; }
    setRegistering(true); setNotice("네이버 스마트스토어에 상품을 등록하는 중입니다…");
    const result = await registerProductToNaver(editing);
    setRegistering(false);
    setNotice(
      result.ok
        ? (result.productNo ? `스마트스토어에 등록되었습니다. 상품번호: ${result.productNo}` : "스마트스토어에 등록되었습니다.")
        : (result.error ?? "상품 등록에 실패했습니다."),
    );
  }

  /** 상품 하나를 카페24 쇼핑몰에 바로 등록한다. 상세설명은 detail.ts의 안심 생성 로직을 그대로 재사용한다. */
  async function registerProductToCafe24(p: Product): Promise<{ ok: boolean; productNo?: string; error?: string; needsConnect?: boolean }> {
    const title = String(p.data.productName ?? "").trim();
    if (!title) return { ok: false, error: "상품명이 필요합니다." };
    const price = Number(p.data.price ?? 0);
    if (!price) return { ok: false, error: "가격이 필요합니다." };
    const imgs = orderedImages(p);
    if (!imgs.length) return { ok: false, error: "상품 사진이 최소 1장 필요합니다." };
    try {
      const res = await fetch("/api/cafe24/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          price,
          summary: String(p.data.feature ?? ""),
          descriptionHtml: existingDetailContent(p.data) ?? buildDetailHtml(p.data, { images: imgs, theme: p.detailTheme }),
          images: imgs,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: formatRegistrationError("카페24", res.status, data),
          needsConnect: data.needsConnect,
        };
      }
      return { ok: true, productNo: data.productNo };
    } catch (err) {
      return {
        ok: false,
        error: formatRegistrationError("카페24", 0, { error: err instanceof Error ? err.message : "" }),
      };
    }
  }

  async function registerToCafe24() {
    if (!editing) { setNotice("등록할 상품을 편집 화면에서 열어 주세요."); return; }
    setRegisteringCafe24(true); setNotice("카페24에 상품을 등록하는 중입니다…");
    const result = await registerProductToCafe24(editing);
    setRegisteringCafe24(false);
    setNotice(
      result.ok
        ? `카페24에 등록되었습니다.${result.productNo ? ` 상품번호: ${result.productNo}` : ""}`
        : result.needsConnect
          ? `${result.error} 위의 "카페24 연결"을 먼저 눌러주세요.`
          : (result.error ?? "카페24 등록에 실패했습니다."),
    );
  }

  // ── 상품 템플릿 저장 ───────────────────────────────────────────────────
  async function saveTemplate() {
    if (!editing) return;
    const name = templateName.trim() || product.name.trim();
    if (!name) { setNotice("템플릿 이름(상품명)을 입력해 주세요."); return; }
    const unreachable = images.filter((src) => !isPubliclyReachable(src));
    if (unreachable.length) {
      setNotice("사진이 아직 인터넷에 안 올라갔습니다. 아래 채널 내보내기에서 '사진 인터넷에 올리기'를 먼저 해주세요.");
      return;
    }
    setSavingTemplate(true);
    try {
      await saveProductAsTemplate(editing, name, templateAliases.trim());
      setNotice(`"${name}" 템플릿으로 저장했습니다. 이제 "${name} 얼마에 올려줘"로 빠르게 등록할 수 있습니다.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "템플릿 저장에 실패했습니다.");
    } finally {
      setSavingTemplate(false);
    }
  }

  // ── 빠른 명령 ──────────────────────────────────────────────────────────
  async function runQuickFind() {
    const text = quickText.trim();
    if (!text) return;
    const parsed = parseQuickCommand(text);
    if (!parsed.name) {
      setNotice(`상품 이름을 알아듣지 못했습니다. "사과 39900원에 올려줘"처럼 적어 주세요.`);
      return;
    }
    setQuickBusy(true);
    setQuickPreview(null);
    setQuickCandidates(null);
    try {
      const matches = await findTemplates(parsed.name);
      if (!matches.length) {
        setNotice(`"${parsed.name}" 템플릿을 못 찾았습니다. 먼저 편집 화면에서 "템플릿으로 저장"을 해주세요.`);
        return;
      }
      if (matches.length > 1 && matches[0].score < 0.99) {
        setQuickCandidates({ parsed, list: matches.slice(0, 5) });
        return;
      }
      applyQuickMatch(parsed, matches[0]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "템플릿 검색에 실패했습니다.");
    } finally {
      setQuickBusy(false);
    }
  }

  function applyQuickMatch(parsed: ReturnType<typeof parseQuickCommand>, match: RankedTemplate) {
    const row: CanonicalRow = { ...match.data };
    if (parsed.price) row.price = String(parsed.price);
    if (parsed.stock) row.stock = String(parsed.stock);
    setQuickPreview({ parsed, match, row });
    setQuickCandidates(null);
  }

  function cancelQuick() {
    setQuickPreview(null);
    setQuickCandidates(null);
  }

  async function confirmQuickRegister() {
    if (!quickPreview) return;
    if (!String(quickPreview.row.price ?? "").trim()) {
      setNotice(`가격을 못 읽었습니다. 명령에 가격을 포함해 주세요. 예: "${quickPreview.match.name} 39900원에 올려줘"`);
      return;
    }
    setQuickBusy(true);
    try {
      const np: Product = {
        ...newProduct(),
        data: quickPreview.row,
        images: quickPreview.match.images,
        imageRoles: quickPreview.match.imageRoles,
      };
      commit(upsert(products, np));
      setSelectedIds((prev) => [...prev, np.id]);

      const channel = quickPreview.parsed.channel ?? "naver";
      const channelLabel = channel === "cafe24" ? "카페24" : "네이버";
      setNotice(`${channelLabel}에 등록하는 중입니다…`);
      const result = channel === "cafe24" ? await registerProductToCafe24(np) : await registerProductToNaver(np);
      setNotice(
        result.ok
          ? `${channelLabel}에 바로 등록했습니다${result.productNo ? ` (상품번호 ${result.productNo})` : ""}. 쿠팡·11번가는 카페24 마켓플러스로, 나머지 채널은 아래 채널 탭 다운로드로 준비하세요.`
          : `상품은 목록에 넣었지만 ${channelLabel} 등록은 실패했습니다: ${result.error}`,
      );
      setQuickPreview(null);
      setQuickCandidates(null);
      setQuickText("");
    } finally {
      setQuickBusy(false);
    }
  }

  // ── AI 문안 ────────────────────────────────────────────────────────────
  const copy = useMemo(() => ({
    title: recommendedProductTitle({
      productName: product.name,
      origin: product.origin,
      variety: product.variety,
      weight: product.weight,
      shipping: product.shipping,
    }),
    headline: "오늘의 아삭함을 산지에서 바로",
    summary: `${product.origin}에서 정성껏 기른 ${product.variety}입니다. ${product.feature}을 한 상자에 담아 보내드립니다.`,
    points: ["산지에서 선별 후 바로 발송", product.feature.split(",")[0] || "신선한 품질", `${product.weight} 알찬 구성`],
  }), [product]);

  function generate() {
    setBusy(true); setNotice("");
    setTimeout(() => { setBusy(false); setTab("preview"); }, 650);
  }

  function upload(e: ChangeEvent<HTMLInputElement>) {
    if (!editing) return;
    const files = Array.from(e.target.files || []).slice(0, 10 - images.length);
    e.target.value = "";
    if (!files.length) return;
    const nextImages = addProductImages(editing, files.map((file) => URL.createObjectURL(file)));
    commit(upsert(products, { ...editing, ...nextImages }));
  }

  async function captureDetailPng(): Promise<string | null> {
    if (!detailPageRef.current) return null;
    const { toPng } = await import("html-to-image");
    return toPng(detailPageRef.current, {
      pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true,
      width: 390, style: { width: "390px", maxWidth: "390px" },
    });
  }

  async function downloadPng() {
    setNotice("상세페이지 이미지를 만드는 중입니다…");
    try {
      const dataUrl = await captureDetailPng();
      if (!dataUrl) return;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${product.name.replace(/[\\/:*?"<>|]/g, "_") || "상품"}_상세페이지.png`;
      a.click();
      setNotice("상세페이지 PNG를 저장했습니다.");
    } catch {
      setNotice("이미지 저장에 실패했습니다. 사진을 다시 선택한 후 시도해 주세요.");
    }
  }

  return (
    <main>
      <ProductWorkspaceHeader />

      <section className="hero">
        <div><span className="eyebrow">PRODUCT PAGE STUDIO</span><h1>상품을 모아두고,<br/><em>채널마다 알맞게 내보내세요.</em></h1><p>한 번 입력한 상품 정보로 스마트스토어·쿠팡·카페24 등록 엑셀을 각각 만듭니다.</p></div>
        <div className="heroStat"><b>{products.length}</b><span>저장된 상품</span></div>
      </section>

      {unsavedImageCount > 0 && (
        <div className="unsavedWarn">
          ⚠ 아직 저장소에 안 올라간 사진이 <b>{unsavedImageCount}장</b> 있습니다. 이 상태로 새로고침하거나 창을 닫으면 사라집니다.
          편집 화면에서 <b>&ldquo;사진 저장소에 올리기&rdquo;</b>를 눌러주세요.
        </div>
      )}

      <section className="quickBar">
        <input
          placeholder='빠른 명령: "사과 39900원에 50개 올려줘"'
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runQuickFind(); }}
        />
        <button className="primary" onClick={runQuickFind} disabled={quickBusy || !quickText.trim()}>
          {quickBusy ? "찾는 중…" : "빠른 등록"}
        </button>
      </section>

      {quickCandidates && (
        <div className="quickCandidates">
          <b>어떤 상품인가요?</b>
          <div className="quickCandidatesRow">
            {quickCandidates.list.map((t) => (
              <button key={t.id} onClick={() => applyQuickMatch(quickCandidates.parsed, t)}>
                {t.name} <small>{Math.round(t.score * 100)}% 일치</small>
              </button>
            ))}
          </div>
          <button className="linkBtn" onClick={cancelQuick}>취소</button>
        </div>
      )}

      {quickPreview && (
        <div className="quickPreview">
          <div className="quickPreviewHead">
            <b>{String(quickPreview.row.productName ?? quickPreview.match.name)}</b>
            <button className="linkBtn" onClick={cancelQuick}>취소</button>
          </div>
          <div className="quickPreviewBody">
            {quickPreview.match.images[0] && <img src={quickPreview.match.images[0]} alt="" />}
            <p>
              템플릿 <b>{quickPreview.match.name}</b>에서 가져왔습니다. 가격{" "}
              <b>{quickPreview.row.price ? `${Number(quickPreview.row.price).toLocaleString()}원` : "명령에 없음 — 가격을 포함해 다시 말해 주세요"}</b>
              {quickPreview.row.stock ? ` · 재고 ${quickPreview.row.stock}개` : " · 재고는 템플릿 저장 당시 값 그대로"}
              {" · "}<b>{quickPreview.parsed.channel === "cafe24" ? "카페24" : "네이버"}</b>에 등록됩니다
            </p>
          </div>
          <button
            className="primary full"
            onClick={confirmQuickRegister}
            disabled={quickBusy || !String(quickPreview.row.price ?? "").trim()}
          >
            {quickBusy ? "등록 중…" : `이 내용으로 ${quickPreview.parsed.channel === "cafe24" ? "카페24" : "네이버"} 바로 등록`}
          </button>
        </div>
      )}

      <div className="mobileTabs">
        <button className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}>상품 관리</button>
        <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>상품 미리보기</button>
      </div>

      <section className="workspace">
        <div className={`editor ${tab === "edit" ? "show" : ""}`}>
          {loaded && (
            <ProductList
              products={products}
              selectedIds={selectedIds}
              editingId={editingId}
              onSelect={setSelectedIds}
              onEdit={setEditingId}
              onFixDuplicate={fixDuplicateCode}
              onCreate={createProduct}
              onDuplicate={duplicate}
              onDelete={remove}
              onImport={importExcel}
              busy={importing}
            />
          )}

          {editing && (
            <div className="drawer">
              <div className="drawerHead">
                <div>
                  <span>02</span>
                  <h2>{productLabel(editing)} 편집</h2>
                </div>
                <button className="linkBtn" onClick={() => setEditingId(null)}>닫기</button>
              </div>

              <div className="tplSave">
                <input placeholder="템플릿 이름 (예: 사과)" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                <input placeholder="별칭, 콤마로 구분 (예: 부사,홍로)" value={templateAliases} onChange={(e) => setTemplateAliases(e.target.value)} />
                <button className="secondary" onClick={saveTemplate} disabled={savingTemplate}>
                  {savingTemplate ? "저장 중…" : "템플릿으로 저장"}
                </button>
              </div>
              <p className="dbdFoot">
                사진을 인터넷에 올린 뒤 저장하면, 다음부터 &ldquo;{templateName || "이 상품"} 얼마에 올려줘&rdquo;라고만 말해도 바로 등록할 수 있습니다.
              </p>

              <div className="sectionHead"><div><h3>상품 사진</h3></div><small>첫 장 대표 · 나머지 추가 이미지 · 상세는 직접 선택</small></div>
              <div className="imageGrid">
                {images.map((src, i) => {
                  const role = effectiveImageRole(editing, src);
                  const imageLabel = productImageLabel(editing, src);
                  return (
                    <div
                      className="thumb"
                      key={`${src}-${i}`}
                      draggable
                      title="끌어서 사진 순서 변경"
                      onDragStart={(event) => {
                        draggedImageIndexRef.current = i;
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const fromIndex = draggedImageIndexRef.current;
                        draggedImageIndexRef.current = null;
                        if (fromIndex !== null) moveImage(fromIndex, i);
                      }}
                      onDragEnd={() => { draggedImageIndexRef.current = null; }}
                    >
                      <img src={src} alt={`상품 사진 ${i+1}`} />
                      <b className={role === "detail" ? "roleDetail" : role === "cover" ? "roleCover" : "roleExtra"}>{imageLabel}</b>
                      <div className="roleBtns">
                        <button type="button" aria-label={`${i + 1}번 사진 왼쪽으로 이동`} onClick={() => moveImage(i, i - 1)} disabled={i === 0}>←</button>
                        <button type="button" aria-label={`${i + 1}번 사진 오른쪽으로 이동`} onClick={() => moveImage(i, i + 1)} disabled={i === images.length - 1}>→</button>
                        <button type="button" aria-pressed={role === "cover"} className={role === "cover" ? "on" : ""} onClick={() => setImageRole(src, "cover")}>대표</button>
                        <button type="button" aria-pressed={role === "detail"} className={role === "detail" ? "on" : ""} onClick={() => setImageRole(src, "detail")} disabled={role === "cover"}>상세</button>
                      </div>
                      <button className="thumbDelete" aria-label="사진 삭제" onClick={() => setImages(v => v.filter((_, n) => n !== i))}>×</button>
                    </div>
                  );
                })}
                {images.length < 10 && <label className="upload"><span>＋</span><b>사진 추가</b><small>JPG, PNG</small><input type="file" accept="image/*" multiple onChange={upload}/></label>}
              </div>
              {images.some((src) => !isPubliclyReachable(src)) && (
                <>
                  <p className="uploadPhotosWarn">⚠ 지금 이 사진은 이 컴퓨터에만 있습니다. 저장하지 않으면 새로고침 시 사라집니다.</p>
                  <button className="secondary uploadPhotosBtn" onClick={uploadCurrentPhotos} disabled={uploadingPhotos}>
                    {uploadingPhotos ? "올리는 중…" : "사진 저장소에 올리기"}
                  </button>
                </>
              )}

              <div ref={detailEditorRef} id="detail-page-editor">
                <DetailBuilder
                  products={[editing]}
                  defaults={detailDefaults}
                  onApply={applyProductUpdates}
                  onNotice={setNotice}
                  openRequestKey={detailEditorOpenRequest}
                  onPreviewChange={(productId, html) => setDetailPreviewDraft({ productId, html })}
                />
              </div>

              <div className="sectionHead second"><div><h3>프리미엄 연출 사진 자동 채우기</h3></div><small>올린 사진을 우선 쓰고 부족한 장면만 AI로 만듭니다</small></div>
              <div className="capacityRow">
                <div className="capacityRowTop">
                  <select value={autoImage.refIndex} onChange={e => setAutoImage(s => ({ ...s, refIndex: Number(e.target.value) }))}>
                    {images.map((_, i) => <option key={i} value={i}>{i === 0 ? "대표 사진" : `사진 ${i + 1}`} 참조</option>)}
                  </select>
                  <input className="capLabel" placeholder="사진 느낌 (예: 흐르는 과즙, 잘라진 단면)" value={autoImage.prompt} onChange={e => setAutoImage(s => ({ ...s, prompt: e.target.value }))} />
                </div>
                <div className="capacityRowBottom">
                  <button className="secondary" onClick={generateCoverAndDetailImages} disabled={autoImage.status === "generating" || !images.length || !premiumImageSlots(images.length).length}>
                    {autoImage.status === "generating" ? "생성 중…" : premiumImageSlots(images.length).length ? `부족한 연출 사진 ${premiumImageSlots(images.length).length}장 만들기` : "연출 사진 준비 완료"}
                  </button>
                  {autoImage.status === "error" && <span className="capError">{autoImage.error}</span>}
                </div>
              </div>
              <p className="dbdFoot">
                당도·수확일처럼 확인 안 된 사실은 프롬프트에 넣지 않아도 됩니다 — 이미 입력한 상품명·품종·원산지만 참고해서 만듭니다.
              </p>

              <div className="sectionHead second"><div><h3>용량별 이미지 생성</h3></div><small>기존 사진을 참조해 새 이미지를 만듭니다</small></div>
              <div className="capacityRows">
                {capacityRows.map(row => (
                  <div className="capacityRow" key={row.id}>
                    <div className="capacityRowTop">
                      <input className="capLabel" placeholder="용량 (예: 1kg)" value={row.label} onChange={e => updateCapacityRow(row.id, { label: e.target.value })} />
                      <select value={row.refIndex} onChange={e => updateCapacityRow(row.id, { refIndex: Number(e.target.value) })}>
                        {images.map((_, i) => <option key={i} value={i}>{i === 0 ? "대표 사진" : `사진 ${i + 1}`} 참조</option>)}
                      </select>
                      <button className="rowRemove" aria-label="행 삭제" onClick={() => removeCapacityRow(row.id)}>×</button>
                    </div>
                    <textarea className="capPrompt" placeholder="예: 이 사과를 1kg 소포장 박스에 담은 사진으로 바꿔줘" value={row.prompt} onChange={e => updateCapacityRow(row.id, { prompt: e.target.value })} />
                    <div className="capacityRowBottom">
                      <button className="secondary" onClick={() => generateCapacityImage(row.id)} disabled={row.status === "generating"}>
                        {row.status === "generating" ? "생성 중…" : "이미지 생성"}
                      </button>
                      {row.status === "done" && row.resultUrl && (
                        <div className="capResult">
                          <img src={row.resultUrl} alt={row.label || "생성된 이미지"} />
                          <button className="secondary" onClick={() => addCapacityResultToGallery(row.id)}>상품 사진에 추가</button>
                        </div>
                      )}
                      {row.status === "error" && <span className="capError">{row.error}</span>}
                    </div>
                  </div>
                ))}
                <button className="ghost addRow" onClick={addCapacityRow}>＋ 용량 추가</button>
              </div>

              <div className="sectionHead second"><div><h3>상품 정보</h3></div><small><strong>*</strong> 실제 정보만 입력해 주세요</small></div>
              <NaverCategoryPicker
                key={editing.id}
                categoryId={String(editing.data.category ?? "")}
                categoryName={String(editing.data.categoryName ?? "")}
                suggestedQuery={product.name || product.variety}
                onSelect={(category) => updateProductData({
                  category: category.id,
                  categoryName: category.path || category.name,
                  greenCertificationId: "EXCLUDED",
                  greenCertificationName: "",
                  greenCertificationMarkType: "",
                  greenCertificationNumber: "",
                })}
                onNotice={setNotice}
              />
              <NaverCertificationFields
                categoryId={String(editing.data.category ?? "")}
                certificationId={String(editing.data.greenCertificationId ?? "EXCLUDED")}
                certificationNumber={String(editing.data.greenCertificationNumber ?? "")}
                onChange={(certification) => updateProductData({
                  greenCertificationId: certification.id,
                  greenCertificationName: certification.name,
                  greenCertificationMarkType: certification.markType,
                  greenCertificationNumber: certification.number ?? String(editing.data.greenCertificationNumber ?? ""),
                })}
                onNotice={setNotice}
              />
              <div className="formGrid">
                <label className={editingHasDuplicateCode ? "fieldError" : ""}>
                  <span>판매자 상품코드</span>
                  <input
                    ref={productCodeInputRef}
                    value={String(editing.data.sellerProductCode ?? "")}
                    onChange={(event) => updateProductData({ sellerProductCode: event.target.value })}
                    aria-invalid={editingHasDuplicateCode || undefined}
                    aria-describedby={editingHasDuplicateCode ? "seller-product-code-error" : undefined}
                  />
                  {editingHasDuplicateCode && (
                    <small id="seller-product-code-error" className="fieldErrorMessage">
                      다른 상품과 중복된 코드입니다. 고유한 코드로 수정해 주세요.
                    </small>
                  )}
                </label>
                {fields.map(f => <label key={f.key} className={f.key === "feature" ? "wide" : ""}><span>{f.label}</span>{f.key === "feature" ? <textarea value={product[f.key]} onChange={e => updateField(f.key, e.target.value)} /> : <input value={product[f.key]} onChange={e => updateField(f.key, e.target.value)} />}</label>)}
              </div>
              <NaverUnitPriceFields
                enabled={unitPriceFields.unitPriceYn}
                totalCapacityValue={unitPriceFields.totalCapacityValue}
                unitCapacity={unitPriceFields.unitCapacity}
                indicationUnit={unitPriceFields.indicationUnit}
                autoCalculated={unitPriceFields.autoCalculated}
                onChange={updateProductData}
              />
              <div className="safety"><span>✓</span><p><b>안심 생성 원칙</b> 원산지·중량·가격 같은 사실 정보는 AI가 임의로 만들지 않습니다.</p></div>
              <button className="primary full" onClick={generate} disabled={busy}>{busy ? "상세페이지 구성 중…" : "✦ AI 상세페이지 만들기"}</button>
            </div>
          )}

          <ChannelExcel
            products={selectedProducts}
            onUpdateProducts={applyProductUpdates}
            onNotice={setNotice}
            onCaptureDetail={captureDetailPng}
          />
        </div>

        <aside className={`previewPane ${tab === "preview" ? "show" : ""}`}>
          <div className="previewHead"><div><span className="dot" /> 상품 미리보기</div><div><button onClick={() => window.print()}>인쇄</button></div></div>
          {editing ? (
            <>
              <ProductGalleryPreview key={editing.id} product={editing} />
              <div className="detailPreviewTitle">
                <div><b>상세페이지 미리보기</b><small>미리보기를 누르면 편집 화면으로 이동합니다.</small></div>
                <button type="button" className="linkBtn" aria-label="상세페이지 화면 편집" onClick={openDetailEditorFromPreview}>화면 편집</button>
              </div>
              <div
                className="phone detailPreviewInteractive"
                role="button"
                tabIndex={0}
                aria-label="상세페이지 미리보기를 눌러 화면 편집"
                onClick={openDetailEditorFromPreview}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDetailEditorFromPreview();
                  }
                }}
              >
                <div className="mockPage" ref={detailPageRef}>
                  {detailPreviewHtml ? (
                    <div className="existingDetailPreview" dangerouslySetInnerHTML={{ __html: detailPreviewHtml }} />
                  ) : (
                    <PremiumDetailPage
                      row={editing.data}
                      images={premiumImages}
                      theme={detailTheme}
                    />
                  )}
                </div>
              </div>
              <div className="resultCard"><span>AI 추천 상품명</span><p>{copy.title}</p><button onClick={() => navigator.clipboard?.writeText(copy.title)}>복사</button></div>
              <div className="downloadActions"><button className="secondary" onClick={downloadPng}><b>PNG</b><span>상세페이지 저장</span></button></div>
              <div className={`naverReadiness ${naverIssues.length ? "blocked" : "ready"}`}>
                <b>{naverIssues.length ? `네이버 등록 전 ${naverIssues.length}개 확인 필요` : "네이버 등록 준비 완료"}</b>
                {naverIssues.length > 0 && (
                  <ul>{naverIssues.map((issue) => <li key={issue.field}>{issue.message}</li>)}</ul>
                )}
              </div>
              <div className="actions">
                <button className="secondary" onClick={registerToCafe24} disabled={registeringCafe24}>{registeringCafe24 ? "등록 중…" : "카페24에 등록"}</button>
                <button className="primary" onClick={registerToNaver} disabled={registering || naverIssues.length > 0}>{registering ? "등록 중…" : "네이버에 상품 등록 →"}</button>
              </div>
            </>
          ) : (
            <div className="previewEmpty">
              <p>목록에서 상품을 클릭하면 상세페이지 미리보기가 나옵니다.</p>
            </div>
          )}
        </aside>
      </section>
      {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
    </main>
  );
}
