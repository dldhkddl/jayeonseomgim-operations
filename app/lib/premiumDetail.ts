import type { CanonicalRow } from "./channels/canonical";

export type DetailTheme = {
  primary: string;
  primaryText: string;
  accent: string;
  soft: string;
  cream: string;
  ink: string;
};

export type PremiumDetailModel = {
  name: string;
  origin: string;
  variety: string;
  weight: string;
  maker: string;
  storage: string;
  delivery: string;
  summary: string;
  features: string[];
  criteria: Array<{ label: string; value: string }>;
  promises: Array<{ label: string; value: string }>;
  process: Array<{ label: string; value: string }>;
  specs: Array<{ label: string; value: string }>;
  images: string[];
};

export type PremiumImageSlot = {
  key: "taste" | "harvest" | "package";
  label: string;
  prompt: string;
};

type RGB = { r: number; g: number; b: number };

const clamp = (value: number, min = 0, max = 255) => Math.min(max, Math.max(min, value));
const hex = (value: number) => Math.round(clamp(value)).toString(16).padStart(2, "0");
const rgbHex = ({ r, g, b }: RGB) => `#${hex(r)}${hex(g)}${hex(b)}`;

function hexRgb(value: string): RGB {
  const clean = value.replace("#", "");
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function rgbHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
  return { h, s: s * 100, l: l * 100 };
}

function hslHex(h: number, s: number, l: number): string {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) [rp, gp] = [c, x];
  else if (h < 120) [rp, gp] = [x, c];
  else if (h < 180) [gp, bp] = [c, x];
  else if (h < 240) [gp, bp] = [x, c];
  else if (h < 300) [rp, bp] = [x, c];
  else [rp, bp] = [c, x];
  return rgbHex({ r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 });
}

function luminance(value: string): number {
  const { r, g, b } = hexRgb(value);
  const channel = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function createDetailTheme(rgb: RGB): DetailTheme {
  const { h, s } = rgbHsl(rgb);
  const saturation = clamp(s, 38, 66);
  let primary = hslHex(h, saturation, 27);
  const primaryText = "#ffffff";
  if (contrastRatio(primary, primaryText) < 4.5) primary = hslHex(h, saturation, 21);
  return {
    primary,
    primaryText,
    accent: hslHex(h, clamp(saturation + 8, 42, 74), 61),
    soft: hslHex(h, clamp(saturation - 12, 22, 48), 90),
    cream: hslHex(h, 30, 97),
    ink: hslHex(h, 28, 16),
  };
}

export function fallbackDetailTheme(name: string): DetailTheme {
  const value = name.toLowerCase();
  const base = value.includes("배") ? "#73853a"
    : value.includes("복숭아") || value.includes("백도") || value.includes("황도") ? "#d9766c"
      : value.includes("포도") ? "#76527d"
        : value.includes("귤") || value.includes("오렌지") || value.includes("레몬") ? "#d58a24"
          : value.includes("사과") ? "#b84e45"
            : "#527052";
  return createDetailTheme(hexRgb(base));
}

/** 배경 평균색이 아니라 채도가 높은 상품색이 가장 많이 모인 색상군을 선택한다. */
export function dominantColorFromPixels(pixels: ArrayLike<number>): RGB | null {
  const bins = Array.from({ length: 12 }, () => ({ r: 0, g: 0, b: 0, weight: 0 }));
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2], alpha = pixels[index + 3];
    if (alpha < 200) continue;
    const color = { r: red, g: green, b: blue };
    const { h, s, l } = rgbHsl(color);
    if (s < 18 || l < 10 || l > 92) continue;
    const weight = (s / 100) ** 2 * (1 - Math.abs(l - 52) / 100);
    const bin = bins[Math.min(11, Math.floor(h / 30))];
    bin.r += red * weight;
    bin.g += green * weight;
    bin.b += blue * weight;
    bin.weight += weight;
  }
  const dominant = bins.reduce((best, candidate) => candidate.weight > best.weight ? candidate : best, bins[0]);
  if (!dominant.weight) return null;
  return { r: dominant.r / dominant.weight, g: dominant.g / dominant.weight, b: dominant.b / dominant.weight };
}

