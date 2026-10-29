/**
 * 빠른 명령("사과 39900원에 올려줘")이 상품 템플릿을 찾을 때 쓰는 이름 매칭.
 * 헤더 매칭(mapping.ts)과 달리 짧은 상품명 하나를 비교하는 거라 간단한 규칙으로 충분하다.
 */

export type MatchableTemplate = {
  id: string;
  name: string;
  aliases: string;
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * query가 후보 이름 안에 통째로 들어있거나, 후보 이름이 query 안에 들어있으면 높은 점수.
 * 완전히 같으면 1, 부분 포함이면 포함 비율, 아예 다르면 0에 가깝다.
 */
function nameScore(query: string, candidate: string): number {
  const q = norm(query);
  const c = norm(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q)) return q.length / c.length;
  if (q.includes(c)) return c.length / q.length;
  return 0;
}

export function scoreTemplate(query: string, t: MatchableTemplate): number {
  const names = [t.name, ...t.aliases.split(",").map((s) => s.trim())].filter(Boolean);
  return Math.max(0, ...names.map((n) => nameScore(query, n)));
}

/** 점수 순으로 정렬해서 돌려준다. 가장 위가 최선의 후보. */
export function rankTemplates<T extends MatchableTemplate>(query: string, templates: T[]): (T & { score: number })[] {
  return templates
    .map((t) => ({ ...t, score: scoreTemplate(query, t) }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);
}
