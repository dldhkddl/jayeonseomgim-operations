"use client";

import { useEffect, useMemo, useState } from "react";
import { detailState, fillDetails, type BuildMode } from "../lib/channels/detail";
import { replaceProductDetail } from "../lib/detail-editor";
import { detailPageImages, type Product } from "../lib/products";
import type { SellerDefaults } from "../lib/channels/defaults";
import DetailVisualEditor from "./DetailVisualEditor";

type Props = {
  products: Product[];
  defaults: SellerDefaults;
  onApply: (next: Product[]) => void;
  onNotice?: (message: string) => void;
  openRequestKey?: number;
  onPreviewChange?: (productId: string, html: string) => void;
};

export default function DetailBuilder({ products, defaults, onApply, onNotice, openRequestKey = 0, onPreviewChange }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BuildMode>("empty");
  const [format, setFormat] = useState<"html" | "text">("html");
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (openRequestKey > 0) setOpen(true);
  }, [openRequestKey]);

  const stats = useMemo(() => {
    let empty = 0, memo = 0, written = 0;
    for (const p of products) {
      const s = detailState(p.data.detailContent);
      if (s === "empty") empty += 1;
      else if (s === "memo") memo += 1;
      else written += 1;
    }
    return { empty, memo, written };
  }, [products]);

  const target = mode === "all" ? products.length : stats.empty + stats.memo;

  const previewProduct = products.find((p) => p.id === previewId) ?? products[0];

  function apply() {
    if (!products.length) return;
    const { rows, summary } = fillDetails(
      products.map((p) => ({
        data: p.data,
        images: detailPageImages(p),
        theme: p.detailTheme,
      })),
      { mode, format, guide: defaults.asGuide, phone: defaults.asPhone },
    );
    onApply(products.map((p, i) => ({ ...p, data: rows[i] })));

    const bits = [`${summary.filled}개 생성`];
    if (summary.replaced) bits.push(`메모 ${summary.replaced}개 교체`);
    if (summary.skipped) bits.push(`기존 ${summary.skipped}개 유지`);
    if (summary.noImage) bits.push(`사진 없는 ${summary.noImage}개는 글자만`);
    onNotice?.(`상세설명 ${bits.join(" · ")}`);
  }

  function saveEditedDetail(productId: string, html: string) {
    onApply(replaceProductDetail(products, productId, html));
    onNotice?.("상세페이지 수정본을 저장했습니다.");
  }

  return (
    <div className="dbd">
      <button className="dbdHead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="dbdCaret">{open ? "▾" : "▸"}</span>
        <b>상세페이지 편집·자동 생성</b>
        <small>
          {products.length
            ? `작성됨 ${stats.written} · 비었음 ${stats.empty}${stats.memo ? ` · 메모 ${stats.memo}` : ""}`
            : "상품을 선택하세요"}
          {stats.memo > 0 && <em> · 메모 확인</em>}
        </small>
      </button>

      {open && (
        <div className="dbdBody">
          <p className="dbdIntro">
            상품이 가진 <b>사실 정보</b>(원산지·품종·구성·보관법)와 올려둔 사진으로 상세설명을 조립합니다.
            당도나 수확일처럼 <b>없는 정보는 만들지 않습니다.</b> 비어 있는 항목은 빼고 만듭니다.
          </p>

          {stats.memo > 0 && (
            <p className="dbdMemo">
              상세설명 자리에 작업 메모로 보이는 값이 <b>{stats.memo}개</b> 있습니다(예: &ldquo;수정본 필요&rdquo;). 이대로 등록하면 고객에게 그 문구가 보입니다.
            </p>
          )}

          <div className="dbdOptions">
            <div className="mgnSegment">
              <button className={mode === "empty" ? "on" : ""} onClick={() => setMode("empty")}>
                비었거나 메모인 것만
              </button>
              <button className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>
                전부 다시 만들기
              </button>
            </div>
            <div className="mgnSegment">
              <button className={format === "html" ? "on" : ""} onClick={() => setFormat("html")}>
                HTML
              </button>
              <button className={format === "text" ? "on" : ""} onClick={() => setFormat("text")}>
                글자만
              </button>
            </div>
          </div>

          {previewProduct && (
            <DetailVisualEditor
              products={products}
              selectedId={previewProduct.id}
              onSelect={setPreviewId}
              onSave={saveEditedDetail}
              onNotice={onNotice}
              onPreviewChange={onPreviewChange}
            />
          )}

          <button className="primary full" onClick={apply} disabled={!target}>
            {target ? `상품 ${target}개에 상세설명 넣기` : "생성할 대상이 없습니다"}
          </button>
          <p className="dbdFoot">
            사진이 아직 인터넷에 안 올라간 상품은 글자만 들어갑니다. 위에서 <b>사진 인터넷에 올리기</b>를 먼저 하면 이미지까지 들어갑니다.
          </p>
        </div>
      )}
    </div>
  );
}
