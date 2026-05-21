import { expect, test } from "bun:test";
import { parseConfig } from "../../src/config";
import { buildMemoryServiceFactoryConfig } from "../../src/memory/integration/app-config";

test("buildMemoryServiceFactoryConfig forwards semantic memory settings", () => {
  const runtime = parseConfig({
    BOT_TOKEN: "123:abc",
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-test",
    MEMORY_L1_ENABLED: "false",
    MEMORY_L2_ENABLED: "false",
    MEMORY_TASK_RECALL_ENABLED: "false",
  });

  const factoryConfig = buildMemoryServiceFactoryConfig(runtime);

  expect(factoryConfig.memory.l1).toEqual(runtime.memory.l1);
  expect(factoryConfig.memory.l2).toEqual(runtime.memory.l2);
  expect(factoryConfig.memory.taskRecall).toEqual(runtime.memory.taskRecall);
});
