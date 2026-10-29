import assert from "node:assert/strict";
import test from "node:test";
import { dashboardBackNavigation } from "../app/lib/dashboard-navigation.ts";

test("모든 하위 화면은 동일한 뒤로가기 동작을 사용한다", () => {
  assert.deepEqual(dashboardBackNavigation(), {
    href: "/",
    label: "뒤로가기",
  });
});
