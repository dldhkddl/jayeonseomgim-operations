import assert from "node:assert/strict";
import test from "node:test";

import * as deliveryCompanies from "../app/lib/channels/deliveryCompanies.ts";

const NAVER_DELIVERY_COMPANIES = (deliveryCompanies as typeof deliveryCompanies & {
  NAVER_DELIVERY_COMPANIES?: ReadonlyArray<{ code: string; label: string }>;
}).NAVER_DELIVERY_COMPANIES;

test("offers the major Korean carriers with their official Naver codes", () => {
  assert.deepEqual(NAVER_DELIVERY_COMPANIES?.slice(0, 5), [
    { code: "CJGLS", label: "CJ대한통운" },
    { code: "HYUNDAI", label: "롯데택배" },
    { code: "HANJIN", label: "한진택배" },
    { code: "KGB", label: "로젠택배" },
    { code: "EPOST", label: "우체국택배" },
  ]);
});

test("does not expose blank or duplicate carrier codes", () => {
  const codes = NAVER_DELIVERY_COMPANIES?.map((company) => company.code) ?? [];
  assert.ok(codes.length >= 5);
  assert.equal(codes.every(Boolean), true);
  assert.equal(new Set(codes).size, codes.length);
});
