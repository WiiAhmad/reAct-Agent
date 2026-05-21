import type { IMemoryStore } from "../core/store/types";

export function computeRetentionCutoffIso(retentionDays: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

export async function pruneExpiredMemory(store: IMemoryStore | undefined, retentionDays: number) {
  if (!store || retentionDays <= 0) {
    return { l0Deleted: 0, l1Deleted: 0 };
  }

  const cutoffIso = computeRetentionCutoffIso(retentionDays);
  const [l0Deleted, l1Deleted] = await Promise.all([
    store.deleteL0Expired(cutoffIso),
    store.deleteL1Expired(cutoffIso),
  ]);

  return { l0Deleted, l1Deleted, cutoffIso };
}
