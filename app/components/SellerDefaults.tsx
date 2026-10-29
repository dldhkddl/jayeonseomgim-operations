"use client";

import { useEffect, useState } from "react";
import { CANONICAL_BY_ID } from "../lib/channels/canonical";
import { NAVER_DELIVERY_COMPANIES } from "../lib/channels/deliveryCompanies";
import {
  AGRI_PRESET,
  DEFAULT_GROUPS,
  DEFAULT_REQUIRED_IDS,
  countFilled,
  loadSellerDefaults,
  missingRequired,
  saveSellerDefaults,
  type SellerDefaults as Values,
} from "../lib/channels/defaults";

type Props = {
  value: Values;
  onChange: (next: Values) => void;
  onNotice?: (message: string) => void;
};

export default function SellerDefaults({ value, onChange, onNotice }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = loadSellerDefaults();
    if (countFilled(stored)) onChange(stored);
    // 최초 1회만 불러온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set(fieldId: string, v: string) {
    const next = { ...value, [fieldId]: v };
    onChange(next);
    saveSellerDefaults(next);
  }

  function applyPreset() {
    // 이미 입력한 값은 건드리지 않는다
    const next = { ...value };
    for (const [k, v] of Object.entries(AGRI_PRESET)) {
      if (String(next[k] ?? "").trim() === "") next[k] = v;
    }
    onChange(next);
    saveSellerDefaults(next);
    setOpen(true);
    onNotice?.("농산물 기본값을 채웠습니다. 주소와 전화번호는 직접 입력해 주세요.");
  }

  function clearAll() {
    onChange({});
    saveSellerDefaults({});
    onNotice?.("판매자 기본값을 모두 비웠습니다.");
  }

  const filled = countFilled(value);
  const missing = missingRequired(value);

  return (
    <div className="sdf">
      <button className="sdfHead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="sdfCaret">{open ? "▾" : "▸"}</span>
        <b>판매자 기본값</b>
        <small>
          {filled > 0 ? `${filled}개 설정됨` : "아직 비어 있음"}
          {missing.length > 0 && <em> · 필수 {missing.length}개 미입력</em>}
        </small>
      </button>

      {open && (
        <div className="sdfBody">
          <p className="sdfIntro">
            상품이 바뀌어도 그대로인 값들입니다. 여기 채워두면 <b>엑셀의 빈 칸에만</b> 자동으로 들어갑니다. 상품에 이미 값이 있으면 덮어쓰지 않습니다.
          </p>
          <div className="sdfActions">
            <button className="secondary" onClick={applyPreset}>
              농산물 기본값 채우기
            </button>
            <button className="linkBtn danger" onClick={clearAll}>
              전체 비우기
            </button>
          </div>

          {DEFAULT_GROUPS.map((group) => (
            <div className="sdfGroup" key={group.title}>
              <div className="sdfGroupHead">
                <b>{group.title}</b>
                <small>{group.hint}</small>
              </div>
              <div className="sdfGrid">
                {group.fieldIds.map((id) => {
                  const field = CANONICAL_BY_ID[id];
                  if (!field) return null;
                  const required = DEFAULT_REQUIRED_IDS.includes(id);
                  const empty = String(value[id] ?? "").trim() === "";
                  return (
                    <label key={id} className={field.type === "longtext" ? "wide" : ""}>
                      <span>
                        {field.label}
                        {required && <i className={empty ? "req on" : "req"}>필수</i>}
                      </span>
                      {id === "deliveryCompany" ? (
                        <select
                          value={value[id] ?? ""}
                          onChange={(e) => set(id, e.target.value)}
                          aria-label="택배사 선택"
                        >
                          <option value="">택배사를 선택해 주세요</option>
                          {value[id] &&
                            !NAVER_DELIVERY_COMPANIES.some((company) => company.code === value[id]) && (
                              <option value={value[id]}>기존 택배사 코드 · {value[id]}</option>
                            )}
                          {NAVER_DELIVERY_COMPANIES.map((company) => (
                            <option key={company.code} value={company.code}>
                              {company.label}
                            </option>
                          ))}
                        </select>
                      ) : field.type === "longtext" ? (
                        <textarea value={value[id] ?? ""} onChange={(e) => set(id, e.target.value)} rows={2} />
                      ) : (
                        <input
                          value={value[id] ?? ""}
                          onChange={(e) => set(id, e.target.value)}
                          inputMode={field.type === "number" ? "numeric" : undefined}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
