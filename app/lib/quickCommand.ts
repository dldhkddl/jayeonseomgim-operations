/**
 * 빠른 명령 파서 — "사과 39900원에 50개 올려줘" 같은 문장에서
 * 상품 이름 / 가격 / 재고를 뽑아낸다.
 *
 * 원칙: 애매하면 값을 만들지 않고 undefined로 둔다.
 *   가격은 실제 등록에 그대로 쓰이는 값이라, 잘못 읽으면 잘못된 가격으로 등록되는
 *   사고로 이어진다. 화면에서 "이렇게 읽었습니다"를 사람이 확인한 뒤 등록하게 만들어야 한다.
 */

const UNIT: Record<string, number> = { 만: 10000, 천: 1000, 백: 100 };

/** "3만9천900" 같은 한글 단위 숫자를 정수로. 못 읽으면 null. */
function parseKoreanNumber(raw: string): number | null {
  const s = raw.replace(/,/g, "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  const re = /(\d+)?(만|천|백)/g;
  let total = 0;
  let matchedAny = false;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    matchedAny = true;
    const n = m[1] ? parseInt(m[1], 10) : 1;
    total += n * UNIT[m[2]];
    lastEnd = re.lastIndex;
  }
  if (!matchedAny) return null;

  const tail = s.slice(lastEnd);
  if (tail) {
    if (!/^\d+$/.test(tail)) return null; // 단위 뒤에 알 수 없는 문자가 남으면 신뢰 못 함
    total += parseInt(tail, 10);
  }
  return total;
}

const PRICE_TOKEN = /((?:\d[\d,]*\s*(?:만|천|백)?\s*)+)원/;
const STOCK_TOKEN = /(\d[\d,]*)\s*개/;
/** 명령어에서 빼도 되는 조사·동사 (이름 추출용) */
const NOISE_WORDS = /(에|으로|올려줘|올려|등록해줘|등록|해줘|해|주세요|줘|가격|가|을|를|은|는)/g;

export type QuickChannel = "naver" | "cafe24";

/** 채널 이름 인식. 못 찾으면 undefined (그러면 기본값은 호출부에서 정한다) */
const CHANNEL_TOKENS: { re: RegExp; channel: QuickChannel }[] = [
  { re: /카페\s*24|cafe\s*24/i, channel: "cafe24" },
  { re: /네이버|스마트스토어|smartstore/i, channel: "naver" },
];

export type QuickCommand = {
  /** 원본 문장 */
  raw: string;
  /** 남은 텍스트에서 뽑은 상품 이름 후보 (앞뒤 공백 제거) */
  name: string;
  /** 읽은 가격. 못 읽었으면 undefined (이름에 숫자가 있었을 수도 있으니 함부로 0으로 만들지 않는다) */
  price?: number;
  /** 읽은 재고. 없으면 undefined */
  stock?: number;
  /** 문장에서 읽은 채널. 없으면 undefined — 기본 채널은 호출부에서 정한다 */
  channel?: QuickChannel;
};

export function parseQuickCommand(raw: string): QuickCommand {
  let rest = raw.trim();

  let channel: QuickChannel | undefined;
  for (const { re, channel: c } of CHANNEL_TOKENS) {
    const m = rest.match(re);
    if (m && m.index !== undefined) {
      channel = c;
      rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length);
      break;
    }
  }

  let price: number | undefined;
  const priceMatch = rest.match(PRICE_TOKEN);
  if (priceMatch) {
    const parsed = parseKoreanNumber(priceMatch[1]);
    if (parsed !== null && parsed > 0) {
      price = parsed;
      rest = rest.slice(0, priceMatch.index) + rest.slice((priceMatch.index ?? 0) + priceMatch[0].length);
    }
  }

  let stock: number | undefined;
  const stockMatch = rest.match(STOCK_TOKEN);
  if (stockMatch) {
    const n = parseInt(stockMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n > 0) {
      stock = n;
      rest = rest.slice(0, stockMatch.index) + rest.slice((stockMatch.index ?? 0) + stockMatch[0].length);
    }
  }

  const name = rest.replace(NOISE_WORDS, " ").replace(/\s+/g, " ").trim();

  return { raw, name, price, stock, channel };
}
