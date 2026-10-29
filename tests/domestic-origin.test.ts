import assert from "node:assert/strict";
import test from "node:test";

import * as valuemap from "../app/lib/channels/valuemap.ts";
import * as cafe24 from "../app/lib/cafe24.ts";

const applyDomesticOriginFormat = (valuemap as typeof valuemap & {
  applyDomesticOriginFormat?: (
    rows: Array<Record<string, string | number | undefined>>,
    channelId: string,
  ) => Array<Record<string, string | number | undefined>>;
}).applyDomesticOriginFormat;

const buildCafe24ProductPayload = (cafe24 as typeof cafe24 & {
  buildCafe24ProductPayload?: (input: Record<string, unknown>) => {
    request?: { origin_classification?: string };
  };
}).buildCafe24ProductPayload;

test("formats every supported channel as domestic without changing the source detail origin", () => {
  assert.equal(typeof applyDomesticOriginFormat, "function");

  const rows = [
    {
      productName: "포항 산지직송 햇사과",
      origin: "경상북도 포항시",
      detailContent: "<p>원산지: 경상북도 포항시</p>",
    },
  ];

  assert.equal(applyDomesticOriginFormat!(rows, "smartstore")[0].origin, "00");
  for (const channelId of ["coupang", "cafe24", "11st"]) {
    const [exported] = applyDomesticOriginFormat!(rows, channelId);
    assert.equal(exported.origin, "국산");
    assert.match(String(exported.detailContent), /경상북도 포항시/);
  }

  assert.equal(rows[0].origin, "경상북도 포항시");
});

test("leaves unsupported channel origin unchanged", () => {
  const rows = [{ origin: "경상북도 포항시" }];
  assert.deepEqual(applyDomesticOriginFormat!(rows, "custom"), rows);
});

test("marks direct Cafe24 registrations as domestic", () => {
  assert.equal(typeof buildCafe24ProductPayload, "function");
  const payload = buildCafe24ProductPayload!({
    productName: "포항 산지직송 햇사과",
    price: 39900,
    images: ["https://example.com/apple.jpg"],
  });
  assert.equal(payload.request?.origin_classification, "F");
});
