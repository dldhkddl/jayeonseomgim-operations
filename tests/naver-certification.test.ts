import assert from "node:assert/strict";
import test from "node:test";
import * as certification from "../app/lib/naverRegistrationValidation.ts";

test("offers only the green certifications allowed by the selected Naver category", () => {
  assert.deepEqual(
    certification.greenCertificationOptions?.([
      { id: 101, name: "유기농산물", kindTypes: ["GREEN_PRODUCTS"], certificationMarkType: "ORGANIC_AGRICULTURAL_PROD" },
      { id: 202, name: "KC 안전인증", kindTypes: ["KC_CERTIFICATION"], certificationMarkType: "KC" },
      { id: 303, name: "농산물우수관리(GAP)", kindTypes: ["GREEN_PRODUCTS"], certificationMarkType: "GAP" },
    ]),
    [
      { id: "EXCLUDED", name: "인증 대상 아님", markType: "" },
      { id: "101", name: "유기농산물", markType: "ORGANIC_AGRICULTURAL_PROD" },
      { id: "303", name: "농산물우수관리(GAP)", markType: "GAP" },
    ],
  );
});
