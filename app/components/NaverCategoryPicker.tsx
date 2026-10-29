"use client";

import { useState } from "react";

export type FoundNaverCategory = {
  id: string;
  name: string;
  path: string;
};

type Props = {
  categoryId: string;
  categoryName: string;
  suggestedQuery: string;
  onSelect: (category: FoundNaverCategory) => void;
  onNotice?: (message: string) => void;
};

export default function NaverCategoryPicker({
  categoryId,
  categoryName,
  suggestedQuery,
  onSelect,
  onNotice,
}: Props) {
  const [query, setQuery] = useState(suggestedQuery);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<FoundNaverCategory[]>([]);

  async function search() {
    const keyword = query.trim();
    if (!keyword) return;

    setSearching(true);
    setSearched(false);
    setResults([]);
    try {
      const response = await fetch(`/api/naver/categories?q=${encodeURIComponent(keyword)}`);
      const data = (await response.json()) as {
        categories?: FoundNaverCategory[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "카테고리를 검색하지 못했습니다.");
      const categories = Array.isArray(data.categories) ? data.categories : [];
      setResults(categories);
      setSearched(true);
      if (!categories.length) onNotice?.(`"${keyword}"로 찾은 말단 카테고리가 없습니다.`);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "카테고리 검색에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  }

  function choose(category: FoundNaverCategory) {
    onSelect(category);
    setResults([]);
    setSearched(false);
    setQuery(category.path || category.name);
    onNotice?.(`네이버 카테고리 ${category.id}를 선택했습니다.`);
  }

  return (
    <div className="naverCategoryPicker">
      <div className="naverCategoryLabel">
        <span>네이버 카테고리 <strong>*</strong></span>
        {categoryId ? (
          <small className="selected">{categoryName || categoryId} · {categoryId}</small>
        ) : (
          <small>상품마다 네이버 말단 카테고리를 선택해 주세요.</small>
        )}
      </div>
      <div className="naverCategorySearch">
        <input
          value={query}
          placeholder="예: 사과, 과일 선물세트"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
        />
        <button type="button" className="secondary" onClick={() => void search()} disabled={searching || !query.trim()}>
          {searching ? "검색 중…" : "카테고리 검색"}
        </button>
      </div>
      {results.length > 0 && (
        <ul className="naverCategoryResults">
          {results.map((category) => (
            <li key={category.id}>
              <button type="button" onClick={() => choose(category)}>
                <span>{category.path || category.name}</span>
                <code>{category.id}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searched && results.length === 0 && <p className="naverCategoryEmpty">검색 결과가 없습니다.</p>}
    </div>
  );
}
