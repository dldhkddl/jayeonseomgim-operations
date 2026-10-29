type ErrorPayload = {
  error?: unknown;
  message?: unknown;
  issues?: unknown;
  detail?: unknown;
  stage?: unknown;
};

function asPayload(value: unknown): ErrorPayload {
  return value && typeof value === "object" ? (value as ErrorPayload) : {};
}

function messageFrom(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function issueMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((issue) => {
      if (typeof issue === "string") return issue.trim();
      if (!issue || typeof issue !== "object") return "";
      const record = issue as Record<string, unknown>;
      return messageFrom(record.message) || messageFrom(record.reason);
    })
    .filter(Boolean);
}

function referenceFrom(message: string): string {
  return message.match(/reference\s*[:=]\s*([a-z0-9-]+)/i)?.[1] ?? "";
}

/** 외부 채널의 영문·축약 오류 응답을 사용자가 조치할 수 있는 한국어 안내로 바꾼다. */
export function formatRegistrationError(channel: string, status: number, input: unknown): string {
  const payload = asPayload(input);
  const raw = messageFrom(payload.error) || messageFrom(payload.message);
  const issues = issueMessages(payload.issues);
  const detail = asPayload(payload.detail);
  const stage = messageFrom(payload.stage);
  const detailIssues = issueMessages(detail.invalidInputs) || [];
  const allIssues = [...issues, ...detailIssues];

  if (allIssues.length) return `${channel} 상품 정보 오류: ${allIssues.join(" · ")}`;

  if (status === 401 || status === 403) {
    return `${channel} 인증이 만료되었거나 올바르지 않습니다. 채널 연결을 다시 확인해 주세요.`;
  }
  if (status === 429) {
    return `${channel} 요청이 너무 많아 잠시 제한되었습니다. 잠시 후 다시 등록해 주세요.`;
  }
  if (status === 0) {
    return `${channel} 서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.`;
  }

  const reference = referenceFrom(raw);
  if (reference || /internal\s+error/i.test(raw)) {
    const suffix = reference
      ? ` 계속 발생하면 문의할 때 오류번호 ${reference}를 전달해 주세요.`
      : " 계속 발생하면 잠시 후 다시 시도해 주세요.";
    const prefix = stage
      ? `${channel} ${stage} 단계에서 서버 내부 오류가 발생했습니다.`
      : `${channel} 서버 내부 오류로 상품 등록에 실패했습니다.`;
    return `${prefix} 잠시 후 다시 시도해 주세요.${suffix}`;
  }

  if (raw && /[가-힣]/.test(raw)) return raw;
  if (status >= 500) return `${channel} 서버 내부 오류로 상품 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.`;
  if (status >= 400) return `${channel}에서 상품 정보를 거절했습니다. 필수값과 채널 설정을 확인해 주세요.`;
  return `${channel} 상품 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.`;
}
