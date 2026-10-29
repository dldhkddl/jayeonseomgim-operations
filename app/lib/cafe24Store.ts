/**
 * 카페24 토큰을 D1에 저장하고, 만료됐으면 자동으로 갱신해서 돌려준다.
 * 이 앱은 한 사람(한 쇼핑몰)만 쓰므로 행 하나(id="default")만 관리한다.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { cafe24Tokens } from "../../db/schema";
import { refreshAccessToken, type Cafe24App, type Cafe24Token } from "./cafe24";

const ROW_ID = "default";

export async function saveCafe24Token(mallId: string, token: Cafe24Token): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const row = {
    id: ROW_ID,
    mallId,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    scopes: token.scopes,
    updatedAt: now,
  };
  const existing = await db.select().from(cafe24Tokens).where(eq(cafe24Tokens.id, ROW_ID)).limit(1);
  if (existing.length) {
    await db.update(cafe24Tokens).set(row).where(eq(cafe24Tokens.id, ROW_ID));
  } else {
    await db.insert(cafe24Tokens).values(row);
  }
}

export class Cafe24NotConnectedError extends Error {
  constructor() {
    super("카페24가 아직 연결되지 않았습니다. 먼저 카페24 연결을 눌러 로그인해 주세요.");
  }
}

/** 지금 쓸 수 있는 access_token을 돌려준다. 만료 임박이면 자동으로 갱신해서 D1에 다시 저장한다. */
export async function getValidCafe24Token(app: Cafe24App): Promise<{ accessToken: string; mallId: string }> {
  const db = getDb();
  const rows = await db.select().from(cafe24Tokens).where(eq(cafe24Tokens.id, ROW_ID)).limit(1);
  const row = rows[0];
  if (!row) throw new Cafe24NotConnectedError();

  const expiresAt = new Date(row.expiresAt).getTime();
  const soon = Date.now() + 5 * 60 * 1000; // 5분 이내 만료면 미리 갱신
  if (Number.isFinite(expiresAt) && expiresAt > soon) {
    return { accessToken: row.accessToken, mallId: row.mallId };
  }

  const refreshed = await refreshAccessToken(app, row.refreshToken);
  await saveCafe24Token(row.mallId, refreshed);
  return { accessToken: refreshed.accessToken, mallId: row.mallId };
}

export async function isCafe24Connected(): Promise<boolean> {
  try {
    const db = getDb();
    const rows = await db.select().from(cafe24Tokens).where(eq(cafe24Tokens.id, ROW_ID)).limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}
