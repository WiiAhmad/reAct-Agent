import { join } from "node:path";
import { nowIso } from "../../utils/time";
import type { MemoryBackend } from "../core/backend";
import type { ConversationTurnRole, EventMeta, InteractionEvent } from "../core/types";
import {
  appendChatHistoryTurn,
  countChatHistoryRows,
  readChatHistoryTail,
  searchChatHistory,
  type ChatHistoryRow,
} from "../history/jsonl";
import { emitTrace, NEW_MEMORY_STACK_TAG } from "../../logging/helpers";
import type { RuntimeTraceEmitter } from "../../logging/types";
import { exportInteractionEventJsonl } from "./jsonl-export";

type InteractionLogServiceOptions = {
  enabled?: boolean;
  exportDir?: string;
  historyDir: string;
};

export class InteractionLogService {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly options: InteractionLogServiceOptions,
    private readonly trace?: RuntimeTraceEmitter,
  ) {}

  async listInteractionEvents(userId: string, chatId: string, limit: number): Promise<InteractionEvent[]> {
    return this.backend.listInteractionEvents(userId, chatId, limit);
  }

  async logUserMessage(input: { chatId: string; userId: string; content: string; mode?: string }): Promise<number> {
    const createdAt = nowIso();
    const meta: EventMeta = input.mode ? { mode: input.mode } : {};
    const eventId = await this.backend.insertInteractionEvent({
      chatId: input.chatId,
      userId: input.userId,
      type: "user_message",
      content: input.content,
      meta,
      createdAt,
    });

    await appendChatHistoryTurn(this.options.historyDir, {
      chatId: input.chatId,
      userId: input.userId,
      role: "user",
      content: input.content,
      meta,
      createdAt,
    });

    await this.exportIfEnabled({
      id: eventId,
      chatId: input.chatId,
      userId: input.userId,
      type: "user_message",
      content: input.content,
      meta,
      createdAt,
    });
    this.emitLogged("interaction.user_message.logged", input.chatId, input.userId, { eventId, contentLength: input.content.length });

    return eventId;
  }

  async logAssistantMessage(input: { chatId: string; userId: string; content: string; meta?: EventMeta }): Promise<number> {
    const createdAt = nowIso();
    const meta = input.meta ?? {};
    const eventId = await this.backend.insertInteractionEvent({
      chatId: input.chatId,
      userId: input.userId,
      type: "assistant_message",
      content: input.content,
      meta,
      createdAt,
    });

    await appendChatHistoryTurn(this.options.historyDir, {
      chatId: input.chatId,
      userId: input.userId,
      role: "assistant",
      content: input.content,
      meta,
      createdAt,
    });

    await this.exportIfEnabled({
      id: eventId,
      chatId: input.chatId,
      userId: input.userId,
      type: "assistant_message",
      content: input.content,
      meta,
      createdAt,
    });
    this.emitLogged("interaction.assistant_message.logged", input.chatId, input.userId, { eventId, contentLength: input.content.length });

    return eventId;
  }

  async logToolCall(input: {
    chatId: string;
    userId: string;
    toolName: string;
    toolCallId?: string;
    content: string;
    meta?: EventMeta;
  }): Promise<number> {
    const createdAt = nowIso();
    const meta = withToolMeta(input.meta, input.toolName, input.toolCallId);
    const eventId = await this.backend.insertInteractionEvent({
      chatId: input.chatId,
      userId: input.userId,
      type: "tool_call",
      content: input.content,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      meta: input.meta ?? {},
      createdAt,
    });

    await appendChatHistoryTurn(this.options.historyDir, {
      chatId: input.chatId,
      userId: input.userId,
      role: "tool",
      content: input.content,
      meta,
      createdAt,
    });

    await this.exportIfEnabled({
      id: eventId,
      chatId: input.chatId,
      userId: input.userId,
      type: "tool_call",
      content: input.content,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      meta: input.meta ?? {},
      createdAt,
    });
    this.emitLogged("interaction.tool_call.logged", input.chatId, input.userId, { eventId, toolName: input.toolName, toolCallId: input.toolCallId });

    return eventId;
  }

  async logToolResult(input: {
    chatId: string;
    userId: string;
    toolName: string;
    toolCallId?: string;
    content: string;
    offloaded: boolean;
    meta?: EventMeta;
  }): Promise<number> {
    const createdAt = nowIso();
    const meta = withToolMeta(input.meta, input.toolName, input.toolCallId, input.offloaded);
    const eventId = await this.backend.insertInteractionEvent({
      chatId: input.chatId,
      userId: input.userId,
      type: "tool_result",
      content: input.content,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      offloaded: input.offloaded,
      meta: input.meta ?? {},
      createdAt,
    });

    await appendChatHistoryTurn(this.options.historyDir, {
      chatId: input.chatId,
      userId: input.userId,
      role: "tool",
      content: input.content,
      meta,
      createdAt,
    });

    await this.exportIfEnabled({
      id: eventId,
      chatId: input.chatId,
      userId: input.userId,
      type: "tool_result",
      content: input.content,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      offloaded: input.offloaded,
      meta: input.meta ?? {},
      createdAt,
    });
    this.emitLogged("interaction.tool_result.logged", input.chatId, input.userId, { eventId, toolName: input.toolName, toolCallId: input.toolCallId, offloaded: input.offloaded });

    return eventId;
  }

  async recentMessages(
    userId: string,
    chatId: string,
    limit: number,
  ): Promise<Array<{ role: ConversationTurnRole; content: string; created_at: string; meta: EventMeta }>> {
    const rows = await readChatHistoryTail(this.options.historyDir, chatId, limit);
    return rows
      .filter((row) => row.user_id === userId)
      .map((row) => ({ role: row.role, content: row.content, created_at: row.created_at, meta: row.meta }));
  }

  async searchConversations(userId: string, query: string, limit: number, chatId?: string): Promise<ChatHistoryRow[]> {
    return searchChatHistory({ historyDir: this.options.historyDir, userId, query, limit, chatId });
  }

  async countConversations(userId: string, chatId?: string): Promise<number> {
    return countChatHistoryRows(this.options.historyDir, userId, chatId);
  }

  private async exportIfEnabled(event: InteractionEvent): Promise<void> {
    if (this.options.enabled === false || !this.options.exportDir) return;
    await exportInteractionEventJsonl(join(this.options.exportDir, `${event.chatId}.jsonl`), event);
  }

  private emitLogged(event: string, chatId: string, userId: string, payload: Record<string, unknown>) {
    emitTrace(this.trace, {
      minLevel: 2,
      source: "memory",
      event,
      tags: [NEW_MEMORY_STACK_TAG],
      chatId,
      userId,
      payload,
    });
  }
}

function withToolMeta(meta: EventMeta | undefined, toolName: string, toolCallId?: string, offloaded?: boolean): EventMeta {
  return {
    ...(meta ?? {}),
    tool_name: toolName,
    ...(toolCallId ? { tool_call_id: toolCallId } : {}),
    ...(offloaded === undefined ? {} : { offloaded }),
  };
}
