import assert from "node:assert/strict";
import test from "node:test";
import { checkChannelConnection, connectionPresentation } from "../app/lib/channel-connection.ts";

test("shows a green connected presentation after a successful connection check", async () => {
  // Catches a successful API response being shown only as a transient notice while the button remains unchanged.
  const result = await checkChannelConnection("/api/naver/token", async () =>
    Response.json({ ok: true, connected: true }),
  );
  const presentation = connectionPresentation("네이버", result.status);

  assert.deepEqual(result, { status: "connected", message: "" });
  assert.equal(presentation.label, "✓ 네이버 연결됨");
  assert.equal(presentation.className, "channelConnection connected");
});

test("keeps a reconnect action and exposes the server message when disconnected", async () => {
  // Catches Cafe24's real not-connected response being swallowed without a useful action or status.
  const result = await checkChannelConnection("/api/cafe24/status", async () =>
    Response.json({ connected: false, error: "카페24 연결이 필요합니다." }, { status: 401 }),
  );
  const presentation = connectionPresentation("카페24", result.status);

  assert.deepEqual(result, { status: "disconnected", message: "카페24 연결이 필요합니다." });
  assert.equal(presentation.label, "카페24 연결");
  assert.equal(presentation.className, "channelConnection disconnected");
});

test("shows checking state while a connection request is in progress", () => {
  const presentation = connectionPresentation("네이버", "checking");
  assert.deepEqual(presentation, {
    label: "네이버 확인 중…",
    className: "channelConnection checking",
  });
});
