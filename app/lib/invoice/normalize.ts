const SCIENTIFIC_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/;

export function normalizeIdentifier(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("긴 번호를 정확하게 읽을 수 없습니다. 원본 엑셀의 해당 열을 텍스트 형식으로 저장해 주세요.");
    }
    return String(value);
  }
  const text = String(value ?? "").trim();
  if (SCIENTIFIC_NUMBER.test(text)) {
    throw new Error("엑셀에서 긴 번호가 지수 형식으로 바뀌었습니다. 해당 열을 텍스트 형식으로 저장해 주세요.");
  }
  return text;
}

export function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeAddress(value: unknown): string {
  return String(value ?? "").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/gi, "");
}

export function normalizeProductName(value: unknown): string {
  return String(value ?? "").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/gi, "");
}

export function normalizePerson(value: unknown): string {
  return String(value ?? "").toLocaleLowerCase("ko-KR").replace(/\s/g, "");
}
