import assert from "node:assert/strict";
import test from "node:test";
import * as premium from "../app/lib/premiumDetail.ts";

type Theme = {
  primary: string;
  primaryText: string;
  accent: string;
  soft: string;
  cream: string;
  ink: string;
};

const createDetailTheme = (premium as typeof premium & {
  createDetailTheme?: (rgb: { r: number; g: number; b: number }) => Theme;
}).createDetailTheme;
const fallbackDetailTheme = (premium as typeof premium & {
  fallbackDetailTheme?: (name: string) => Theme;
}).fallbackDetailTheme;
const contrastRatio = (premium as typeof premium & {
  contrastRatio?: (a: string, b: string) => number;
}).contrastRatio;
const buildPremiumDetailModel = (premium as typeof premium & {
  buildPremiumDetailModel?: (row: Record<string, string>, images: string[]) => {
    criteria: Array<{ label: string; value: string }>;
    features: string[];
    images: string[];
    specs: Array<{ label: string; value: string }>;
  };
}).buildPremiumDetailModel;
const premiumImageSlots = (premium as typeof premium & {
  premiumImageSlots?: (imageCount: number) => Array<{ key: string; label: string; prompt: string }>;
}).premiumImageSlots;
const extractDetailTheme = (premium as typeof premium & {
  extractDetailTheme?: (src: string, fallback: Theme) => Promise<Theme>;
}).extractDetailTheme;
const dominantColorFromPixels = (premium as typeof premium & {
  dominantColorFromPixels?: (pixels: number[]) => { r: number; g: number; b: number } | null;
}).dominantColorFromPixels;
const buildPremiumDetailHtml = (premium as typeof premium & {
  buildPremiumDetailHtml?: (
    row: Record<string, string>,
    options: { images: string[]; theme?: Theme; guide?: string; phone?: string },
  ) => string;
}).buildPremiumDetailHtml;

const row = {
  productName: "포항 산지직송 햇사과",
  origin: "경상북도 포항시",
  variety: "부사",
  weightSpec: "3kg + 3kg",
  manufacturer: "명성농산",
  storage: "수령 후 냉장 보관",
  deliveryFeeType: "무료배송",
  feature: "아삭한 식감, 풍부한 과즙, 산지에서 바로 발송",
};

test("creates an accessible product theme from a representative image color", () => {
  assert.equal(typeof createDetailTheme, "function");
  assert.equal(typeof contrastRatio, "function");
  const theme = createDetailTheme?.({ r: 224, g: 83, b: 65 });
  assert.match(theme!.primary, /^#[0-9a-f]{6}$/i);
  assert.match(theme!.soft, /^#[0-9a-f]{6}$/i);
  assert.ok(contrastRatio!(theme!.primary, theme!.primaryText) >= 4.5);
});

test("renders all additional staged photos in a visual story section", () => {
  assert.equal(typeof buildPremiumDetailHtml, "function");
  const images = Array.from({ length: 7 }, (_, index) => `https://example.com/scene-${index + 1}.jpg`);
  const html = buildPremiumDetailHtml?.(row, { images }) ?? "";

  assert.match(html, /data-section="visual-story"/);
  for (const src of images.slice(4)) assert.match(html, new RegExp(src));
});

test("uses distinct safe fallback palettes for different fruit products", () => {
  assert.equal(typeof fallbackDetailTheme, "function");
  assert.notEqual(fallbackDetailTheme?.("청송 사과").primary, fallbackDetailTheme?.("나주 배").primary);
  assert.notEqual(fallbackDetailTheme?.("나주 배").primary, fallbackDetailTheme?.("백도 복숭아").primary);
});

test("builds premium sections only from supplied product facts", () => {
  assert.equal(typeof buildPremiumDetailModel, "function");
  const model = buildPremiumDetailModel?.(row, ["cover.jpg", "detail-1.jpg", "detail-2.jpg"]);
  assert.deepEqual(model?.features, ["아삭한 식감", "풍부한 과즙", "산지에서 바로 발송"]);
  assert.deepEqual(model?.criteria.slice(0, 3), [
    { label: "원산지", value: "경상북도 포항시" },
    { label: "품종", value: "부사" },
    { label: "구성", value: "3kg + 3kg" },
  ]);
  assert.ok(model?.specs.every(({ value }) => Boolean(value.trim())));
  assert.equal(JSON.stringify(model).includes("당도"), false);
});

test("fills a two-photo product to seven varied premium scenes", () => {
  assert.equal(typeof premiumImageSlots, "function");
  assert.deepEqual(premiumImageSlots?.(2).map(({ key }) => key), [
    "abundance",
    "package",
    "closeup",
    "origin",
    "lifestyle",
  ]);
  assert.equal(premiumImageSlots?.(1).length, 6);
  assert.equal(premiumImageSlots?.(3).length, 4);
  assert.deepEqual(premiumImageSlots?.(7), []);
});

test("falls back safely when image color extraction is unavailable", async () => {
  assert.equal(typeof extractDetailTheme, "function");
  const fallback = fallbackDetailTheme?.("청송 사과") as Theme;
  assert.deepEqual(await extractDetailTheme?.("not-a-browser-image", fallback), fallback);
});

test("prefers the saturated product color over a large neutral background", () => {
  assert.equal(typeof dominantColorFromPixels, "function");
  const beige = [205, 180, 150, 255];
  const red = [225, 55, 42, 255];
  const pixels = [...beige, ...beige, ...beige, ...beige, ...beige, ...beige, ...red, ...red, ...red];
  const dominant = dominantColorFromPixels?.(pixels);
  assert.ok(dominant);
  assert.ok(dominant!.r > dominant!.g * 2.5);
  assert.ok(dominant!.r > dominant!.b * 2.5);
});

test("renders the premium sales narrative in channel HTML", () => {
  assert.equal(typeof buildPremiumDetailHtml, "function");
  const html = buildPremiumDetailHtml?.(row, {
    images: ["https://example.com/cover.jpg", "https://example.com/detail.jpg"],
  }) ?? "";
  for (const section of ["hero", "empathy", "taste", "criteria", "promises", "showcase", "process", "package", "specs", "storage", "closing"]) {
    assert.match(html, new RegExp(`data-section="${section}"`));
  }
  assert.match(html, /경상북도 포항시/);
  assert.doesNotMatch(html, /당도/);
});
