"use client";

import { useEffect, useState } from "react";
import { CANONICAL_BY_ID } from "../lib/channels/canonical";
import { CHANNELS } from "../lib/channels/channels";
import {
  filledCount,
  loadRules,
  newRule,
  saveRules,
  type ValueRule,
} from "../lib/channels/valuemap";

type Props = {
  value: ValueRule[];
  onChange: (next: ValueRule[]) => void;
  /** 지금 보고 있는 채널 — 그 열을 강조한다 */
  activeChannelId: string;
  /** 이 규칙에 걸리는 실제 상품명. 쿠팡 추천 정확도를 위해 쓴다 */
  sampleFor?: (rule: ValueRule) => string | undefined;
  onNotice?: (message: string) => void;
};

const MAPPABLE_FIELDS = ["category", "deliveryFeeType", "taxType", "saleStatus", "infoNoticeGroup", "productCondition", "channelExpose"];

type FoundCategory = { id: string; name: string; path: string };

export default function ValueRules({ value, onChange, activeChannelId, sampleFor, onNotice }: Props) {
  const [open, setOpen] = useState(false);
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [found, setFound] = useState<{ ruleId: string; list: FoundCategory[] } | null>(null);

  useEffect(() => {
    onChange(loadRules());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(next: ValueRule[]) {
    onChange(next);
    saveRules(next);
  }

  function patch(id: string, p: Partial<ValueRule>) {
    commit(value.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  function setChannelValue(id: string, channelId: string, v: string) {
    const rule = value.find((r) => r.id === id);
    if (!rule) return;
    patch(id, { byChannel: { ...rule.byChannel, [channelId]: v } });
  }

  /** 네이버 커머스API에서 실제 카테고리 코드를 찾아온다 */
  async function searchNaver(rule: ValueRule) {
    const q = (rule.label || rule.keywords[0] || "").trim();
    if (!q) {
      onNotice?.("먼저 품목 이름을 적어 주세요.");
      return;
    }
    setSearchingId(rule.id);
    setFound(null);
    try {
      const res = await fetch(`/api/naver/categories?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "카테고리를 찾지 못했습니다.");
      if (!data.categories?.length) {
        onNotice?.(`"${q}"로 찾은 카테고리가 없습니다. 다른 이름으로 시도해 보세요.`);
        return;
      }
      setFound({ ruleId: rule.id, list: data.categories });
    } catch (err) {
      onNotice?.(err instanceof Error ? err.message : "카테고리 검색에 실패했습니다.");
    } finally {
      setSearchingId(null);
    }
  }

  /** 쿠팡은 상품명만 보내면 카테고리를 추천해 준다 */
  async function askCoupang(rule: ValueRule) {
    const productName = sampleFor?.(rule) || rule.label || rule.keywords[0] || "";
    if (!productName.trim()) {
      onNotice?.("먼저 품목 이름을 적거나 상품을 선택해 주세요.");
      return;
    }
    setSearchingId(rule.id);
    try {
      const res = await fetch("/api/coupang/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "추천에 실패했습니다.");
      if (!data.ok || !data.categoryId) {
        onNotice?.(data.reason || "쿠팡이 카테고리를 판단하지 못했습니다. 상품명을 더 명확하게 해보세요.");
        return;
      }
      setChannelValue(rule.id, "coupang", data.categoryId);
      onNotice?.(`쿠팡 카테고리 ${data.categoryId} (${data.categoryName})를 넣었습니다. 기준 상품명: ${productName}`);
    } catch (err) {
      onNotice?.(err instanceof Error ? err.message : "쿠팡 추천에 실패했습니다.");
    } finally {
      setSearchingId(null);
    }
  }

  function pickCategory(ruleId: string, c: FoundCategory) {
    setChannelValue(ruleId, "smartstore", c.id);
    setFound(null);
    onNotice?.(`스마트스토어 카테고리 ${c.id} (${c.path || c.name})를 넣었습니다.`);
  }

  function addRule() {
    commit([...value, newRule()]);
    setOpen(true);
  }

  function removeRule(id: string) {
    commit(value.filter((r) => r.id !== id));
  }

  const { filled, total } = filledCount(value, CHANNELS.map((c) => c.id));
  const emptyCategory = value.filter(
    (r) => r.fieldId === "category" && !String(r.byChannel[activeChannelId] ?? "").trim(),
  ).length;

  return (
    <div className="vmr">
      <button className="vmrHead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="vmrCaret">{open ? "▾" : "▸"}</span>
        <b>값 변환 대조표</b>
        <small>
          카테고리·표기를 채널별로 바꿔 넣습니다 · {filled}/{total} 칸
          {emptyCategory > 0 && <em> · 카테고리 {emptyCategory}개 미입력</em>}
        </small>
      </button>

      {open && (
        <div className="vmrBody">
          <p className="vmrIntro">
            채널마다 카테고리 <b>코드 체계가 다릅니다.</b> 각 채널 관리자에서 카테고리를 찾아 코드(또는 분류명)를 한 번만
            복사해 넣으면, 이후 상품명에서 품목을 알아보고 자동으로 채웁니다.
            <br />
            비어 있는 칸은 <b>원본 값이 그대로 나갑니다.</b> 제가 임의로 만들지 않습니다 — 카테고리는 틀려도 에러가 안 나고 조용히 잘못 등록되기 때문입니다.
          </p>

          <div className="vmrScroll">
            <table className="vmrTable">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>이름</th>
                  <th>인식 단어</th>
                  {CHANNELS.map((c) => (
                    <th key={c.id} className={c.id === activeChannelId ? "active" : ""}>
                      {c.label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {value.map((r) => (
                  <tr key={r.id} className={r.fieldId === "category" ? "cat" : ""}>
                    <td>
                      <select value={r.fieldId} onChange={(e) => patch(r.id, { fieldId: e.target.value })}>
                        {MAPPABLE_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {CANONICAL_BY_ID[f]?.label ?? f}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={r.label} placeholder="사과" onChange={(e) => patch(r.id, { label: e.target.value })} />
                    </td>
                    <td>
                      <input
                        value={r.keywords.join(", ")}
                        placeholder="사과, 부사, 홍로"
                        onChange={(e) => patch(r.id, { keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                      />
                    </td>
                    {CHANNELS.map((c) => (
                      <td key={c.id} className={c.id === activeChannelId ? "active" : ""}>
                        <input
                          value={r.byChannel[c.id] ?? ""}
                          placeholder={r.fieldId === "category" ? "코드" : "값"}
                          onChange={(e) => setChannelValue(r.id, c.id, e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="vmrTools">
                      {r.fieldId === "category" && (
                        <>
                          <button
                            className="linkBtn"
                            onClick={() => searchNaver(r)}
                            disabled={searchingId === r.id}
                            title="네이버 커머스API에서 카테고리를 검색합니다"
                          >
                            {searchingId === r.id ? "…" : "네이버"}
                          </button>
                          <button
                            className="linkBtn"
                            onClick={() => askCoupang(r)}
                            disabled={searchingId === r.id}
                            title="쿠팡이 상품명을 보고 카테고리를 추천합니다"
                          >
                            {searchingId === r.id ? "…" : "쿠팡"}
                          </button>
                        </>
                      )}
                      <button className="linkBtn danger" onClick={() => removeRule(r.id)} aria-label="규칙 삭제">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {found && (
            <div className="vmrFound">
              <div className="vmrFoundHead">
                <b>네이버 카테고리 {found.list.length}개</b>
                <button className="linkBtn" onClick={() => setFound(null)}>닫기</button>
              </div>
              <ul>
                {found.list.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => pickCategory(found.ruleId, c)}>
                      <code>{c.id}</code>
                      <span>{c.path || c.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="vmrActions">
            <button className="secondary" onClick={addRule}>
              ＋ 품목 추가
            </button>
            <button
              className="linkBtn"
              onClick={() => {
                commit(loadRules.length ? [] : []);
                onNotice?.("대조표를 비웠습니다. 새로고침하면 기본 품목이 다시 들어옵니다.");
              }}
            >
              전체 비우기
            </button>
          </div>

          <details className="vmrNotes">
            <summary>카테고리 코드는 어디서 찾나요?</summary>
            <ul>
              <li><b>스마트스토어</b> 판매자센터 › 상품관리 › 상품등록에서 카테고리를 고르면 하단에 카테고리ID가 보입니다.</li>
              <li><b>쿠팡</b> Wing › 상품등록에서 카테고리 검색 후 표시되는 분류 경로를 그대로 넣습니다.</li>
              <li><b>카페24</b> 관리자 › 상품관리 › 상품분류 관리의 분류번호를 넣습니다.</li>
              <li><b>11번가</b> 셀러오피스 › 상품등록의 카테고리 코드를 넣습니다.</li>
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
