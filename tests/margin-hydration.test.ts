import assert from "node:assert/strict";
import test from "node:test";
import * as margin from "../app/lib/margin.ts";

test("uses storage-independent defaults for the hydration render", () => {
  const initialMarginState = (margin as typeof margin & {
    initialMarginState?: () => {
      cost: margin.CostInput;
      fees: Record<string, margin.FeeInput>;
    };
  }).initialMarginState;

  assert.equal(typeof initialMarginState, "function");
  assert.deepEqual(initialMarginState?.(), {
    cost: { supply: 0, packaging: 0, shipping: 0, other: 0 },
    fees: {},
  });
});
