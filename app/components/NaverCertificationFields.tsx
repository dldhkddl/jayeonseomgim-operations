"use client";

import { useEffect, useState } from "react";
import {
  greenCertificationOptions,
  type GreenCertificationOption,
} from "../lib/naverRegistrationValidation";

type Props = {
  categoryId: string;
  certificationId: string;
  certificationNumber: string;
  onChange: (value: { id: string; name: string; markType: string; number?: string }) => void;
  onNotice?: (message: string) => void;
};

const EXCLUDED_OPTION: GreenCertificationOption = {
  id: "EXCLUDED",
  name: "인증 대상 아님",
  markType: "",
};

export default function NaverCertificationFields({
  categoryId,
  certificationId,
  certificationNumber,
  onChange,
  onNotice,
}: Props) {
  const [loaded, setLoaded] = useState<{
    categoryId: string;
    options: GreenCertificationOption[];
  }>({ categoryId: "", options: [EXCLUDED_OPTION] });

  useEffect(() => {
    let cancelled = false;
    if (!categoryId) return () => { cancelled = true; };

    void fetch(`/api/naver/categories?id=${encodeURIComponent(categoryId)}`)
      .then(async (response) => {
        const data = await response.json() as {
          category?: { certificationInfos?: unknown };
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "친환경 인증 정보를 불러오지 못했습니다.");
        if (!cancelled) {
          setLoaded({
            categoryId,
            options: greenCertificationOptions(data.category?.certificationInfos),
          });
        }
      })
      .catch((error) => {
        if (!cancelled) onNotice?.(error instanceof Error ? error.message : "친환경 인증 정보를 불러오지 못했습니다.");
      });

    return () => { cancelled = true; };
  }, [categoryId, onNotice]);

  const loading = Boolean(categoryId && loaded.categoryId !== categoryId);
  const options = loaded.categoryId === categoryId ? loaded.options : [EXCLUDED_OPTION];

  const selectedId = options.some((option) => option.id === certificationId)
    ? certificationId
    : "EXCLUDED";
  const certified = selectedId !== "EXCLUDED";

  return (
    <div className="certFields" aria-busy={loading}>
      <label>
        <span>친환경 인증 종류</span>
        <select
          value={selectedId}
          onChange={(event) => {
            const option = options.find((item) => item.id === event.target.value) ?? EXCLUDED_OPTION;
            onChange({ ...option, number: option.id === "EXCLUDED" ? "" : certificationNumber });
          }}
          disabled={!categoryId || loading}
        >
          {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
        <small>{loading ? "네이버 인증 종류를 불러오는 중…" : "선택한 네이버 카테고리에서 허용하는 인증만 표시됩니다."}</small>
      </label>
      {certified && (
        <label>
          <span>친환경 인증번호 <strong>*</strong></span>
          <input
            value={certificationNumber}
            onChange={(event) => {
              const option = options.find((item) => item.id === selectedId) ?? EXCLUDED_OPTION;
              onChange({ ...option, number: event.target.value });
            }}
            placeholder="인증서에 표시된 번호"
          />
        </label>
      )}
    </div>
  );
}
