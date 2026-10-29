"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runBulkInventoryAction } from "../lib/inventory/bulk-actions";
import { getInventoryImageOverlay, getInventoryStatusAction, summarizeInventoryForChannel } from "../lib/inventory/channel-inventory";
import { buildCentralInventoryOverview, explainUnmappedInventoryItem, findCentralInventoryIdForChannelItem } from "../lib/inventory/central-inventory";
import { isExactProductDeletionConfirmation, PRODUCT_DELETION_CONFIRMATION } from "../lib/inventory/product-deletion";
import styles from "./inventory.module.css";
import approvalStyles from "./inventory-approval.module.css";
import bulkStyles from "./inventory-bulk.module.css";
import centralStyles from "./central-inventory.module.css";
import statusStyles from "./inventory-status.module.css";
import layoutStyles from "./inventory-five-column.module.css";

type InventoryItem = {
  channel: string; channelProductNo: string; originProductNo: string; imageUrl: string; productName: string;
  sellerProductCode: string; options: string[]; collectedOrderCount: number; collectedQuantity: number;
  statusType: string; stockQuantity: number | null; fetchedAt?: string; error?: string;
};
type Summary = { productCount: number; totalStockQuantity: number; unknownStockProductCount?: number; saleProductCount: number; soldOutProductCount: number; suspendedProductCount?: number };
type CoupangApprovalCandidate = { sellerProductId: string; sellerProductName: string; statusName: "임시저장" };

type CentralInventoryPreview = {
  initialized: boolean;
  candidateCount: number;
  conflictCodes: string[];
  unmatchedNaverCount: number;
  unmatchedChannelCount: number;
  groups: Array<{ id: string; sellerProductCode: string; productName: string; availableQuantity: number; naverQuantity: number; channelCount: number }>;
  changes: Array<{ centralInventoryId: string; productName: string; channel: string; previousQuantity: number; newQuantity: number }>;
  pendingReservationCount: number;
  shortageQuantity: number;
  missingMappingCount: number;
  mappedKeys: string[];
  mappingGroups: Array<{ id: string; masterKey: string; targetKeys: string[] }>;
  reviewGroups: Array<{ id: string; source: "auto" | "manual"; masterKey: string; targetKeys: string[] }>;
};

const CHANNEL_LABEL: Record<string, string> = { naver: "네이버", coupang: "쿠팡", cafe24: "카페24" };
const STATUS_LABEL: Record<string, string> = { SALE: "판매 중", OUTOFSTOCK: "품절", SUSPENSION: "판매중지", WAIT: "판매 대기", CLOSE: "판매 종료", PROHIBITION: "판매 금지", UNADMISSION: "승인 대기", REJECTION: "승인 거부" };
type PendingStatusChange = { items: InventoryItem[]; targetStatus: "SALE" | "SUSPENSION" };
const COUPANG_APPROVAL_CONFIRMATION = "쿠팡 상품 승인요청";

function inventoryItemKey(item: InventoryItem) {
  return `${item.channel}:${item.channelProductNo}`;
}

function canMutateInventoryItem(item: InventoryItem) {
  return (item.channel === "naver" || item.channel === "coupang") && Boolean(item.originProductNo) && !item.error;
}

