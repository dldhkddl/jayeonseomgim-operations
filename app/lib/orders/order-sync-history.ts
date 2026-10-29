export function selectLatestRunsByChannel<T extends { channel: string }>(rows: T[]) {
  const result: Record<string, T> = {};
  for (const row of rows) {
    if (!result[row.channel]) result[row.channel] = row;
  }
  return result;
}
