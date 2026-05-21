import { expect, test } from "bun:test";
import { computeRetentionCutoffIso } from "../../src/memory/pipeline/cleanup";

test("computeRetentionCutoffIso subtracts retention days from the current time", () => {
  expect(computeRetentionCutoffIso(30, new Date("2026-05-21T12:00:00.000Z"))).toBe(
    "2026-04-21T12:00:00.000Z",
  );
});
