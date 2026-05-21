import { expect, test } from "bun:test";
import {
  buildL1RecordMetadata,
  normalizeL1RecordMetadata,
} from "../../src/memory/core/store/record-metadata";

test("normalizeL1RecordMetadata preserves TencentDB-style semantic fields", () => {
  const metadata = normalizeL1RecordMetadata(
    buildL1RecordMetadata({
      source: "pipeline",
      canonicalText: "use bun for local scripts",
      memoryKind: "instruction",
      sourceMessageIds: ["msg-1", "msg-2", "msg-1"],
      timestamps: ["2026-05-18T08:00:00.000Z", "2026-05-18T08:00:00.000Z"],
    }),
  );

  expect(metadata).toEqual({
    source: "pipeline",
    canonicalText: "use bun for local scripts",
    memoryKind: "instruction",
    sourceMessageIds: ["msg-1", "msg-2"],
    timestamps: ["2026-05-18T08:00:00.000Z"],
  });
});
