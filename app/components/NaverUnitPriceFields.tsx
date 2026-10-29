"use client";

type Props = {
  enabled: string;
  totalCapacityValue: string;
  unitCapacity: string;
  indicationUnit: string;
  autoCalculated: boolean;
  onChange: (patch: Record<string, string>) => void;
};

const UNITS = ["g", "kg", "ml", "L", "cm", "m", "개", "개입", "매", "매입", "정", "캡슐", "구미", "포", "구"];

export default function NaverUnitPriceFields({ enabled, totalCapacityValue, unitCapacity, indicationUnit, autoCalculated, onChange }: Props) {
  const usesUnitPrice = enabled === "true";

  return (
    <fieldset className="unitPriceFields">
      <legend>네이버 단위가격 <strong>*</strong></legend>
      <label>
        <span>단위가격 표시 여부 <strong>*</strong></span>
        <select
          value={enabled}
          onChange={(event) => onChange({
            unitPriceYn: event.target.value,
            ...(event.target.value === "false" ? { totalCapacityValue: "", unitCapacity: "", indicationUnit: "" } : {}),
          })}
        >
          <option value="">선택해 주세요</option>
          <option value="false">사용 안 함</option>
          <option value="true">사용</option>
        </select>
      </label>
      {usesUnitPrice && (
        <>
          <label>
            <span>총용량·총수량 <strong>*</strong></span>
            <input type="number" min="0.001" step="0.001" value={totalCapacityValue} onChange={(event) => onChange({ unitPriceYn: "true", totalCapacityValue: event.target.value })} placeholder="예: 6" />
          </label>
          <label>
            <span>가격 표시 기준 <strong>*</strong></span>
            <input type="number" min="1" max="999" step="1" value={unitCapacity} onChange={(event) => onChange({ unitPriceYn: "true", unitCapacity: event.target.value })} placeholder="예: 1" />
          </label>
          <label>
            <span>표시 단위 <strong>*</strong></span>
            <select value={indicationUnit} onChange={(event) => onChange({ unitPriceYn: "true", indicationUnit: event.target.value })}>
              <option value="">선택해 주세요</option>
              {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </label>
          <small>{autoCalculated ? "중량·구성에서 자동 계산했습니다. 필요한 경우 직접 수정할 수 있습니다." : "예: 3kg+3kg 상품은 총용량 6, 가격 표시 기준 1, 단위 kg"}</small>
        </>
      )}
    </fieldset>
  );
}
