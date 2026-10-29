import assert from "node:assert/strict";
import test from "node:test";

const apiError = await import("../app/lib/registrationError.ts").catch(() => ({}));

const formatRegistrationError = (apiError as {
  formatRegistrationError?: (channel: string, status: number, payload: unknown) => string;
}).formatRegistrationError;

test("explains a referenced external server error in Korean and preserves the reference", () => {
  assert.equal(typeof formatRegistrationError, "function");
  assert.equal(
    formatRegistrationError!("네이버", 500, {
      error: "internal error; reference = e5912srsihklondmcnq1s3da",
    }),
    "네이버 서버 내부 오류로 상품 등록에 실패했습니다. 잠시 후 다시 시도해 주세요. 계속 발생하면 문의할 때 오류번호 e5912srsihklondmcnq1s3da를 전달해 주세요.",
  );
});

test("shows which Naver API stage returned an internal error", () => {
  assert.equal(
    formatRegistrationError!("네이버", 500, {
      error: "internal error; reference = iqjfto7bfb81c1hrfarremoo",
      stage: "상품 정보 전송",
    }),
    "네이버 상품 정보 전송 단계에서 서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. 계속 발생하면 문의할 때 오류번호 iqjfto7bfb81c1hrfarremoo를 전달해 주세요.",
  );
});

test("shows field-level details instead of hiding them behind a generic message", () => {
  assert.equal(
    formatRegistrationError!("네이버", 400, {
      error: "등록 필수값을 확인해 주세요.",
      issues: [
        { message: "카테고리 코드를 확인해 주세요." },
        { message: "원산지를 입력해 주세요." },
      ],
    }),
    "네이버 상품 정보 오류: 카테고리 코드를 확인해 주세요. · 원산지를 입력해 주세요.",
  );
});

test("translates common authentication and rate-limit failures", () => {
  assert.equal(
    formatRegistrationError!("카페24", 401, { error: "Unauthorized" }),
    "카페24 인증이 만료되었거나 올바르지 않습니다. 채널 연결을 다시 확인해 주세요.",
  );
  assert.equal(
    formatRegistrationError!("네이버", 429, { error: "Too Many Requests" }),
    "네이버 요청이 너무 많아 잠시 제한되었습니다. 잠시 후 다시 등록해 주세요.",
  );
});
