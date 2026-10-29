import assert from "node:assert/strict";
import test from "node:test";

import * as bulk from "../app/lib/inventory/bulk-actions.ts";

test("continues a bulk inventory action after one item fails", async () => {
  const runBulkAction = (bulk as Record<string, unknown>).runBulkInventoryAction;
  assert.equal(typeof runBulkAction, "function");
  if (typeof runBulkAction !== "function") return;

  const visited: string[] = [];
  const result = await runBulkAction(
    [{ id: "naver:1" }, { id: "coupang:2" }, { id: "naver:3" }],
    async (item: { id: string }) => {
      visited.push(item.id);
      if (item.id === "coupang:2") throw new Error("쿠팡 제한");
    },
  );

  assert.deepEqual(visited, ["naver:1", "coupang:2", "naver:3"]);
  assert.deepEqual(result, {
    succeeded: ["naver:1", "naver:3"],
    failed: [{ id: "coupang:2", error: "쿠팡 제한" }],
  });
});

test("deduplicates bulk inventory targets by their stable id", async () => {
  const runBulkAction = (bulk as Record<string, unknown>).runBulkInventoryAction;
  assert.equal(typeof runBulkAction, "function");
  if (typeof runBulkAction !== "function") return;

  const visited: string[] = [];
  await runBulkAction(
    [{ id: "coupang:10" }, { id: "coupang:10" }],
    async (item: { id: string }) => { visited.push(item.id); },
  );
  assert.deepEqual(visited, ["coupang:10"]);
});
