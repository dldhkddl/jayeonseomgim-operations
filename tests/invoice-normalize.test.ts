import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAddress, normalizeIdentifier, normalizeProductName, normalizePhone } from "../app/lib/invoice/normalize.ts";

test("normalizes Korean order matching fields without changing identifiers", () => {
  assert.equal(normalizeIdentifier("202608121234567890"), "202608121234567890");
  assert.equal(normalizePhone("010-1234-5678"), "01012345678");
  assert.equal(normalizeAddress("가상시 예시구 테스트로 200"), "가상시예시구테스트로200");
  assert.equal(normalizeProductName("[산지직송] 복숭아 4.5kg (특)") , "산지직송복숭아45kg특");
});

test("rejects spreadsheet values already corrupted into scientific notation", () => {
  assert.throws(() => normalizeIdentifier("2.02608121234568E+17"), /엑셀.*텍스트/);
  assert.throws(() => normalizeIdentifier(202608121234567900), /정확하게 읽을 수 없/);
});
