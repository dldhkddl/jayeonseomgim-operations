import assert from "node:assert/strict";
import test from "node:test";
import { verifyCoupangConnection } from "../app/lib/coupang.ts";

test("verifies Coupang credentials against a real authenticated metadata endpoint", async () => {
  // Catches a status badge turning green merely because two key strings exist without authenticating them.
  let requestUrl = "";
  let authorization = "";
  const result = await verifyCoupangConnection(
    { accessKey: "access", secretKey: "secret" },
    async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({ code: "SUCCESS", data: {} });
    },
  );

  assert.equal(result, true);
  assert.match(requestUrl, /display-category-codes\/72532$/);
  assert.match(authorization, /^CEA algorithm=HmacSHA256, access-key=access,/);
});

test("rejects Coupang credentials when the authenticated endpoint rejects them", async () => {
  await assert.rejects(
    verifyCoupangConnection(
      { accessKey: "bad", secretKey: "bad" },
      async () => Response.json({ message: "Unauthorized" }, { status: 401 }),
    ),
    /Unauthorized/,
  );
});