export default function InventoryDashboard() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ productCount: 0, totalStockQuantity: 0, saleProductCount: 0, soldOutProductCount: 0 });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkStockQuantity, setBulkStockQuantity] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [busy, setBusy] = useState(true);
  const [updating, setUpdating] = useState("");
  const [pendingStatusChange, setPendingStatusChange] = useState<PendingStatusChange | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<InventoryItem[] | null>(null);
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deletionError, setDeletionError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [approvalCandidates, setApprovalCandidates] = useState<CoupangApprovalCandidate[]>([]);
  const [approvalLoading, setApprovalLoading] = useState(true);
  const [approvalError, setApprovalError] = useState("");
  const [pendingApprovalIds, setPendingApprovalIds] = useState<string[] | null>(null);
  const [approvalConfirmation, setApprovalConfirmation] = useState("");
  const [approving, setApproving] = useState(false);
  const [centralInventory, setCentralInventory] = useState<CentralInventoryPreview | null>(null);
  const [centralLoading, setCentralLoading] = useState(true);
  const [centralBusy, setCentralBusy] = useState(false);
  const [centralError, setCentralError] = useState("");
  const [mappingNaverKey, setMappingNaverKey] = useState("");
  const [mappingCoupangKey, setMappingCoupangKey] = useState("");
  const [mappingBusy, setMappingBusy] = useState(false);
  const [unmappingId, setUnmappingId] = useState("");
  const [message, setMessage] = useState("");
  const modalRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const statusTriggerRef = useRef<HTMLElement | null>(null);
  const deletionModalRef = useRef<HTMLElement>(null);
  const deletionInputRef = useRef<HTMLInputElement>(null);
  const deletionTriggerRef = useRef<HTMLElement | null>(null);

  const loadApprovalCandidates = useCallback(async () => {
    setApprovalLoading(true); setApprovalError("");
    try {
      const response = await fetch("/api/coupang/products/approvals", { cache: "no-store" });
      const data = await response.json() as { items?: CoupangApprovalCandidate[]; error?: string };
      if (!response.ok) throw new Error(data.error || "쿠팡 임시저장 상품을 불러오지 못했습니다.");
      setApprovalCandidates(data.items ?? []);
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "쿠팡 임시저장 상품 조회 오류");
    } finally { setApprovalLoading(false); }
  }, []);

  const loadCentralInventory = useCallback(async () => {
    setCentralLoading(true); setCentralError("");
    try {
      const response = await fetch("/api/inventory/central", { cache: "no-store" });
      const data = await response.json() as CentralInventoryPreview & { error?: string };
      if (!response.ok) throw new Error(data.error || "중앙재고를 불러오지 못했습니다.");
      setCentralInventory(data);
    } catch (error) {
      setCentralError(error instanceof Error ? error.message : "중앙재고 조회 오류");
    } finally { setCentralLoading(false); }
  }, []);

  const loadAll = useCallback(async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/inventory", { cache: "no-store" });
      const data = await response.json() as { items?: InventoryItem[]; summary?: Summary; failedCount?: number; snapshotWarningCount?: number; channelErrors?: Record<string, string>; error?: string };
      if (!response.ok) throw new Error(data.error || "통합 재고를 불러오지 못했습니다.");
      const next = data.items ?? [];
      setItems(next); setSummary(data.summary ?? { productCount: 0, totalStockQuantity: 0, saleProductCount: 0, soldOutProductCount: 0 });
      setQuantities(Object.fromEntries(next.map((item) => [`${item.channel}:${item.channelProductNo}`, item.stockQuantity == null ? "" : String(item.stockQuantity)])));
      setMessage(data.channelErrors?.coupang
        ? `네이버 재고는 표시했지만 쿠팡 재고를 불러오지 못했습니다: ${data.channelErrors.coupang}`
        : data.failedCount
        ? `${data.failedCount}개 상품은 재고를 불러오지 못했습니다.`
        : data.snapshotWarningCount
          ? `전체 상품 ${next.length}개를 표시했습니다. ${data.snapshotWarningCount}개 상품의 로컬 이력 저장은 다시 시도합니다.`
          : `전체 상품 ${next.length}개의 최신 재고를 확인했습니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "통합 재고 조회 오류"); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { queueMicrotask(() => { void loadAll().then(loadCentralInventory); void loadApprovalCandidates(); }); }, [loadAll, loadApprovalCandidates, loadCentralInventory]);

  async function initializeCentralStock() {
    if (!window.confirm("현재 네이버 재고를 중앙재고의 최초 기준값으로 저장할까요? 기존 주문은 다시 차감하지 않습니다.")) return;
    setCentralBusy(true); setCentralError("");
    try {
      const response = await fetch("/api/inventory/central", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "initialize" }),
      });
      const data = await response.json() as { preview?: CentralInventoryPreview; error?: string; count?: number };
      if (!response.ok) throw new Error(data.error || "중앙재고 시작에 실패했습니다.");
      if (data.preview) setCentralInventory(data.preview);
      setMessage(`네이버 기준 중앙재고 ${data.count ?? 0}개를 시작했습니다. 변경 예정 수량을 확인한 뒤 동기화해 주세요.`);
    } catch (error) {
      setCentralError(error instanceof Error ? error.message : "중앙재고 시작 오류");
    } finally { setCentralBusy(false); }
  }

  async function syncCentralStock() {
    if (!centralInventory?.initialized || !centralInventory.changes.length) return;
    if (!window.confirm(`${centralInventory.changes.length}개 채널 재고를 중앙 가용재고로 변경할까요? 네이버와 쿠팡의 실제 재고가 변경됩니다.`)) return;
    setCentralBusy(true); setCentralError("");
    try {
      const response = await fetch("/api/inventory/central", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", confirmed: true }),
      });
      const data = await response.json() as { succeededCount?: number; failedCount?: number; error?: string };
      if (!response.ok && response.status !== 207) throw new Error(data.error || "중앙재고 동기화에 실패했습니다.");
      setMessage(`중앙재고 동기화 완료: 성공 ${data.succeededCount ?? 0}건${data.failedCount ? `, 실패 ${data.failedCount}건` : ""}`);
      await loadAll();
      await loadCentralInventory();
    } catch (error) {
      setCentralError(error instanceof Error ? error.message : "중앙재고 동기화 오류");
    } finally { setCentralBusy(false); }
  }

  async function saveManualProductMapping() {
    const naverItem = items.find((item) => inventoryItemKey(item) === mappingNaverKey);
    const coupangItem = items.find((item) => inventoryItemKey(item) === mappingCoupangKey);
    if (!naverItem || !coupangItem) return;
    if (!window.confirm(`네이버 '${naverItem.productName}'을 기준으로 쿠팡 '${coupangItem.productName}' 옵션을 연결할까요? 연결만 저장하며 재고는 아직 변경하지 않습니다.`)) return;
    setMappingBusy(true); setCentralError("");
    try {
      const response = await fetch("/api/inventory/central", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "map",
          confirmed: true,
          naverChannelProductNo: naverItem.channelProductNo,
          coupangChannelProductNo: coupangItem.channelProductNo,
        }),
      });
      const data = await response.json() as { preview?: CentralInventoryPreview; mapping?: { sellerProductCode?: string }; error?: string };
      if (!response.ok) throw new Error(data.error || "상품 연결 저장에 실패했습니다.");
      if (data.preview) setCentralInventory(data.preview);
      setMappingNaverKey(""); setMappingCoupangKey("");
      setMessage(`상품 연결 완료: ${data.mapping?.sellerProductCode ?? (naverItem.sellerProductCode || naverItem.channelProductNo)}`);
    } catch (error) {
      setCentralError(error instanceof Error ? error.message : "상품 연결 오류");
    } finally { setMappingBusy(false); }
  }

  async function removeProductMapping(group: CentralInventoryPreview["mappingGroups"][number]) {
    const naverItem = items.find((item) => inventoryItemKey(item) === group.masterKey);
    const coupangItems = group.targetKeys.map((key) => items.find((item) => inventoryItemKey(item) === key)).filter((item): item is InventoryItem => Boolean(item));
    const targetNames = coupangItems.map((item) => item.productName).join(", ") || "연결된 쿠팡 상품";
    if (!window.confirm(`네이버 '${naverItem?.productName ?? group.id}'과 쿠팡 '${targetNames}'의 중앙재고 연결을 해제할까요? 채널의 현재 재고와 판매상태는 변경되지 않습니다.`)) return;
    setUnmappingId(group.id); setCentralError("");
    try {
      const response = await fetch("/api/inventory/central", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unmap", confirmed: true, centralInventoryId: group.id }),
      });
      const data = await response.json() as { preview?: CentralInventoryPreview; error?: string };
      if (!response.ok) throw new Error(data.error || "상품 연결 해제에 실패했습니다.");
      if (data.preview) setCentralInventory(data.preview);
      setMessage(`상품 연결 해제 완료: ${naverItem?.productName ?? group.id}`);
    } catch (error) {
      setCentralError(error instanceof Error ? error.message : "상품 연결 해제 오류");
    } finally { setUnmappingId(""); }
  }

  useEffect(() => {
    if (!pendingStatusChange) return;
    cancelButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !changingStatus) {
        setPendingStatusChange(null);
        queueMicrotask(() => statusTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = [...(modalRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (!buttons.length) return;
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pendingStatusChange, changingStatus]);

  function openStatusChange(item: InventoryItem, targetStatus: "SALE" | "SUSPENSION") {
    statusTriggerRef.current = document.activeElement as HTMLElement | null;
    setPendingStatusChange({ items: [item], targetStatus });
  }

  function closeStatusChange() {
    if (changingStatus) return;
    setPendingStatusChange(null);
    queueMicrotask(() => statusTriggerRef.current?.focus());
  }

  useEffect(() => {
    if (!pendingDeletion) return;
    deletionInputRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) {
        setPendingDeletion(null);
        setDeletionConfirmation("");
        setDeletionError("");
        queueMicrotask(() => deletionTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(deletionModalRef.current?.querySelectorAll<HTMLElement>("input, button:not(:disabled)") ?? [])];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pendingDeletion, deleting]);

  function openDeletion(item: InventoryItem) {
    deletionTriggerRef.current = document.activeElement as HTMLElement | null;
    setDeletionConfirmation("");
    setDeletionError("");
    setPendingDeletion([item]);
  }

  function closeDeletion() {
    if (deleting) return;
    setPendingDeletion(null);
    setDeletionConfirmation("");
    setDeletionError("");
    queueMicrotask(() => deletionTriggerRef.current?.focus());
  }

  const filtered = useMemo(() => items.filter((item) => {
    const text = query.trim().toLowerCase();
    const textMatch = !text || [item.productName, item.sellerProductCode, item.channelProductNo, ...item.options].some((value) => value.toLowerCase().includes(text));
    return textMatch && (channel === "all" || item.channel === channel) && (status === "all" || item.statusType === status);
  }), [items, query, channel, status]);
  const channelSummary = useMemo(
    () => summarizeInventoryForChannel(items, channel as "all" | "naver" | "coupang" | "cafe24"),
    [items, channel],
  );
  const selectableFiltered = useMemo(() => filtered.filter(canMutateInventoryItem), [filtered]);
  const selectedItems = useMemo(() => {
    const keys = new Set(selectedKeys);
    return items.filter((item) => keys.has(inventoryItemKey(item)) && canMutateInventoryItem(item));
  }, [items, selectedKeys]);
  const mappedInventoryKeys = useMemo(() => new Set(centralInventory?.mappedKeys ?? []), [centralInventory?.mappedKeys]);
  const integratedOverview = useMemo(() => centralInventory?.initialized
    ? buildCentralInventoryOverview(items, centralInventory.reviewGroups)
    : null, [centralInventory?.initialized, centralInventory?.reviewGroups, items]);
  const displayedSummary = integratedOverview ?? summary;
  const unmappedByChannel = useMemo(() => {
    const available = items.filter((item) => !mappedInventoryKeys.has(inventoryItemKey(item)) && !item.error && item.stockQuantity != null);
    return {
      naver: available.filter((item) => item.channel === "naver"),
      coupang: available.filter((item) => item.channel === "coupang"),
    };
  }, [items, mappedInventoryKeys]);

  async function requestStockUpdate(item: InventoryItem, stockQuantity: number) {
    const centralInventoryId = centralInventory?.initialized
      ? findCentralInventoryIdForChannelItem(centralInventory.reviewGroups, item.channel, item.channelProductNo)
      : null;
    if (centralInventoryId) {
      const response = await fetch("/api/inventory/central", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-quantity",
          confirmed: true,
          channel: item.channel,
          channelProductNo: item.channelProductNo,
          stockQuantity,
        }),
      });
      const data = await response.json() as {
        error?: string;
        failedCount?: number;
        failed?: Array<{ channel: string; error: string }>;
      };
      if (!response.ok || data.failedCount) {
        const details = data.failed?.map((failure) => `${CHANNEL_LABEL[failure.channel] ?? failure.channel}: ${failure.error}`).join(" / ");
        throw new Error(data.error || details || "연결 채널의 중앙재고 수정에 실패했습니다.");
      }
      return { centralInventoryId };
    }

    const response = await fetch(item.channel === "naver" ? "/api/naver/inventory" : "/api/coupang/inventory", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item.channel === "naver"
        ? { channelProductNo: item.channelProductNo, stockQuantity }
        : { vendorItemId: item.channelProductNo, stockQuantity }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error || "재고 수정에 실패했습니다.");
    return { centralInventoryId: null };
  }

  async function requestStatusChange(item: InventoryItem, targetStatus: "SALE" | "SUSPENSION") {
    const response = await fetch(item.channel === "naver" ? "/api/naver/products/status" : "/api/coupang/products/status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item.channel === "naver"
        ? { originProductNo: item.originProductNo, statusType: targetStatus }
        : { vendorItemId: item.channelProductNo, statusType: targetStatus }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error || "판매 상태 변경에 실패했습니다.");
  }

  async function requestProductDeletion(item: InventoryItem) {
    const response = await fetch(item.channel === "naver" ? "/api/naver/products/delete" : "/api/coupang/products/delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item.channel === "naver"
        ? { originProductNo: item.originProductNo, confirmation: deletionConfirmation }
        : { sellerProductId: item.originProductNo, confirmation: deletionConfirmation }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error || "상품 영구삭제에 실패했습니다.");
  }

  async function update(item: InventoryItem) {
    const key = `${item.channel}:${item.channelProductNo}`;
    const next = Number(quantities[key]);
    const centralInventoryId = centralInventory?.initialized
      ? findCentralInventoryIdForChannelItem(centralInventory.reviewGroups, item.channel, item.channelProductNo)
      : null;
    if (item.channel !== "naver" && item.channel !== "coupang") { setMessage(`${CHANNEL_LABEL[item.channel] ?? item.channel} 재고 수정은 API 연결 후 제공됩니다.`); return; }
    if (!Number.isSafeInteger(next) || next < 0 || (centralInventoryId && next > 99_999)) { setMessage(centralInventoryId ? "통합재고는 0 이상 99,999 이하의 정수로 입력해 주세요." : "재고는 0 이상의 정수로 입력해 주세요."); return; }
    const confirmMessage = centralInventoryId
      ? `${item.productName}의 중앙재고를 ${next}개로 변경할까요? 연결된 네이버와 쿠팡 재고가 함께 변경됩니다.`
      : `${CHANNEL_LABEL[item.channel]}의 ${item.productName} 재고를 ${item.stockQuantity}개에서 ${next}개로 변경할까요?`;
    if (!window.confirm(confirmMessage)) return;
    setUpdating(key); setMessage("");
    try {
      await requestStockUpdate(item, next);
      await loadAll(); await loadCentralInventory();
      setMessage(centralInventoryId
        ? `${item.productName} 중앙재고를 ${next}개로 수정하고 네이버·쿠팡에 반영했습니다.`
        : `${CHANNEL_LABEL[item.channel]} ${item.productName} 재고를 ${next}개로 수정했습니다.`);
    } catch (error) {
      await loadAll(); await loadCentralInventory();
      setMessage(error instanceof Error ? error.message : "재고 수정 오류");
    }
    finally { setUpdating(""); }
  }

  async function confirmStatusChange() {
    if (!pendingStatusChange) return;
    const { items: targets, targetStatus } = pendingStatusChange;
    if (targetStatus === "SALE" && targets.some((item) => item.stockQuantity == null || item.stockQuantity < 1)) {
      setMessage("판매를 재개하려면 먼저 재고를 1개 이상으로 수정해 주세요.");
      return;
    }
    setChangingStatus(true); setMessage("");
    try {
      const result = await runBulkInventoryAction(
        targets.map((item) => ({ ...item, id: inventoryItemKey(item) })),
        async (item) => requestStatusChange(item, targetStatus),
      );
      setPendingStatusChange(null);
      setSelectedKeys([]);
      await loadAll();
      setMessage(`${result.succeeded.length}개 상품을 ${targetStatus === "SALE" ? "판매중으로" : "판매중지로"} 변경했습니다.${result.failed.length ? ` ${result.failed.length}개 실패: ${result.failed.map((item) => item.error).join(" / ")}` : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "판매 상태 변경 오류"); }
    finally { setChangingStatus(false); }
  }

  async function confirmDeletion() {
    if (!pendingDeletion || deleting) return;
    if (!isExactProductDeletionConfirmation(deletionConfirmation)) {
      setDeletionError(`문구를 공백과 마침표까지 정확히 입력해 주세요: ${PRODUCT_DELETION_CONFIRMATION}`);
      return;
    }
    const targets = [...new Map(pendingDeletion.map((item) => [`${item.channel}:${item.originProductNo}`, item])).values()];
    setDeleting(true); setDeletionError(""); setMessage("");
    try {
      const result = await runBulkInventoryAction(
        targets.map((item) => ({ ...item, id: `${item.channel}:${item.originProductNo}` })),
        requestProductDeletion,
      );
      setPendingDeletion(null); setDeletionConfirmation("");
      setSelectedKeys([]);
      await loadAll();
      setMessage(`${result.succeeded.length}개 상품을 영구삭제했습니다.${result.failed.length ? ` ${result.failed.length}개 실패: ${result.failed.map((item) => item.error).join(" / ")}` : ""}`);
    } catch (error) {
      setDeletionError(error instanceof Error ? error.message : "상품 영구삭제 오류");
    } finally { setDeleting(false); }
  }

  function toggleSelection(item: InventoryItem) {
    const key = inventoryItemKey(item);
    setSelectedKeys((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  }

  function toggleAllVisible() {
    const visibleKeys = selectableFiltered.map(inventoryItemKey);
    const allSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.includes(key));
    setSelectedKeys((current) => allSelected
      ? current.filter((key) => !visibleKeys.includes(key))
      : [...new Set([...current, ...visibleKeys])]);
  }

  function openBulkStatusChange(targetStatus: "SALE" | "SUSPENSION") {
    if (!selectedItems.length) return;
    statusTriggerRef.current = document.activeElement as HTMLElement | null;
    setPendingStatusChange({ items: selectedItems, targetStatus });
  }

  function openBulkDeletion() {
    if (!selectedItems.length) return;
    deletionTriggerRef.current = document.activeElement as HTMLElement | null;
    setDeletionConfirmation(""); setDeletionError(""); setPendingDeletion(selectedItems);
  }

  async function applyBulkStock() {
    const next = Number(bulkStockQuantity);
    if (!selectedItems.length) return;
    if (!Number.isSafeInteger(next) || next < 0 || next > 99_999) {
      setMessage("일괄 재고는 0 이상 99,999 이하의 정수로 입력해 주세요.");
      return;
    }
    const targets = [...new Map(selectedItems.map((item) => {
      const centralInventoryId = centralInventory?.initialized
        ? findCentralInventoryIdForChannelItem(centralInventory.reviewGroups, item.channel, item.channelProductNo)
        : null;
      const id = centralInventoryId ? `central:${centralInventoryId}` : inventoryItemKey(item);
      return [id, { ...item, id }];
    })).values()];
    if (!window.confirm(`선택한 ${targets.length}개 상품의 재고를 모두 ${next}개로 변경할까요? 중앙재고 연결 상품은 네이버와 쿠팡에 함께 반영됩니다.`)) return;
    setBulkBusy(true); setMessage("");
    try {
      const result = await runBulkInventoryAction(
        targets,
        async (item) => requestStockUpdate(item, next),
      );
      setSelectedKeys([]); setBulkStockQuantity("");
      await loadAll(); await loadCentralInventory();
      setMessage(`${result.succeeded.length}개 상품 재고를 ${next}개로 변경했습니다.${result.failed.length ? ` ${result.failed.length}개 실패: ${result.failed.map((item) => item.error).join(" / ")}` : ""}`);
    } finally { setBulkBusy(false); }
  }

  function openApproval(ids: string[]) {
    setApprovalConfirmation("");
    setPendingApprovalIds(ids);
  }

  function closeApproval() {
    if (approving) return;
    setPendingApprovalIds(null);
    setApprovalConfirmation("");
  }

  async function confirmApproval() {
    if (!pendingApprovalIds?.length || approving) return;
    if (approvalConfirmation !== COUPANG_APPROVAL_CONFIRMATION) {
      setApprovalError(`확인 문구를 정확히 입력해 주세요: ${COUPANG_APPROVAL_CONFIRMATION}`);
      return;
    }
    const requestedCount = pendingApprovalIds.length;
    setApproving(true); setApprovalError(""); setMessage("");
    try {
      const response = await fetch("/api/coupang/products/approvals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerProductIds: pendingApprovalIds, confirmation: approvalConfirmation }),
      });
      const data = await response.json() as { approvedCount?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "쿠팡 상품 승인요청에 실패했습니다.");
      setPendingApprovalIds(null); setApprovalConfirmation("");
      await loadApprovalCandidates();
      setMessage(`${data.approvedCount ?? requestedCount}개 상품의 쿠팡 승인요청을 보냈습니다. 쿠팡 처리 후 판매 상품과 재고 카드에 표시됩니다.`);
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "쿠팡 상품 승인요청 오류");
    } finally { setApproving(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/" className={styles.brand}><span>果</span><div><b>담다 AI</b><small>통합 재고 현황</small></div></Link><Link href="/" className={styles.back}>대시보드로</Link></header>
    <section className={styles.hero}><div><span>OMNICHANNEL INVENTORY</span><h1>판매 상품을 사진으로 보고<br/><em>전체 재고를 한눈에.</em></h1><p>네이버와 쿠팡의 상품·옵션별 실재고를 한 화면에서 조회합니다. 카페24도 같은 구조로 연결됩니다.</p></div><button onClick={() => void loadAll()} disabled={busy}>{busy ? "재고 확인 중…" : "전체 재고 새로고침"}</button></section>
    <section className={styles.content}>
      <section className={approvalStyles.panel} aria-labelledby="coupang-approval-title">
        <div className={approvalStyles.heading}>
          <div><small>COUPANG PRODUCT APPROVAL</small><h2 id="coupang-approval-title">쿠팡 임시저장 상품 <b>{approvalLoading ? "확인 중" : `${approvalCandidates.length}개`}</b></h2><p>승인요청이 끝나야 쿠팡 상품 페이지와 재고 카드에 표시됩니다.</p></div>
          <div><button type="button" onClick={() => void loadApprovalCandidates()} disabled={approvalLoading || approving}>다시 확인</button><button type="button" className={approvalStyles.approveAllButton} onClick={() => openApproval(approvalCandidates.map((item) => item.sellerProductId))} disabled={!approvalCandidates.length || approving}>전체 승인요청</button></div>
        </div>
        {approvalError && <p className={approvalStyles.error} role="alert">{approvalError}</p>}
        {!approvalLoading && approvalCandidates.length > 0 && <div className={approvalStyles.list}>{approvalCandidates.map((item) => <div key={item.sellerProductId}><span><b>{item.sellerProductName || `쿠팡 상품 ${item.sellerProductId}`}</b><small>상품 ID {item.sellerProductId} · 임시저장</small></span><button type="button" onClick={() => openApproval([item.sellerProductId])} disabled={approving}>이 상품만 시험</button></div>)}</div>}
        {!approvalLoading && !approvalCandidates.length && !approvalError && <p className={approvalStyles.empty}>승인요청할 임시저장 상품이 없습니다.</p>}
      </section>
      <section className={centralStyles.panel} aria-labelledby="central-inventory-title">
        <div className={centralStyles.heading}>
          <div><small>NAVER MASTER INVENTORY</small><h2 id="central-inventory-title">네이버 기준 <b>중앙재고</b></h2><p>네이버의 최초 재고에서 모든 채널의 새 주문을 한 번만 차감하고, 남은 수량을 네이버·쿠팡에 맞춥니다.</p></div>
          <div className={centralStyles.actions}><Link href="/inventory/mappings" className={centralStyles.reviewLink}>연결 이미지 확인</Link><button type="button" onClick={() => void loadCentralInventory()} disabled={centralLoading || centralBusy}>다시 확인</button>{centralInventory?.initialized ? <button type="button" className={centralStyles.syncButton} onClick={() => void syncCentralStock()} disabled={centralBusy || !centralInventory.changes.length}>{centralBusy ? "동기화 중…" : `재고 동기화 ${centralInventory.changes.length}건`}</button> : <button type="button" className={centralStyles.startButton} onClick={() => void initializeCentralStock()} disabled={centralBusy || centralLoading || !centralInventory?.candidateCount}>{centralBusy ? "시작 중…" : "네이버 기준으로 시작"}</button>}</div>
        </div>
        {centralLoading && <p className={centralStyles.loading} role="status">저장된 재고를 기준으로 중앙재고를 계산하는 중입니다.</p>}
        {centralError && <p className={centralStyles.error} role="alert">{centralError}</p>}
        {!centralLoading && centralInventory && <>
          <div className={centralStyles.metrics}>
            <div><small>{centralInventory.initialized ? "연결 상품" : "연결 가능"}</small><b>{centralInventory.candidateCount}</b><span>개</span></div>
            <div><small>중앙 가용재고</small><b>{centralInventory.groups.reduce((sum, item) => sum + item.availableQuantity, 0).toLocaleString("ko-KR")}</b><span>개</span></div>
            <div><small>변경 예정</small><b>{centralInventory.changes.length}</b><span>건</span></div>
            <div><small>새 주문 반영</small><b>{centralInventory.pendingReservationCount}</b><span>건</span></div>
            <div><small>코드 정리 필요</small><b>{integratedOverview?.codeCleanupCount ?? 0}</b><span>개</span></div>
          </div>
          {centralInventory.initialized && <p className={centralStyles.policy}>상품명은 채널별로 유지하고, 중앙코드·옵션 연결·가용재고는 하나로 관리합니다. 재고 0은 통합 품절로, 모든 채널이 판매중지된 상품만 통합 판매중지로 계산합니다.</p>}
          {!centralInventory.initialized && <p className={centralStyles.guide}>정확한 상품코드 1:1 매칭만 연결합니다. 코드 충돌 {centralInventory.conflictCodes.length}개, 네이버만 있는 상품 {centralInventory.unmatchedNaverCount}개, 다른 채널만 있는 상품 {centralInventory.unmatchedChannelCount}개는 자동 변경하지 않습니다.</p>}
          {centralInventory.missingMappingCount > 0 && <p className={centralStyles.warning}>현재 채널에서 찾을 수 없는 연결 상품 {centralInventory.missingMappingCount}개는 동기화에서 제외됩니다.</p>}
          {centralInventory.shortageQuantity > 0 && <p className={centralStyles.error}>주문량이 중앙재고보다 {centralInventory.shortageQuantity}개 많습니다. 가용재고는 0으로 유지되며 확인이 필요합니다.</p>}
          {centralInventory.changes.length > 0 && <div className={centralStyles.changeList} aria-label="재고 변경 예정 목록">{centralInventory.changes.slice(0, 8).map((change, index) => <div key={`${change.centralInventoryId}:${change.channel}:${index}`}><span><b>{change.productName}</b><small>{CHANNEL_LABEL[change.channel] ?? change.channel}</small></span><strong>{change.previousQuantity} → {change.newQuantity}</strong></div>)}{centralInventory.changes.length > 8 && <p>외 {centralInventory.changes.length - 8}건</p>}</div>}
          {centralInventory.initialized && !centralInventory.changes.length && !centralInventory.missingMappingCount && <p className={centralStyles.synced}>네이버와 쿠팡 재고가 중앙 가용재고와 같습니다.</p>}
          {integratedOverview && integratedOverview.codeCleanupCount > 0 && <details className={centralStyles.codeCleanup}><summary>중앙코드와 다른 채널 상품 확인 <b>{integratedOverview.codeCleanupCount}개</b></summary><p>채널의 기존 상품명과 고유번호는 유지됩니다. 아래 상품은 내부 중앙코드로 연결되어 동기화되며, 신규 등록부터 동일 코드를 사용합니다.</p><div>{integratedOverview.codeCleanupProducts.map((item) => <div key={item.id}><span><b>{item.productName}</b><small>중앙코드 {item.id}</small></span><em>{item.channels.map((channel) => CHANNEL_LABEL[channel] ?? channel).join(" · ")} 코드 다름</em></div>)}</div></details>}
          {centralInventory.initialized && centralInventory.mappingGroups.length > 0 && <details className={centralStyles.connectedManager}><summary>직접 연결한 상품 관리 <b>{centralInventory.mappingGroups.length}개</b></summary><p className={centralStyles.connectedGuide}>미연결 상품 목록에서 직접 연결한 항목만 표시합니다. 처음에 자동 연결된 상품은 해제되지 않습니다.</p><div>{centralInventory.mappingGroups.map((mapping) => { const group = centralInventory.groups.find((item) => item.id === mapping.id); const naverItem = items.find((item) => inventoryItemKey(item) === mapping.masterKey); const targetItems = mapping.targetKeys.map((key) => items.find((item) => inventoryItemKey(item) === key)).filter((item): item is InventoryItem => Boolean(item)); return <div className={centralStyles.connectedRow} key={mapping.id}><span><b>{naverItem?.productName ?? group?.productName ?? mapping.id}</b><small>네이버 → {targetItems.map((item) => item.productName).join(" · ") || "쿠팡 연결 상품"}</small></span><button type="button" onClick={() => void removeProductMapping(mapping)} disabled={Boolean(unmappingId)}>{unmappingId === mapping.id ? "해제 중…" : "수동 연결 해제"}</button></div>; })}</div></details>}
        </>}
      </section>
      {centralInventory?.initialized && (unmappedByChannel.naver.length > 0 || unmappedByChannel.coupang.length > 0) && <section id="manual-mapping" className={centralStyles.mappingPanel} aria-labelledby="manual-mapping-title">
        <div className={centralStyles.mappingHeading}><div><small>MANUAL PRODUCT MATCHING</small><h2 id="manual-mapping-title">미연결 상품 직접 연결</h2><p>사진과 상품명을 확인해 같은 상품을 양쪽에서 하나씩 선택하세요. 네이버 상품을 중앙 기준으로 사용합니다.</p><p className={centralStyles.mappingSelectionStatus} aria-live="polite"><b data-complete={Boolean(mappingNaverKey)}>네이버 {mappingNaverKey ? "선택 완료" : "선택 필요"}</b><b data-complete={Boolean(mappingCoupangKey)}>쿠팡 {mappingCoupangKey ? "선택 완료" : "선택 필요"}</b></p></div><button type="button" onClick={() => void saveManualProductMapping()} disabled={mappingBusy || !mappingNaverKey || !mappingCoupangKey}>{mappingBusy ? "연결 저장 중…" : !mappingNaverKey ? "네이버 상품을 선택하세요" : !mappingCoupangKey ? "쿠팡 상품을 선택하세요" : "선택 상품 연결"}</button></div>
        <div className={centralStyles.mappingColumns}>
          <section aria-labelledby="unmapped-naver-title"><h3 id="unmapped-naver-title">네이버 미연결 <b>{unmappedByChannel.naver.length}개</b></h3><div className={centralStyles.mappingList}>{unmappedByChannel.naver.map((item) => { const key = inventoryItemKey(item); return <button type="button" key={key} aria-pressed={mappingNaverKey === key} data-selected={mappingNaverKey === key} onClick={() => setMappingNaverKey((current) => current === key ? "" : key)}>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className={centralStyles.noImage}>이미지 없음</span>}<span><b>{item.productName}</b><small>{item.sellerProductCode || `내부코드 NAVER-${item.channelProductNo}`}</small><em>재고 {item.stockQuantity}개</em><span className={centralStyles.mappingReason}>미연결 이유: {explainUnmappedInventoryItem(items, item)}</span></span></button>; })}</div></section>
          <section aria-labelledby="unmapped-coupang-title"><h3 id="unmapped-coupang-title">쿠팡 미연결 <b>{unmappedByChannel.coupang.length}개</b></h3><div className={centralStyles.mappingList}>{unmappedByChannel.coupang.map((item) => { const key = inventoryItemKey(item); return <button type="button" key={key} aria-pressed={mappingCoupangKey === key} data-selected={mappingCoupangKey === key} onClick={() => setMappingCoupangKey((current) => current === key ? "" : key)}>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className={centralStyles.noImage}>이미지 없음</span>}<span><b>{item.productName}</b><small>{item.sellerProductCode || `옵션 ${item.channelProductNo}`}</small><em>재고 {item.stockQuantity}개 · {item.options.join(" · ") || "단일옵션"}</em><span className={centralStyles.mappingReason}>미연결 이유: {explainUnmappedInventoryItem(items, item)}</span></span></button>; })}</div></section>
        </div>
        <p className={centralStyles.mappingNote}>선택된 상품을 연결해도 즉시 재고가 변경되지는 않습니다. 연결 후 중앙재고의 변경 예정 목록을 확인하고 별도로 동기화해야 합니다.</p>
      </section>}
      <div className={styles.channelBar} aria-label="판매 채널 필터"><button aria-pressed={channel === "all"} data-active={channel === "all"} onClick={() => setChannel("all")}>전체 채널 <b>{items.length}</b></button><button aria-pressed={channel === "naver"} data-active={channel === "naver"} onClick={() => setChannel("naver")}>네이버 <b>{items.filter((item) => item.channel === "naver").length}</b></button><button aria-pressed={channel === "coupang"} data-active={channel === "coupang"} onClick={() => setChannel("coupang")}>쿠팡 <b>{items.filter((item) => item.channel === "coupang").length}</b></button><button disabled>카페24 <small>연결 예정</small></button></div>
      <div className={styles.statusBar} aria-label="판매 상태 필터"><button data-active={status === "all"} onClick={() => setStatus("all")}>전체 {channelSummary.productCount}</button><button data-active={status === "SALE"} onClick={() => setStatus("SALE")}>판매 중 {channelSummary.saleProductCount}</button><button data-active={status === "OUTOFSTOCK"} onClick={() => setStatus("OUTOFSTOCK")}>품절 {channelSummary.soldOutProductCount}</button><button data-active={status === "SUSPENSION"} onClick={() => setStatus("SUSPENSION")}>판매중지 {channelSummary.suspendedProductCount}</button></div>
      <div className={styles.summary}><div><small>{integratedOverview ? "통합 재고" : "전체 재고"}</small><b>{displayedSummary.totalStockQuantity.toLocaleString("ko-KR")}</b><span>{displayedSummary.unknownStockProductCount ? `개 · 미확인 ${displayedSummary.unknownStockProductCount}종 제외` : "개"}</span></div><div><small>{integratedOverview ? "통합 상품·옵션" : "전체 상품·옵션"}</small><b>{displayedSummary.productCount}</b><span>종</span></div><div><small>판매 중 · 통합</small><b>{displayedSummary.saleProductCount}</b><span>종</span></div><div><small>품절 · 통합</small><b>{displayedSummary.soldOutProductCount}</b><span>종</span></div><div><small>판매중지 · 통합</small><b>{displayedSummary.suspendedProductCount ?? 0}</b><span>종</span></div></div>
      {message && <p className={styles.notice} role="status">{message}</p>}
      <div className={styles.toolbar}><div><span>상품 재고 카드</span><b>{filtered.length}개 상품</b></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명·상품코드·옵션 검색" /></div>
      <section className={bulkStyles.bar} aria-label="선택 상품 일괄 작업">
        <label className={bulkStyles.selectAll}><input type="checkbox" checked={selectableFiltered.length > 0 && selectableFiltered.every((item) => selectedKeys.includes(inventoryItemKey(item)))} onChange={toggleAllVisible}/><span>현재 목록 전체 선택</span></label>
        <strong>{selectedItems.length}개 선택</strong>
        <div className={bulkStyles.stockGroup}><label><span>같은 재고 적용</span><input type="number" min="0" max="99999" step="1" placeholder="수량" value={bulkStockQuantity} onChange={(event) => setBulkStockQuantity(event.target.value)} disabled={!selectedItems.length || bulkBusy}/></label><button type="button" onClick={() => void applyBulkStock()} disabled={!selectedItems.length || bulkBusy || bulkStockQuantity === ""}>{bulkBusy ? "처리 중…" : "재고 일괄변경"}</button></div>
        <div className={bulkStyles.actions}><button type="button" onClick={() => openBulkStatusChange("SUSPENSION")} disabled={!selectedItems.length || bulkBusy}>선택 판매중지</button><button type="button" onClick={() => openBulkStatusChange("SALE")} disabled={!selectedItems.length || bulkBusy}>선택 판매재개</button><button type="button" className={bulkStyles.danger} onClick={openBulkDeletion} disabled={!selectedItems.length || bulkBusy}>선택 영구삭제</button><button type="button" onClick={() => setSelectedKeys([])} disabled={!selectedItems.length || bulkBusy}>선택 해제</button></div>
      </section>
      <div className={`${styles.grid} ${layoutStyles.fiveColumnGrid}`} aria-live="polite">
        {busy && !items.length ? <p className={styles.empty}>네이버와 쿠팡의 전체 상품·옵션 재고를 불러오는 중입니다.</p> : !filtered.length ? <p className={styles.empty}>선택한 조건에 해당하는 상품이 없습니다.</p> : filtered.map((item) => {
          const key = `${item.channel}:${item.channelProductNo}`;
          const isSuspended = item.statusType === "SUSPENSION";
          const statusAction = getInventoryStatusAction(item.statusType, item.stockQuantity);
          const canMutate = (item.channel === "naver" || item.channel === "coupang") && Boolean(item.originProductNo) && !item.error;
          const canChangeStatus = canMutate && Boolean(statusAction?.enabled);
          const canDelete = canMutate;
          const imageOverlay = getInventoryImageOverlay(item.statusType);
          const selected = selectedKeys.includes(key);
          const isCentralMapped = mappedInventoryKeys.has(key);
          return <article className={`${styles.card} ${selected ? bulkStyles.selectedCard : ""}`} key={key}>
            <div className={styles.image}>{canMutate && <label className={bulkStyles.cardCheckbox}><input type="checkbox" checked={selected} onChange={() => toggleSelection(item)} aria-label={`${item.productName} 선택`}/><span>{selected ? "선택됨" : "선택"}</span></label>}{item.imageUrl ? <img src={item.imageUrl} alt={`${item.productName} 대표 이미지`} /> : <span>상품 이미지<br/>불러오기 실패</span>}{imageOverlay && <span className={statusStyles.imageStatusOverlay} data-tone={imageOverlay.tone}><strong>{imageOverlay.label}</strong></span>}<em>{CHANNEL_LABEL[item.channel] ?? item.channel}</em></div>
            <div className={styles.cardBody}>
              <div className={styles.cardMeta}><span data-status={item.statusType}>{item.error ? "조회 실패" : STATUS_LABEL[item.statusType] ?? item.statusType}</span><small>{item.sellerProductCode || `상품 ${item.channelProductNo}`}</small></div>
              {isCentralMapped && <p className={centralStyles.connectedBadge}>✓ 중앙재고 연결됨</p>}
              <h2>{item.productName}</h2>
              {item.options.length > 0 && <p className={styles.options}>{item.options.join(" · ")}</p>}
              <dl><div><dt>수집 주문</dt><dd>{item.collectedOrderCount}건 · {item.collectedQuantity}개 판매</dd></div><div><dt>채널 상품번호</dt><dd>{item.channelProductNo}</dd></div></dl>
              {item.error ? <p className={styles.error}>{item.error}</p> : <div className={styles.stock}>
                <div><small>{CHANNEL_LABEL[item.channel] ?? item.channel} 현재 재고</small><b>{item.stockQuantity == null ? "미확인" : item.stockQuantity.toLocaleString("ko-KR")}{item.stockQuantity != null && <em>개</em>}</b></div>
                <label><span className="sr-only">변경할 재고</span><input type="number" min="0" max={isCentralMapped || item.channel === "coupang" ? 99999 : undefined} step="1" placeholder="재고 입력" disabled={!canMutate} value={quantities[key] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [key]: event.target.value }))}/><button onClick={() => void update(item)} disabled={!canMutate || updating === key || quantities[key] === "" || quantities[key] === String(item.stockQuantity)}>{!canMutate ? "조회 전용" : updating === key ? "수정 중…" : isCentralMapped ? "통합재고 수정" : "재고 수정"}</button></label>
              </div>}
              <div className={styles.cardActions}>
                <button
                  className={isSuspended ? statusStyles.resumeButton : styles.suspendButton}
                  disabled={!canChangeStatus}
                  title={statusAction && !statusAction.enabled ? statusAction.disabledLabel : undefined}
                  onClick={() => statusAction && openStatusChange(item, statusAction.targetStatus)}
                >{statusAction ? (statusAction.enabled ? statusAction.label : statusAction.disabledLabel) : "현재 상태에서 변경 불가"}</button>
                <button className={statusStyles.deleteButton} disabled={!canDelete} title={item.channel === "coupang" ? "쿠팡은 상품의 모든 옵션을 판매중지한 뒤 삭제할 수 있습니다." : undefined} onClick={() => openDeletion(item)}>상품 영구삭제</button>
              </div>
            </div>
          </article>;
        })}
      </div>
    </section>
    {pendingStatusChange && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeStatusChange(); }}>
      <section ref={modalRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="status-change-title" aria-describedby="status-change-description">
        <span className={pendingStatusChange.targetStatus === "SALE" ? statusStyles.resumeIcon : styles.warningIcon}>{pendingStatusChange.targetStatus === "SALE" ? "✓" : "!"}</span>
        <h2 id="status-change-title">정말 {pendingStatusChange.targetStatus === "SALE" ? "판매중으로" : "판매중지로"} 변경할까요?</h2>
        <p><strong>{pendingStatusChange.items.length === 1 ? pendingStatusChange.items[0].productName : `선택 상품 ${pendingStatusChange.items.length}개`}</strong></p>
        <p id="status-change-description">{pendingStatusChange.targetStatus === "SALE"
          ? `최종 확인을 누르면 선택한 ${pendingStatusChange.items.length}개 상품이 각 판매채널에서 판매중으로 변경됩니다. 재고가 없는 상품이 포함되면 실행하지 않습니다.`
          : `최종 확인을 누르면 선택한 ${pendingStatusChange.items.length}개 상품이 각 판매채널에서 판매중지됩니다. 상품 카드는 삭제되지 않고 목록에 계속 남습니다.`}</p>
        <div><button ref={cancelButtonRef} className={styles.cancelButton} disabled={changingStatus} onClick={closeStatusChange}>취소</button><button className={pendingStatusChange.targetStatus === "SALE" ? statusStyles.finalResumeButton : styles.finalSuspendButton} disabled={changingStatus} onClick={() => void confirmStatusChange()}>{changingStatus ? "변경 중…" : pendingStatusChange.targetStatus === "SALE" ? "최종 판매재개" : "최종 판매중지"}</button></div>
      </section>
    </div>}
    {pendingDeletion && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDeletion(); }}>
      <section ref={deletionModalRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="deletion-title" aria-describedby="deletion-description">
        <span className={styles.warningIcon}>!</span>
        <h2 id="deletion-title">상품 {pendingDeletion.length}개를 영구삭제할까요?</h2>
        <p><strong>{pendingDeletion.length === 1 ? pendingDeletion[0].productName : `선택 상품 ${pendingDeletion.length}개`}</strong></p>
        <p id="deletion-description">선택 상품은 각 판매채널에서 완전히 삭제되며 되돌릴 수 없습니다.{pendingDeletion.some((item) => item.channel === "coupang") ? " 쿠팡 상품에 옵션이 여러 개라면 모든 옵션을 먼저 판매중지해야 합니다." : ""}</p>
        <label className={statusStyles.deletionField}>
          <span>아래 문구를 정확히 입력한 뒤 Enter를 누르세요.</span>
          <code>{PRODUCT_DELETION_CONFIRMATION}</code>
          <input
            ref={deletionInputRef}
            type="text"
            value={deletionConfirmation}
            disabled={deleting}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(deletionError)}
            aria-describedby={deletionError ? "deletion-error" : "deletion-description"}
            onChange={(event) => { setDeletionConfirmation(event.target.value); setDeletionError(""); }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void confirmDeletion();
            }}
          />
        </label>
        {deletionError && <p id="deletion-error" className={statusStyles.deletionError} role="alert">{deletionError}</p>}
        {deleting && <p className={statusStyles.deletingNotice} role="status">선택 상품을 판매채널에서 삭제하는 중입니다…</p>}
        <div className={statusStyles.deletionActions}><button type="button" className={styles.cancelButton} disabled={deleting} onClick={closeDeletion}>취소</button></div>
      </section>
    </div>}
    {pendingApprovalIds && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeApproval(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="approval-title" aria-describedby="approval-description">
        <span className={styles.warningIcon}>!</span>
        <h2 id="approval-title">쿠팡 상품 {pendingApprovalIds.length}개를 승인요청할까요?</h2>
        <p id="approval-description">요청 후 쿠팡 심사가 시작됩니다. 먼저 한 상품만 시험하고 정상 접수된 것을 확인한 뒤 전체 요청하는 것을 권장합니다.</p>
        <label className={approvalStyles.confirmationField}><span>아래 문구를 정확히 입력하세요.</span><code>{COUPANG_APPROVAL_CONFIRMATION}</code><input value={approvalConfirmation} disabled={approving} autoComplete="off" spellCheck={false} onChange={(event) => { setApprovalConfirmation(event.target.value); setApprovalError(""); }} /></label>
        <div><button type="button" className={styles.cancelButton} disabled={approving} onClick={closeApproval}>취소</button><button type="button" className={styles.finalSuspendButton} disabled={approving || approvalConfirmation !== COUPANG_APPROVAL_CONFIRMATION} onClick={() => void confirmApproval()}>{approving ? "승인요청 중…" : "최종 승인요청"}</button></div>
      </section>
    </div>}
  </main>;
}
