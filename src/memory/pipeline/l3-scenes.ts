import { createHash } from "node:crypto";

export function computeSceneFingerprint(scenes: Array<{ filename: string; contentMd5: string }>) {
  const stable = scenes
    .map((scene) => `${scene.filename}\0${scene.contentMd5}`)
    .sort()
    .join("\n");

  return createHash("sha256").update(stable).digest("hex");
}
