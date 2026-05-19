import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendChatHistoryTurn, readChatHistoryTail, searchChatHistory } from "../../src/memory/history/jsonl";
import { InteractionLogService } from "../../src/memory/events/service";

test("appendChatHistoryTurn writes canonical role rows with increasing per-chat ids", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-history-jsonl-"));
  const historyDir = join(tempDir, "history");

  try {
    const first = await appendChatHistoryTurn(historyDir, {
      chatId: "chat/one",
      userId: "user-1",
      role: "user",
      content: "hello",
      meta: { mode: "chat" },
      createdAt: "2026-05-18T00:00:00.000Z",
    });
    const second = await appendChatHistoryTurn(historyDir, {
      chatId: "chat/one",
      userId: "user-1",
      role: "assistant",
      content: "hi there",
      createdAt: "2026-05-18T00:00:01.000Z",
    });

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(await readChatHistoryTail(historyDir, "chat/one", 10)).toEqual([
      {
        id: 1,
        chat_id: "chat/one",
        user_id: "user-1",
        role: "user",
        content: "hello",
        meta: { mode: "chat" },
        created_at: "2026-05-18T00:00:00.000Z",
      },
      {
        id: 2,
        chat_id: "chat/one",
        user_id: "user-1",
        role: "assistant",
        content: "hi there",
        meta: {},
        created_at: "2026-05-18T00:00:01.000Z",
      },
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("readChatHistoryTail returns recent rows and searchChatHistory filters by content and user", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-history-jsonl-"));
  const historyDir = join(tempDir, "history");

  try {
    await appendChatHistoryTurn(historyDir, {
      chatId: "chat-a",
      userId: "user-1",
      role: "user",
      content: "alpha topic",
      createdAt: "2026-05-18T00:00:00.000Z",
    });
    await appendChatHistoryTurn(historyDir, {
      chatId: "chat-a",
      userId: "user-1",
      role: "assistant",
      content: "beta topic",
      createdAt: "2026-05-18T00:00:01.000Z",
    });
    await appendChatHistoryTurn(historyDir, {
      chatId: "chat-a",
      userId: "user-1",
      role: "tool",
      content: "gamma topic",
      meta: { tag: "needle" },
      createdAt: "2026-05-18T00:00:02.000Z",
    });
    await appendChatHistoryTurn(historyDir, {
      chatId: "chat-b",
      userId: "user-2",
      role: "user",
      content: "needle for someone else",
      createdAt: "2026-05-18T00:00:03.000Z",
    });

    expect((await readChatHistoryTail(historyDir, "chat-a", 2)).map((row) => row.content)).toEqual([
      "beta topic",
      "gamma topic",
    ]);

    const results = await searchChatHistory({ historyDir, userId: "user-1", query: "needle", limit: 5 });
    expect(results.map((row) => row.content)).toEqual(["gamma topic"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("searchChatHistory returns no rows for blank queries", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-history-jsonl-"));
  const historyDir = join(tempDir, "history");

  try {
    await appendChatHistoryTurn(historyDir, {
      chatId: "chat-a",
      userId: "user-1",
      role: "user",
      content: "alpha topic",
      createdAt: "2026-05-18T00:00:00.000Z",
    });

    expect(await searchChatHistory({ historyDir, userId: "user-1", query: "", limit: 5 })).toEqual([]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("InteractionLogService writes canonical chat history without SQLite transcript writes", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "grammy-history-jsonl-"));
  const historyDir = join(tempDir, "history");
  let sqliteConversationWrites = 0;
  let nextEventId = 0;
  const backend = {
    async insertInteractionEvent() {
      nextEventId += 1;
      return nextEventId;
    },
    async insertConversationTurn() {
      sqliteConversationWrites += 1;
      throw new Error("raw transcript writes must use JSONL history");
    },
    async listInteractionEvents() {
      return [];
    },
  };

  try {
    const traceEvents: Array<{ source: string; event: string; tags?: string[] }> = [];
    const service = new InteractionLogService(backend as any, { enabled: false, historyDir }, { emit: (event) => traceEvents.push(event) });
    await service.logUserMessage({ chatId: "chat-1", userId: "user-1", content: "hello", mode: "chat" });
    await service.logAssistantMessage({ chatId: "chat-1", userId: "user-1", content: "hi" });
    await service.logToolResult({
      chatId: "chat-1",
      userId: "user-1",
      toolName: "demo",
      toolCallId: "call_1",
      content: "tool output",
      offloaded: false,
    });

    const rows = await readChatHistoryTail(historyDir, "chat-1", 10);
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "tool"]);
    expect(rows[0]?.meta).toEqual({ mode: "chat" });
    expect(rows[2]?.meta).toEqual({ tool_name: "demo", tool_call_id: "call_1", offloaded: false });
    expect(traceEvents.map((event) => `${event.source}:${event.event}`)).toEqual([
      "memory:interaction.user_message.logged",
      "memory:interaction.assistant_message.logged",
      "memory:interaction.tool_result.logged",
    ]);
    expect(traceEvents.every((event) => event.tags?.includes("new-memory-stack"))).toBe(true);
    expect(sqliteConversationWrites).toBe(0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
