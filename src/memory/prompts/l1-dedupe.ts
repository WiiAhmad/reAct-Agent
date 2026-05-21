import type { L1Record } from "../core/store/types";

export function buildL1DedupePrompt(newRecord: L1Record, candidates: L1Record[]): string {
  return [
    "Decide whether this new L1 memory should be stored as new, update an existing record, merge into an existing record, or be skipped as duplicate/noise.",
    "Return strict JSON only with action store|update|merge|skip and targetRecordId when applicable.",
    "Use action=store when there is no semantic conflict.",
    "Use action=update or action=merge only when targetRecordId is one of the candidate recordId values.",
    "Use action=skip when the new memory should not be stored or mirrored.",
    JSON.stringify({ newRecord, candidates }, null, 2),
  ].join("\n\n");
}