export async function extractDetailTheme(src: string, fallback: DetailTheme): Promise<DetailTheme> {
  if (!src || typeof window === "undefined" || typeof Image === "undefined" || typeof document === "undefined") return fallback;
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      if (/^https?:/i.test(src)) element.crossOrigin = "anonymous";
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image load failed"));
      element.src = src;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return fallback;
    context.drawImage(image, 0, 0, 48, 48);
    const data = context.getImageData(0, 0, 48, 48).data;
    const dominant = dominantColorFromPixels(data);
    return dominant ? createDetailTheme(dominant) : fallback;
  } catch {
    return fallback;
  }
}

const text = (row: CanonicalRow, key: string) => String(row[key] ?? "").trim();

export function buildPremiumDetailModel(row: CanonicalRow, images: string[]): PremiumDetailModel {
  const name = text(row, "productName");
  const origin = text(row, "origin");
  const variety = text(row, "variety");
  const weight = text(row, "weightSpec");
  const maker = text(row, "manufacturer") || text(row, "brand");
  const storage = text(row, "storage");
  const delivery = text(row, "deliveryFeeType") || text(row, "deliveryType");
  const features = text(row, "feature").split(/[,·\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 4);
  const criteria = [
    { label: "원산지", value: origin },
    { label: "품종", value: variety },
    { label: "구성", value: weight },
    { label: "보관", value: storage },
  ].filter(({ value }) => Boolean(value));
  const promises = [
    { label: "산지 정보", value: origin || "상품정보에서 원산지를 확인해 주세요" },
    { label: "구성 확인", value: weight || "선택한 옵션의 구성을 확인해 주세요" },
    { label: "배송 안내", value: delivery || "주문 전 배송 조건을 확인해 주세요" },
  ];
  const process = [
    { label: "주문 확인", value: "주문 내용과 선택 옵션을 확인합니다" },
    { label: "구성 확인", value: "입력된 상품 구성에 맞춰 준비합니다" },
    { label: "포장 준비", value: "배송을 위한 포장 상태를 확인합니다" },
    { label: "배송 인계", value: "준비된 상품을 배송사에 인계합니다" },
  ];
  const specs = [
    { label: "상품명", value: name },
    { label: "원산지", value: origin },
    { label: "품종", value: variety },
    { label: "구성", value: weight },
    { label: "생산자·판매자", value: maker },
    { label: "배송", value: delivery },
    { label: "보관 방법", value: storage },
  ].filter(({ value }) => Boolean(value));
  const intro = [origin && `${origin}에서 보내드리는`, variety, weight && `${weight} 구성`].filter(Boolean).join(" ");
  return {
    name,
    origin,
    variety,
    weight,
    maker,
    storage,
    delivery,
    summary: intro || "입력된 상품정보를 한눈에 확인해 보세요",
    features,
    criteria,
    promises,
    process,
    specs,
    images: images.filter(Boolean),
  };
}

const SCENE_SLOTS: PremiumImageSlot[] = [
  { key: "taste", label: "맛·식감 연출", prompt: "과일의 단면과 질감이 자연스럽게 보이는 프리미엄 식품 광고 사진" },
  { key: "abundance", label: "상품 풍성함 연출", prompt: "상품이 풍성하게 담겨 전체 구성과 신선한 분위기가 느껴지는 사진" },
  { key: "package", label: "포장 구성 연출", prompt: "실제 상품을 안전하게 포장해 배송 준비한 모습을 보여주는 사진" },
  { key: "closeup", label: "과즙·질감 클로즈업", prompt: "상품의 단면과 과즙, 고유한 질감을 가까이에서 선명하게 보여주는 매크로 사진" },
  { key: "origin", label: "산지 분위기 연출", prompt: "상품의 원산지와 신선한 산지 분위기를 자연스럽게 전달하는 야외 사진" },
  { key: "lifestyle", label: "식탁 라이프스타일 연출", prompt: "밝고 정갈한 식탁에서 상품을 즐기는 순간을 보여주는 자연스러운 라이프스타일 사진" },
];

export function premiumImageSlots(imageCount: number): PremiumImageSlot[] {
  return SCENE_SLOTS.slice(Math.max(0, imageCount - 1));
}

const esc = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

export function buildPremiumDetailHtml(
  row: CanonicalRow,
  options: { images?: string[]; theme?: DetailTheme; guide?: string; phone?: string } = {},
): string {
  const model = buildPremiumDetailModel(row, options.images ?? []);
  const theme = options.theme ?? fallbackDetailTheme(model.name);
  const image = (index: number) => model.images[index] || model.images[0] || "";
  const imageTag = (src: string, alt: string, style = "") => src
    ? `<img src="${esc(src)}" alt="${esc(alt)}" style="width:100%;display:block;${style}" />`
    : "";
  const cards = (items: Array<{ label: string; value: string }>, columns = 2) =>
    `<div style="display:grid;grid-template-columns:repeat(${columns},1fr);gap:10px">${items.map((item) => `<div style="background:#fff;border:1px solid ${theme.soft};border-radius:14px;padding:18px 14px"><b style="display:block;color:${theme.primary};font-size:13px;margin-bottom:7px">${esc(item.label)}</b><span style="font-size:12px;line-height:1.65;color:${theme.ink}">${esc(item.value)}</span></div>`).join("")}</div>`;
  const title = (eyebrow: string, heading: string, copy = "") => `<div style="text-align:center;margin-bottom:26px"><small style="display:block;color:${theme.accent};font-size:9px;font-weight:800;letter-spacing:2px;margin-bottom:9px">${esc(eyebrow)}</small><h3 style="margin:0;color:${theme.primary};font-family:Georgia,'Noto Serif KR',serif;font-size:28px;line-height:1.35">${esc(heading)}</h3>${copy ? `<p style="margin:12px auto 0;max-width:560px;color:#716762;font-size:13px;line-height:1.8">${esc(copy)}</p>` : ""}</div>`;
  const section = (name: string, content: string, background = theme.cream, padding = "64px 38px") => `<section data-section="${name}" style="background:${background};padding:${padding}">${content}</section>`;

  const output: string[] = [];
  output.push(`<div style="max-width:860px;margin:0 auto;background:${theme.cream};font-family:Pretendard,'Noto Sans KR',Arial,sans-serif;color:${theme.ink};line-height:1.6;overflow:hidden">`);
  output.push(section("hero", `<div style="text-align:center;padding:22px 24px 28px"><small style="color:${theme.primary};font-size:9px;letter-spacing:2px;font-weight:800">FRESH FROM FARM</small><h1 style="font-family:Georgia,'Noto Serif KR',serif;font-size:42px;line-height:1.22;margin:16px 0 10px;color:${theme.primary}">${esc(model.name || "오늘의 신선함")}</h1><p style="margin:0 0 24px;color:#75665f;font-size:14px">${esc(model.summary)}</p></div>${imageTag(image(0), model.name, "max-height:620px;object-fit:contain;background:#fff")}`, theme.cream, "28px 0 0"));
  output.push(section("empathy", `<div style="max-width:620px;margin:0 auto;text-align:center;color:${theme.primaryText}"><div style="font-family:Georgia,serif;font-size:30px;line-height:1">“</div><h3 style="font-size:25px;line-height:1.4;margin:12px 0">좋은 상품을 고르는 기준,<br/>복잡할 필요 없습니다</h3><p style="font-size:13px;opacity:.86;margin:0">확인된 상품정보를 보기 쉽게 정리해 드립니다.</p></div>`, theme.primary));
  output.push(section("taste", `${title("TASTE & STORY", model.features[0] || "상품의 특징을 확인해 보세요", model.features.slice(1).join(" · "))}<div style="display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:center">${imageTag(image(1), `${model.name} 특징`, "border-radius:22px;background:#fff;max-height:420px;object-fit:contain")}${cards((model.features.length ? model.features : ["입력된 상품 특징을 확인해 주세요"]).map((value, index) => ({ label: `POINT ${String(index + 1).padStart(2, "0")}`, value })), 1)}</div>`));
  output.push(section("criteria", `${title("BEFORE YOU BUY", "구매 전 상품정보를 확인해 주세요", "원산지·품종·구성·보관 방법처럼 입력된 정보만 안내합니다.")}${cards(model.criteria.length ? model.criteria : [{ label: "상품정보", value: "등록된 상세정보를 확인해 주세요" }], 2)}`, "#fff"));
  output.push(section("promises", `${title("THREE POINTS", "안심하고 고르기 위한 세 가지 기준")}${cards(model.promises, 3)}`, theme.soft));
  output.push(section("showcase", `${imageTag(image(2), `${model.name} 구성`, "max-height:620px;object-fit:contain;background:#fff")}<div style="background:${theme.primary};color:${theme.primaryText};padding:24px 32px;text-align:center"><b style="display:block;font-size:22px;margin-bottom:6px">상품정보를 먼저 확인하세요</b><span style="font-size:12px;opacity:.86">${esc(model.weight || model.summary)}</span></div>`, "#fff", "0"));
  const visualStoryImages = model.images.slice(4, 7);
  if (visualStoryImages.length) {
    const visualStory = visualStoryImages.map((src, index) => imageTag(
      src,
      `${model.name} 연출 사진 ${index + 1}`,
      `${index === 0 ? "grid-column:1/-1;max-height:620px" : "max-height:360px"};object-fit:contain;border-radius:22px;background:${theme.cream}`,
    )).join("");
    output.push(section("visual-story", `${title("FRESH MOMENTS", "눈으로 먼저 만나는 신선한 순간", "상품의 질감부터 산지와 식탁의 분위기까지 다양한 장면으로 확인해 보세요.")}<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${visualStory}</div>`, "#fff"));
  }
  output.push(section("process", `${title("FRESH PROCESS", "보내기 전까지 한 번 더 확인합니다")}${cards(model.process.map((item, index) => ({ label: `STEP ${String(index + 1).padStart(2, "0")} · ${item.label}`, value: item.value })), 4)}`));
  output.push(section("package", `<div style="display:grid;grid-template-columns:1fr 1fr;gap:26px;align-items:center"><div><small style="color:${theme.accent};font-size:9px;font-weight:800;letter-spacing:2px">PACKAGE</small><h3 style="color:${theme.primary};font-family:Georgia,'Noto Serif KR',serif;font-size:29px;line-height:1.35;margin:10px 0 14px">선택하신 구성을<br/>확인해 주세요</h3><p style="font-size:13px;line-height:1.8;color:#6f6560">${esc(model.weight || "선택 옵션에 표시된 구성으로 준비됩니다.")}<br/>${esc(model.delivery || "배송 조건은 상품정보를 확인해 주세요.")}</p></div>${imageTag(image(3), `${model.name} 포장`, "border-radius:22px;background:#fff;max-height:420px;object-fit:contain")}</div>`, theme.soft));
  const specRows = model.specs.map((item) => `<tr><th style="width:150px;text-align:left;padding:13px 14px;border-bottom:1px solid ${theme.soft};color:${theme.primary};font-size:12px">${esc(item.label)}</th><td style="padding:13px 14px;border-bottom:1px solid ${theme.soft};font-size:12px">${esc(item.value)}</td></tr>`).join("");
  output.push(section("specs", `${title("PRODUCT GUIDE", "구매 전 확인해 주세요")}<table style="width:100%;border-collapse:collapse;background:#fff;border-top:2px solid ${theme.primary}"><tbody>${specRows}</tbody></table>`, "#fff"));
  const storageCards = [
    { label: "받은 즉시", value: "상품 상태와 주문 구성을 확인해 주세요" },
    { label: "보관 방법", value: model.storage || "상품정보에 표시된 방법으로 보관해 주세요" },
    { label: "섭취 전", value: "상품 상태를 다시 한번 확인해 주세요" },
    { label: "문의 사항", value: options.phone ? `문의 ${options.phone}` : "판매자 문의를 이용해 주세요" },
  ];
  output.push(section("storage", `${title("STORAGE TIP", "더 맛있게 즐기는 방법")}${cards(storageCards, 2)}`));
  const guide = options.guide ? `<p style="font-size:12px;opacity:.82;margin:15px auto 0;max-width:540px">${esc(options.guide)}</p>` : "";
  output.push(section("closing", `<div style="text-align:center;color:${theme.primaryText}"><small style="font-size:9px;letter-spacing:2px;opacity:.7">THANK YOU</small><h3 style="font-family:Georgia,'Noto Serif KR',serif;font-size:32px;line-height:1.35;margin:14px 0">오늘의 신선함을<br/>더 기분 좋게</h3><p style="font-size:13px;opacity:.86;margin:0">상품정보를 확인하고 알맞은 구성을 선택해 주세요.</p>${guide}</div>`, theme.primary, "70px 38px"));
  output.push("</div>");
  return output.join("\n");
}
