import assert from "node:assert/strict";
import test from "node:test";
import * as cafe24 from "../app/lib/cafe24.ts";

test("separates Cafe24 OAuth scopes with spaces", () => {
  const authorizeUrl = cafe24.buildAuthorizeUrl(
    { mallId: "samplemall", clientId: "sample-client" },
    {
      redirectUri: "http://localhost:3000/api/cafe24/oauth/callback",
      state: "sample-state",
      scopes: ["mall.read_product", "mall.write_product"],
    },
  );

  const url = new URL(authorizeUrl);
  assert.equal(url.searchParams.get("scope"), "mall.read_product mall.write_product");
});

test("describes the OAuth provider error when Cafe24 returns no authorization code", () => {
  const result = (cafe24 as typeof cafe24 & {
    readOAuthCallback: (url: string) => { errorMessage: string | null };
  }).readOAuthCallback(
    "http://localhost:3000/api/cafe24/oauth/callback?error=invalid_scope&error_description=Scope+permission+was+not+approved",
  );

  assert.equal(result.errorMessage, "Scope permission was not approved (invalid_scope)");
});
