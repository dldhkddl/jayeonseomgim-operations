"use client";

import { useRef, useState } from "react";
import { hasDetailChanges, normalizeDetailHtml, sanitizeDetailHtml } from "../lib/detail-editor";
import type { Product } from "../lib/products";

type Props = {
  products: Product[];
  selectedId: string;
  onSelect: (id: string) => void;
  onSave: (productId: string, html: string) => void;
  onNotice?: (message: string) => void;
  onPreviewChange?: (productId: string, html: string) => void;
};

type EditorMode = "visual" | "html";

export default function DetailVisualEditor({ products, selectedId, onSelect, onSave, onNotice, onPreviewChange }: Props) {
  const product = products.find((item) => item.id === selectedId) ?? products[0];
  if (!product) return <p className="dveEmpty">편집할 상품이 없습니다.</p>;
  const persistedHtml = sanitizeDetailHtml(product.data.detailContent ?? "");
  return (
    <DetailVisualEditorSession
      key={`${product.id}:${persistedHtml}`}
      products={products}
      product={product}
      persistedHtml={persistedHtml}
      onSelect={onSelect}
      onSave={onSave}
      onNotice={onNotice}
      onPreviewChange={onPreviewChange}
    />
  );
}

type SessionProps = Omit<Props, "selectedId"> & {
  product: Product;
  persistedHtml: string;
};

function DetailVisualEditorSession({ products, product, persistedHtml, onSelect, onSave, onNotice, onPreviewChange }: SessionProps) {
  const [mode, setMode] = useState<EditorMode>("visual");
  const [original, setOriginal] = useState(persistedHtml);
  const [draft, setDraft] = useState(persistedHtml);
  const editorRef = useRef<HTMLDivElement>(null);
  const dirty = hasDetailChanges(original, draft);

  function syncFromVisual() {
    const html = editorRef.current?.innerHTML ?? "";
    setDraft(html);
    onPreviewChange?.(product.id, html);
  }

  function changeProduct(nextId: string) {
    if (nextId === product?.id) return;
    if (dirty && !window.confirm("저장하지 않은 상세페이지 수정 내용이 있습니다. 저장하지 않고 다른 상품으로 이동할까요?")) return;
    onSelect(nextId);
  }

  function runCommand(command: string, value?: string) {
    if (mode !== "visual") setMode("visual");
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      syncFromVisual();
    });
  }

  function addLink() {
    const url = window.prompt("연결할 주소를 입력하세요. 예: https://example.com");
    if (!url) return;
    if (!/^(?:https?:\/\/|mailto:|tel:)/i.test(url.trim())) {
      onNotice?.("링크는 http://, https://, mailto: 또는 tel: 주소만 사용할 수 있습니다.");
      return;
    }
    runCommand("createLink", url.trim());
  }

  function addImage() {
    const url = window.prompt("상세페이지에 넣을 이미지의 인터넷 주소를 입력하세요.");
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) {
      onNotice?.("이미지는 http:// 또는 https:// 인터넷 주소만 사용할 수 있습니다.");
      return;
    }
    runCommand("insertImage", url.trim());
  }

  function save() {
    if (!product) return;
    const safe = normalizeDetailHtml(mode === "visual" ? editorRef.current?.innerHTML ?? draft : draft);
    if (!safe && original && !window.confirm("기존 상세페이지 내용을 모두 지우시겠습니까?")) return;
    onSave(product.id, safe);
    setOriginal(safe);
    setDraft(safe);
  }

  function reset() {
    if (dirty && !window.confirm("저장하지 않은 수정 내용을 버리고 마지막 저장 상태로 되돌릴까요?")) return;
    setDraft(original);
    onPreviewChange?.(product.id, original);
    if (editorRef.current) editorRef.current.innerHTML = original;
  }

  return (
    <section className="dve" aria-label="기존 상세페이지 편집기">
      <div className="dveTop">
        <div>
          <b>기존 상세페이지 편집</b>
          <small>가져온 글과 이미지를 보면서 바로 수정할 수 있습니다.</small>
        </div>
        {products.length > 1 && (
          <label className="dveProduct">
            <span>편집할 상품</span>
            <select value={product.id} onChange={(event) => changeProduct(event.target.value)}>
              {products.map((item) => <option key={item.id} value={item.id}>{String(item.data.productName ?? "(이름 없음)")}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="dveTabs" role="tablist" aria-label="상세페이지 편집 방식">
        <button type="button" role="tab" aria-selected={mode === "visual"} className={mode === "visual" ? "on" : ""} onClick={() => setMode("visual")}>화면 편집</button>
        <button type="button" role="tab" aria-selected={mode === "html"} className={mode === "html" ? "on" : ""} onClick={() => { syncFromVisual(); setMode("html"); }}>HTML 원본</button>
        {dirty && <span className="dveDirty">저장 안 됨</span>}
      </div>

      {mode === "visual" ? (
        <>
          <div className="dveToolbar" role="toolbar" aria-label="상세페이지 서식">
            <button type="button" title="실행 취소" aria-label="실행 취소" onClick={() => runCommand("undo")}>↶</button>
            <button type="button" title="다시 실행" aria-label="다시 실행" onClick={() => runCommand("redo")}>↷</button>
            <button type="button" title="굵게" aria-label="굵게" onClick={() => runCommand("bold")}><strong>B</strong></button>
            <select aria-label="문단 형식" defaultValue="p" onChange={(event) => runCommand("formatBlock", event.target.value)}>
              <option value="p">본문</option>
              <option value="h2">큰 제목</option>
              <option value="h3">작은 제목</option>
            </select>
            <button type="button" title="왼쪽 정렬" aria-label="왼쪽 정렬" onClick={() => runCommand("justifyLeft")}>≡</button>
            <button type="button" title="가운데 정렬" aria-label="가운데 정렬" onClick={() => runCommand("justifyCenter")}>≣</button>
            <button type="button" title="오른쪽 정렬" aria-label="오른쪽 정렬" onClick={() => runCommand("justifyRight")}>≡</button>
            <button type="button" onClick={addLink}>링크</button>
            <button type="button" onClick={addImage}>이미지</button>
          </div>
          <div
            key={`${product.id}-${original}`}
            ref={editorRef}
            className="dveCanvas"
            contentEditable
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: draft }}
            onInput={syncFromVisual}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) event.preventDefault();
            }}
          />
        </>
      ) : (
        <textarea
          className="dveSource"
          aria-label="상세페이지 HTML 원본"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            onPreviewChange?.(product.id, event.target.value);
          }}
          spellCheck={false}
        />
      )}

      <div className="dveActions">
        <button type="button" className="secondary" onClick={reset} disabled={!dirty}>되돌리기</button>
        <button type="button" className="primary" onClick={save} disabled={!dirty}>수정본 저장</button>
      </div>
    </section>
  );
}
