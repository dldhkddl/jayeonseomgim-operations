"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  duplicateCodeGroups,
  orderedImages,
  productLabel,
  searchProducts,
  type Product,
} from "../lib/products";

type Props = {
  products: Product[];
  /** 내보내기 대상으로 체크된 상품 */
  selectedIds: string[];
  /** 편집 서랍이 열려 있는 상품 */
  editingId: string | null;
  onSelect: (ids: string[]) => void;
  onEdit: (id: string | null) => void;
  onFixDuplicate: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onImport: (e: ChangeEvent<HTMLInputElement>) => void;
  busy?: boolean;
};

const won = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString()}원` : "가격 미정";
};

export default function ProductList({
  products,
  selectedIds,
  editingId,
  onSelect,
  onEdit,
  onFixDuplicate,
  onCreate,
  onDuplicate,
  onDelete,
  onImport,
  busy,
}: Props) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => searchProducts(products, query), [products, query]);
  const duplicateGroups = useMemo(() => duplicateCodeGroups(products), [products]);
  const duplicateIds = useMemo(
    () => new Set(duplicateGroups.flatMap((group) => group.productIds)),
    [duplicateGroups],
  );
  const duplicateCodes = useMemo(
    () => new Set(duplicateGroups.map((group) => group.code)),
    [duplicateGroups],
  );
  const selected = new Set(selectedIds);
  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.id));

  function toggle(id: string) {
    onSelect(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  function toggleAll() {
    if (allShownSelected) onSelect(selectedIds.filter((id) => !shown.some((p) => p.id === id)));
    else onSelect([...new Set([...selectedIds, ...shown.map((p) => p.id)])]);
  }

  return (
    <section className="plist">
      <div className="sectionHead">
        <div>
          <span>01</span>
          <h2>상품 목록</h2>
        </div>
        <small>{products.length ? `${products.length}개 · 선택 ${selectedIds.length}개` : "저장된 상품이 없습니다"}</small>
      </div>

      <div className="plistBar">
        <input
          className="plistSearch"
          placeholder="상품명·품종·산지·상품코드 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary" onClick={onCreate}>
          ＋ 새 상품
        </button>
        <label className="secondary plistImport">
          {busy ? "읽는 중…" : "엑셀 가져오기"}
          <input type="file" accept=".xlsx,.xlsm,.xls,.csv" onChange={onImport} disabled={busy} />
        </label>
      </div>

      {duplicateGroups.length > 0 && (
        <div className="plistDuplicateAlert" role="alert">
          <b>중복 상품코드를 수정해 주세요</b>
          <p>이대로 등록하면 채널에서 기존 상품을 덮어쓸 수 있습니다.</p>
          {duplicateGroups.map((group) => (
            <div className="plistDuplicateGroup" key={group.code}>
              <code>{group.code}</code>
              <ul>
                {group.productIds.map((id) => {
                  const affectedProduct = products.find((candidate) => candidate.id === id);
                  if (!affectedProduct) return null;
                  return (
                    <li key={id}>
                      <span>{productLabel(affectedProduct)}</span>
                      <button
                        type="button"
                        className="linkBtn"
                        onClick={() => onFixDuplicate(id)}
                        aria-label={`${productLabel(affectedProduct)} 상품코드 수정하기`}
                      >
                        수정하기
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {products.length === 0 ? (
        <div className="plistEmpty">
          <p>
            <b>새 상품</b>으로 하나씩 만들거나, 이미 정리해 둔 <b>엑셀을 가져오기</b> 하세요.
          </p>
          <small>가져온 상품도 이 목록으로 들어옵니다.</small>
        </div>
      ) : (
        <>
          <div className="plistHead">
            <label>
              <input type="checkbox" checked={allShownSelected} onChange={toggleAll} />
              전체 선택
            </label>
            {selectedIds.length > 0 && (
              <button className="linkBtn danger" onClick={() => onDelete(selectedIds)}>
                선택 {selectedIds.length}개 삭제
              </button>
            )}
          </div>

          <div className="plistRows">
            {shown.map((p) => {
              const isEditing = editingId === p.id;
              const thumb = orderedImages(p)[0];
              const code = String(p.data.sellerProductCode ?? "").trim();
              return (
                <div className={`plistRow ${isEditing ? "editing" : ""} ${selected.has(p.id) ? "on" : ""} ${duplicateIds.has(p.id) ? "duplicate" : ""}`} key={p.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    aria-label={`${productLabel(p)} 선택`}
                  />
                  <button className="plistMain" onClick={() => onEdit(isEditing ? null : p.id)}>
                    {thumb ? <img src={thumb} alt="" /> : <span className="plistNoImg">사진<br />없음</span>}
                    <span className="plistInfo">
                      <b>{productLabel(p)}</b>
                      <small>
                        {won(p.data.price)}
                        {p.data.weightSpec ? ` · ${p.data.weightSpec}` : ""}
                        {code ? ` · ${code}` : ""}
                        {duplicateCodes.has(code) && <em> 코드중복</em>}
                      </small>
                    </span>
                  </button>
                  <div className="plistRowBtns">
                    <button className="linkBtn" onClick={() => onEdit(isEditing ? null : p.id)}>
                      {isEditing ? "닫기" : "편집"}
                    </button>
                    <button className="linkBtn" onClick={() => onDuplicate(p.id)}>
                      복제
                    </button>
                    <button className="linkBtn danger" onClick={() => onDelete([p.id])}>
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
            {!shown.length && <p className="chxNone">검색 결과가 없습니다.</p>}
          </div>
        </>
      )}
    </section>
  );
}
