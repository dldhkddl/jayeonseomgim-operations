import assert from "node:assert/strict";
import test from "node:test";
import { GarakClient } from "../app/lib/market-prices/garak-client.ts";

test("uses Garak public-data id/passwd/dataid contract", async () => {
  let requested = "";
  const client = new GarakClient({ apiId: "11035", apiPassword: "pw", dataId: "data36", endpoint: "https://example.test/json", fetch: async (input) => { requested = String(input); return Response.json({ items: [{ PUM_NM: "Peach", PUM_CODE: "211", G_NAME: "A", U_NAME: "10kg", AV_P: "35000", FLUC: "12.5" }] }); } });
  await client.fetchPrices({ searchDate: "20260812", previousDate: "20260811", categoryCode: "2", marketCode: "1", itemName: "Peach" });
  const url = new URL(requested);
  assert.equal(url.searchParams.get("id"), "11035");
  assert.equal(url.searchParams.get("passwd"), "pw");
  assert.equal(url.searchParams.get("dataid"), "data36");
  assert.equal(url.searchParams.get("pagesize"), "100");
  assert.equal(url.searchParams.get("pageidx"), "1");
  assert.equal(url.searchParams.get("s_date"), "20260812");
  assert.equal(url.searchParams.get("s_date_p"), "20260811");
  assert.equal(url.searchParams.get("s_date_p7"), "20260805");
  assert.equal(url.searchParams.get("p_pos_gubun"), "1");
  assert.equal(url.searchParams.get("s_pum_nm"), "2");
  assert.equal(url.searchParams.get("s_pummok"), "Peach");
});

test("normalizes Garak's actual top-level resultData response", async () => {
  const client = new GarakClient({
    apiId: "11035",
    apiPassword: "pw",
    dataId: "data36",
    endpoint: "https://example.test/json",
    fetch: async () => Response.json({
      resultData: [{
        PUM_NM: "복숭아 가납암(백)",
        G_NAME: "특",
        U_NAME: "2.5 kg상자",
        AV_P: "12,375",
        FLUC: "0",
      }],
    }),
  });

  const prices = await client.fetchPrices({
    searchDate: "20260812",
    previousDate: "20260811",
    categoryCode: "2",
    marketCode: "1",
    itemName: "복숭아",
  });

  assert.equal(prices.length, 1);
  assert.equal(prices[0].itemName, "복숭아 가납암(백)");
  assert.equal(prices[0].grade, "특");
  assert.equal(prices[0].unitQuantity, 2.5);
  assert.equal(prices[0].averagePrice, 12375);
});
