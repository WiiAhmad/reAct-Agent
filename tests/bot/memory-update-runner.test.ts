import { expect, test } from "bun:test";
import {
  formatMemoryUpdateFinalMessage,
  formatMemoryUpdateProgressMessage,
  resetActiveMemoryUpdateRunsForTest,
  startTelegramMemoryUpdateRun,
} from "../../src/bot/conversations/memory-update-runner";

test("formatMemoryUpdateProgressMessage renders stage messages", () => {
  expect(formatMemoryUpdateProgressMessage({ source: "telegram", userId: "u1", stage: "l1", status: "start" })).toBe("L1 dimulai...");
  expect(formatMemoryUpdateProgressMessage({ source: "telegram", userId: "u1", stage: "l1", status: "complete", createdAtoms: 3 })).toBe("L1 selesai: 3 atom dibuat.");
  expect(formatMemoryUpdateProgressMessage({ source: "telegram", userId: "u1", stage: "l2", status: "complete", scenarioId: 9 })).toBe("L2 selesai: scenario #9.");
  expect(formatMemoryUpdateProgressMessage({ source: "telegram", userId: "u1", stage: "l3", status: "complete", personaUpdated: true })).toBe("L3 selesai: persona updated.");
  expect(formatMemoryUpdateProgressMessage({ source: "telegram", userId: "u1", stage: "l2", status: "skip", reason: "no_atoms" })).toBe("L2 dilewati: tidak ada atom.");
});

test("formatMemoryUpdateFinalMessage summarizes L1, L2, and L3", () => {
  expect(formatMemoryUpdateFinalMessage({ l1Created: 2, l2ScenarioId: 7, personaUpdated: true })).toBe("Memory update selesai. L1=2 atom, L2=scenario #7, L3=updated.");
  expect(formatMemoryUpdateFinalMessage({ l1Created: 0, l2ScenarioId: undefined, personaUpdated: false })).toBe("Memory update selesai. L1=0 atom, L2=dilewati, L3=dilewati.");
});

test("startTelegramMemoryUpdateRun starts background work without waiting for pipeline completion", async () => {
  resetActiveMemoryUpdateRunsForTest();
  const sent: string[] = [];
  let resolveRun!: () => void;
  let runStarted = false;
  const runPromise = new Promise<{ maintenanceResult: { l1Created: number; l2ScenarioId?: number; personaUpdated: boolean } }>((resolve) => {
    resolveRun = () => resolve({ maintenanceResult: { l1Created: 1, l2ScenarioId: 4, personaUpdated: true } });
  });

  const result = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async (text) => {
      sent.push(text);
    },
    runNow: async (input) => {
      runStarted = true;
      await input.onProgress?.({ source: "telegram", userId: "u1", stage: "l1", status: "start" });
      return runPromise as any;
    },
  });

  expect(result.status).toBe("started");
  expect(runStarted).toBe(true);
  expect(sent).toEqual(["Memory update dimulai...", "L1 dimulai..."]);

  resolveRun();
  if (result.status === "started") {
    await result.completion;
  }

  expect(sent).toContain("Memory update selesai. L1=1 atom, L2=scenario #4, L3=updated.");
});

test("startTelegramMemoryUpdateRun prevents duplicate active runs for the same user", async () => {
  resetActiveMemoryUpdateRunsForTest();
  const sent: string[] = [];
  let resolveRun!: () => void;
  const runPromise = new Promise<{ maintenanceResult: { l1Created: number; l2ScenarioId?: number; personaUpdated: boolean } }>((resolve) => {
    resolveRun = () => resolve({ maintenanceResult: { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false } });
  });

  const first = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async (text) => {
      sent.push(text);
    },
    runNow: async () => runPromise as any,
  });
  const second = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async (text) => {
      sent.push(text);
    },
    runNow: async () => {
      throw new Error("second run should not start");
    },
  });

  expect(first.status).toBe("started");
  expect(second.status).toBe("already-running");
  expect(sent).toEqual(["Memory update dimulai..."]);

  resolveRun();
  if (first.status === "started") {
    await first.completion;
  }
});

test("startTelegramMemoryUpdateRun clears active guard when the initial send fails", async () => {
  resetActiveMemoryUpdateRunsForTest();
  let firstRunStarted = false;

  await expect(
    startTelegramMemoryUpdateRun({
      memory: {} as any,
      settings: {} as any,
      userId: "u1",
      sendMessage: async () => {
        throw new Error("telegram unavailable");
      },
      runNow: async () => {
        firstRunStarted = true;
        return { maintenanceResult: { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false } } as any;
      },
    }),
  ).rejects.toThrow("telegram unavailable");

  expect(firstRunStarted).toBe(false);

  const second = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async () => {},
    runNow: async () => ({ maintenanceResult: { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false } }) as any,
  });

  expect(second.status).toBe("started");
  if (second.status === "started") {
    await second.completion;
  }
});

test("startTelegramMemoryUpdateRun ignores progress and final send failures after successful maintenance", async () => {
  resetActiveMemoryUpdateRunsForTest();
  const sent: string[] = [];
  const loggedErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };

  try {
    const first = await startTelegramMemoryUpdateRun({
      memory: {} as any,
      settings: {} as any,
      userId: "u1",
      sendMessage: async (text) => {
        sent.push(text);
        if (text === "L1 dimulai..." || text.startsWith("Memory update selesai.")) {
          throw new Error(`send failed: ${text}`);
        }
      },
      runNow: async (input) => {
        await input.onProgress?.({ source: "telegram", userId: "u1", stage: "l1", status: "start" });
        return { maintenanceResult: { l1Created: 1, l2ScenarioId: 4, personaUpdated: true } } as any;
      },
    });

    expect(first.status).toBe("started");
    if (first.status === "started") {
      await expect(first.completion).resolves.toBeUndefined();
    }

    expect(sent).toEqual(["Memory update dimulai...", "L1 dimulai...", "Memory update selesai. L1=1 atom, L2=scenario #4, L3=updated."]);
    expect(sent.some((message) => message.startsWith("Memory update gagal:"))).toBe(false);
    expect(loggedErrors).toHaveLength(2);

    const second = await startTelegramMemoryUpdateRun({
      memory: {} as any,
      settings: {} as any,
      userId: "u1",
      sendMessage: async (text) => {
        sent.push(text);
      },
      runNow: async () => ({ maintenanceResult: { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false } }) as any,
    });

    expect(second.status).toBe("started");
    if (second.status === "started") {
      await second.completion;
    }
  } finally {
    console.error = originalConsoleError;
  }
});

test("startTelegramMemoryUpdateRun allows a new run after the previous completion settles", async () => {
  resetActiveMemoryUpdateRunsForTest();
  const sent: string[] = [];

  const first = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async (text) => {
      sent.push(text);
    },
    runNow: async () => ({ maintenanceResult: { l1Created: 0, l2ScenarioId: undefined, personaUpdated: false } }) as any,
  });
  if (first.status === "started") await first.completion;

  const second = await startTelegramMemoryUpdateRun({
    memory: {} as any,
    settings: {} as any,
    userId: "u1",
    sendMessage: async (text) => {
      sent.push(text);
    },
    runNow: async () => ({ maintenanceResult: { l1Created: 1, l2ScenarioId: 2, personaUpdated: true } }) as any,
  });
  if (second.status === "started") await second.completion;

  expect(first.status).toBe("started");
  expect(second.status).toBe("started");
  expect(sent).toContain("Memory update selesai. L1=0 atom, L2=dilewati, L3=dilewati.");
  expect(sent).toContain("Memory update selesai. L1=1 atom, L2=scenario #2, L3=updated.");
});
