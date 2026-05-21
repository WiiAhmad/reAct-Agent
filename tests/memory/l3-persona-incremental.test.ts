import { expect, test } from "bun:test";
import { computeSceneFingerprint } from "../../src/memory/pipeline/l3-scenes";

test("computeSceneFingerprint is stable for the same set of scene files", () => {
  const first = computeSceneFingerprint([
    { filename: "scene-runtime.md", contentMd5: "a" },
    { filename: "scene-build.md", contentMd5: "b" },
  ]);
  const second = computeSceneFingerprint([
    { filename: "scene-build.md", contentMd5: "b" },
    { filename: "scene-runtime.md", contentMd5: "a" },
  ]);

  expect(first).toBe(second);
});
