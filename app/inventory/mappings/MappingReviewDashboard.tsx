"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listUnmappedChannelItems } from "../../lib/inventory/central-inventory";
import {
  buildProductDeletionRequest,
  isExactProductDeletionConfirmation,
  PRODUCT_DELETION_CONFIRMATION,
} from "../../lib/inventory/product-deletion";
import styles from "./mapping-review.module.css";
import alertStyles from "./mapping-review-alerts.module.css";

type InventoryItem = {
  channel: string;
  channelProductNo: string;
  productName: string;
  sellerProductCode: string;
  options: string[];
  imageUrl: string;
  stockQuantity: number | null;
  originProductNo: string;
};

type ReviewGroup = {
  id: string;
  source: "auto" | "manual";
  masterKey: string;
  targetKeys: string[];
};

function itemKey(item: InventoryItem) {
  return `${item.channel}:${item.channelProductNo}`;
}

export default function MappingReviewDashboard() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [groups, setGroups] = useState<ReviewGroup[]>([]);
  const [mappedKeys, setMappedKeys] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "auto" | "manual" | "missing" | "naver-only" | "coupang-only">("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [unmappingId, setUnmappingId] = useState("");
  const [preview, setPreview] = useState<{ url: string; name: string; channel: string } | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<InventoryItem | null>(null);
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deletionError, setDeletionError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [inventoryResponse, mappingResponse] = await Promise.all([
        fetch("/api/inventory", { cache: "no-store" }),
        fetch("/api/inventory/central", { cache: "no-store" }),
      ]);
      const inventoryData = await inventoryResponse.json() as { items?: InventoryItem[]; error?: string };
      const mappingData = await mappingResponse.json() as { reviewGroups?: ReviewGroup[]; mappedKeys?: string[]; error?: string };
      if (!inventoryResponse.ok) throw new Error(inventoryData.error || "상품 이미지를 불러오지 못했습니다.");
      if (!mappingResponse.ok) throw new Error(mappingData.error || "연결 정보를 불러오지 못했습니다.");
      setItems(inventoryData.items ?? []);
      setGroups(mappingData.reviewGroups ?? []);
      setMappedKeys(mappingData.mappedKeys ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "연결 상품 확인 오류");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const itemByKey = useMemo(() => new Map(items.map((item) => [itemKey(item), item])), [items]);
  const unmatched = useMemo(() => listUnmappedChannelItems(items, mappedKeys), [items, mappedKeys]);
  const visibleGroups = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (filter === "naver-only" || filter === "coupang-only") return [];
    return groups.filter((group) => {
      const hasMissing = !itemByKey.has(group.masterKey) || group.targetKeys.some((key) => !itemByKey.has(key));
      if (filter === "missing" ? !hasMissing : filter !== "all" && group.source !== filter) return false;
      if (!text) return true;
      const pair = [itemByKey.get(group.masterKey), ...group.targetKeys.map((key) => itemByKey.get(key))].filter((item): item is InventoryItem => Boolean(item));
      return pair.some((item) => [item.productName, item.sellerProductCode, item.channelProductNo, ...item.options].some((value) => String(value).toLowerCase().includes(text)));
    });
  }, [filter, groups, itemByKey, query]);
  const visibleUnmatched = useMemo(() => {
    if (filter !== "naver-only" && filter !== "coupang-only") return [];
    const candidates = filter === "naver-only" ? unmatched.naver : unmatched.coupang;
    const text = query.trim().toLowerCase();
    return candidates.filter((item) => !text || [item.productName, item.sellerProductCode, item.channelProductNo, ...item.options].some((value) => String(value).toLowerCase().includes(text)));
  }, [filter, query, unmatched]);

  async function unmap(group: ReviewGroup) {
    const naver = itemByKey.get(group.masterKey);
    if (!window.confirm(`'${naver?.productName ?? group.id}'의 직접 연결을 해제할까요? 네이버·쿠팡의 실제 재고는 변경되지 않습니다.`)) return;
    setUnmappingId(group.id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/inventory/central", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unmap", confirmed: true, centralInventoryId: group.id }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "직접 연결 해제에 실패했습니다.");
      setMessage("직접 연결을 해제했습니다. 채널 재고는 변경하지 않았습니다.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "직접 연결 해제 오류");
    } finally { setUnmappingId(""); }
  }

  function openDeletion(item: InventoryItem) {
    setPendingDeletion(item);
    setDeletionConfirmation("");
    setDeletionError("");
    setMessage("");
  }

  function closeDeletion() {
    if (deleting) return;
    setPendingDeletion(null);
    setDeletionConfirmation("");
    setDeletionError("");
  }

  async function confirmDeletion() {
    if (!pendingDeletion || deleting) return;
    if (!isExactProductDeletionConfirmation(deletionConfirmation)) {
      setDeletionError(`문구를 공백과 마침표까지 정확히 입력해 주세요. ${PRODUCT_DELETION_CONFIRMATION}`);
      return;
    }
    if (pendingDeletion.channel !== "naver" && pendingDeletion.channel !== "coupang") {
      setDeletionError("이 채널은 아직 상품 영구삭제를 지원하지 않습니다.");
      return;
    }
    if (!pendingDeletion.originProductNo) {
      setDeletionError("상품 영구삭제에 필요한 원상품번호를 찾지 못했습니다.");
      return;
    }

    setDeleting(true);
    setDeletionError("");
    try {
      const request = buildProductDeletionRequest(pendingDeletion, deletionConfirmation);
      const response = await fetch(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "상품 영구삭제에 실패했습니다.");
      const deletedName = pendingDeletion.productName;
      const channelLabel = pendingDeletion.channel === "naver" ? "네이버" : "쿠팡";
      setPendingDeletion(null);
      setDeletionConfirmation("");
      await load();
      setMessage(`${channelLabel}에서 '${deletedName}' 상품을 영구삭제했습니다.`);
    } catch (caught) {
      setDeletionError(caught instanceof Error ? caught.message : "상품 영구삭제 오류");
    } finally {
      setDeleting(false);
    }
  }

  function product(item: InventoryItem | undefined, channel: "네이버" | "쿠팡") {
    if (!item) return <div className={styles.missing}><strong>{channel} 상품을 찾을 수 없음</strong><span>현재 채널 상품 목록을 다시 확인해 주세요.</span></div>;
    return <div className={styles.product}>
      <button type="button" className={styles.imageButton} disabled={!item.imageUrl} onClick={() => item.imageUrl && setPreview({ url: item.imageUrl, name: item.productName, channel })}>
        {item.imageUrl ? <img src={item.imageUrl} alt={`${item.productName} ${channel} 이미지`} /> : <span>이미지 없음</span>}
        {item.imageUrl && <small>눌러서 크게 보기</small>}
      </button>
      <div className={styles.productInfo}><em>{channel}</em><h2>{item.productName}</h2><p>{item.sellerProductCode || `상품번호 ${item.channelProductNo}`}</p>{item.options.length > 0 && <p>{item.options.join(" · ")}</p>}<strong>재고 {item.stockQuantity == null ? "미확인" : `${item.stockQuantity}개`}</strong></div>
    </div>;
  }

  const manualCount = groups.filter((group) => group.source === "manual").length;
  const missingCount = groups.filter((group) => !itemByKey.has(group.masterKey) || group.targetKeys.some((key) => !itemByKey.has(key))).length;
  return <main className={styles.page}>
    <header><div><span>VISUAL MAPPING REVIEW</span><h1>연결된 상품 <em>이미지 확인</em></h1><p>네이버 기준 상품과 연결된 쿠팡 상품을 사진·상품명·코드로 대조하세요.</p></div><Link href="/inventory">통합재고로 돌아가기</Link></header>
    <section className={styles.content}>
      <div className={styles.toolbar}>
        <div className={styles.filters}><button data-active={filter === "all"} onClick={() => setFilter("all")}>연결 전체 {groups.length}</button><button data-active={filter === "manual"} onClick={() => setFilter("manual")}>직접 연결 {manualCount}</button><button data-active={filter === "auto"} onClick={() => setFilter("auto")}>자동 연결 {groups.length - manualCount}</button><button className={alertStyles.missingFilter} data-active={filter === "missing"} onClick={() => setFilter("missing")}>연결 끊김 {missingCount}</button><button className={alertStyles.channelOnlyFilter} data-active={filter === "naver-only"} onClick={() => setFilter("naver-only")}>네이버만 {unmatched.naver.length}</button><button className={alertStyles.channelOnlyFilter} data-active={filter === "coupang-only"} onClick={() => setFilter("coupang-only")}>쿠팡만 {unmatched.coupang.length}</button></div>
        <label><span className="sr-only">연결 상품 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명·코드 검색" /></label>
      </div>
      {loading && <p className={styles.notice}>연결된 상품과 이미지를 불러오는 중입니다.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.success} role="status">{message}</p>}
      {!loading && !error && (filter === "naver-only" || filter === "coupang-only") && <><div className={alertStyles.onlyGuide}><strong>{filter === "naver-only" ? "네이버에는 있지만 쿠팡과 연결되지 않은 상품" : "쿠팡에는 있지만 네이버와 연결되지 않은 상품"}</strong><span>같은 상품이 반대 채널에 있다면 통합재고에서 직접 연결해 주세요.</span><Link href="/inventory#manual-mapping">미연결 상품 직접 연결로 이동</Link></div><div className={alertStyles.onlyGrid}>{visibleUnmatched.map((item) => <article key={itemKey(item)} className={alertStyles.onlyCard}>{product(item, item.channel === "naver" ? "네이버" : "쿠팡")}<button type="button" className={alertStyles.onlyDeleteButton} disabled={!item.originProductNo} title={!item.originProductNo ? "삭제에 필요한 원상품번호가 없습니다." : undefined} onClick={() => openDeletion(item)}>상품 영구삭제</button></article>)}{visibleUnmatched.length === 0 && <p className={styles.empty}>해당 채널에만 남아 있는 미연결 상품이 없습니다.</p>}</div></>}
      {!loading && !error && filter !== "naver-only" && filter !== "coupang-only" && <div className={styles.grid}>{visibleGroups.map((group) => {
        const master = itemByKey.get(group.masterKey);
        const targets = group.targetKeys.map((key) => itemByKey.get(key));
        const hasMissing = !master || targets.some((target) => !target);
        return <article key={group.id} className={`${styles.card} ${hasMissing ? alertStyles.missingCard : ""}`} data-source={group.source} data-missing={hasMissing}>
          <div className={styles.cardHeading}><span data-source={group.source}>{group.source === "manual" ? "직접 연결" : "자동 연결"}</span>{hasMissing && <strong className={alertStyles.missingBadge}>{!master ? "네이버 상품 없음 · 동기화 제외" : "쿠팡 상품 없음 · 동기화 제외"}</strong>}<small>중앙코드 {group.id}</small>{group.source === "manual" && <button type="button" disabled={Boolean(unmappingId)} onClick={() => void unmap(group)}>{unmappingId === group.id ? "해제 중…" : "잘못 연결됨 · 해제"}</button>}</div>
          <div className={styles.compare}>{product(master, "네이버")}<div className={styles.arrow}>↔</div><div className={styles.targets}>{targets.map((target, index) => <div key={group.targetKeys[index]}>{product(target, "쿠팡")}</div>)}</div></div>
        </article>;
      })}{visibleGroups.length === 0 && <p className={styles.empty}>조건에 맞는 연결 상품이 없습니다.</p>}</div>}
    </section>
    {pendingDeletion && <div className={alertStyles.deletionBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDeletion(); }}>
      <section className={alertStyles.deletionDialog} role="dialog" aria-modal="true" aria-labelledby="mapping-deletion-title" aria-describedby="mapping-deletion-description">
        <span className={alertStyles.warningIcon}>!</span>
        <h2 id="mapping-deletion-title">이 상품을 영구삭제할까요?</h2>
        <p><strong>{pendingDeletion.productName}</strong></p>
        <p id="mapping-deletion-description">{pendingDeletion.channel === "naver" ? "네이버" : "쿠팡"} 판매채널에서 실제 상품이 완전히 삭제되며 되돌릴 수 없습니다.{pendingDeletion.channel === "coupang" ? " 쿠팡 상품은 모든 옵션을 먼저 판매중지해야 삭제할 수 있습니다." : ""}</p>
        <label className={alertStyles.deletionField}>
          <span>아래 문구를 공백과 마침표까지 정확히 입력하세요.</span>
          <code>{PRODUCT_DELETION_CONFIRMATION}</code>
          <input type="text" value={deletionConfirmation} disabled={deleting} autoComplete="off" spellCheck={false} aria-invalid={Boolean(deletionError)} aria-describedby={deletionError ? "mapping-deletion-error" : "mapping-deletion-description"} onChange={(event) => { setDeletionConfirmation(event.target.value); setDeletionError(""); }} onKeyDown={(event) => { if (event.key !== "Enter" || event.nativeEvent.isComposing) return; event.preventDefault(); void confirmDeletion(); }}/>
        </label>
        {deletionError && <p id="mapping-deletion-error" className={alertStyles.deletionError} role="alert">{deletionError}</p>}
        {deleting && <p className={alertStyles.deletingNotice} role="status">판매채널에서 상품을 삭제하는 중입니다…</p>}
        <div className={alertStyles.deletionActions}><button type="button" disabled={deleting} onClick={closeDeletion}>취소</button><button type="button" className={alertStyles.confirmDeleteButton} disabled={deleting || !isExactProductDeletionConfirmation(deletionConfirmation)} onClick={() => void confirmDeletion()}>{deleting ? "삭제 중…" : "상품 영구삭제"}</button></div>
      </section>
    </div>}
    {preview && <div className={styles.previewBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><section role="dialog" aria-modal="true" aria-label={`${preview.channel} 상품 이미지 크게 보기`}><button type="button" onClick={() => setPreview(null)}>닫기</button><img src={preview.url} alt={preview.name}/><p><b>{preview.channel}</b> {preview.name}</p></section></div>}
  </main>;
}
