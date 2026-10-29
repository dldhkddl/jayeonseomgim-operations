export type BulkInventoryTarget = { id: string };

export type BulkInventoryResult = {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
};

export async function runBulkInventoryAction<T extends BulkInventoryTarget>(
  items: T[],
  mutate: (item: T) => Promise<void>,
): Promise<BulkInventoryResult> {
  const distinct = [...new Map(items.map((item) => [item.id, item])).values()];
  const result: BulkInventoryResult = { succeeded: [], failed: [] };
  for (const item of distinct) {
    try {
      await mutate(item);
      result.succeeded.push(item.id);
    } catch (error) {
      result.failed.push({ id: item.id, error: error instanceof Error ? error.message : "처리 실패" });
    }
  }
  return result;
}
