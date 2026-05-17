import { join } from "node:path";
import { nowIso } from "../../utils/time";
import type { MemoryBackend } from "../core/backend";
import type { EventMeta, InteractionEvent } from "../core/types";
import { exportInteractionEventJsonl } from "./jsonl-export";

type InteractionLogServiceOptions = {
  enabled?: boolean;
  exportDir?: string;
};

export class InteractionLogService {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly options: InteractionLogServiceOptions,
  ) {}

  async listInteractionEvents(userId: string, chatId: string, limit: number): Promise<InteractionEvent[]> {
    return this.backend.listInteractionEvents(userId, chatId, limit);
  }

  async logUserMessage(input: { chatId: string; userId: string; content: string; mode?: string }): Promise<number> {
    const createdAt = nowIso();
    const eventId = await this.backend.insertInteractionEvent({
      chatId: input.chatId,
      userId: input.userId,
      type: "user_message",
      content: input.content,
      meta: input.mode ? { mode: input.mode } : {},
      createdAt,
    });

    await this.backend.insertConversationTurn({
      chatId: input.chatId,
      userId: input.userId,
      role: "user",
      content: input.content,
      meta: input.mode ? { mode: input.mode } : {},
      createdAt,
    });

    await this.exportIfEnabled({
      id: eventId,
      chatId: input.chatId,
      userId: input.userId,
      type: "user_message",
      content: input.content,
      meta: input.mode ? { mode: input.mode } : {},
      createdAt,
    });

    return eventId;
  }

  async logAssistantMessage(input: { chatId: string; userId: string; content: string; meta?: EventMeta }): Promise<number> {
    const createdAt = nowIso();
    const eventId = await this.backend.insertInteractionEvent({
      chatId: input.chatId,
      userId: input.userId,
      type: "assistant_message",
      content: input.content,
      meta: input.meta ?? {},
      createdAt,
    });

    await this.backend.insertConversationTurn({
      chatId: input.chatId,
      userId: input.userId,
      role: "assistant",
      content: input.content,
      meta: input.meta ?? {},
      createdAt,
    });

    await this.exportIfEnabled({
      id: eventId,
      chatId: input.chatId,
      userId: input.userId,
      type: "assistant_message",
      content: input.content,
      meta: input.meta ?? {},
      createdAt,
    });

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

    await this.backend.insertConversationTurn({
      chatId: input.chatId,
      userId: input.userId,
      role: "tool",
      content: input.content,
      meta: input.meta ?? {},
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

    await this.backend.insertConversationTurn({
      chatId: input.chatId,
      userId: input.userId,
      role: "tool",
      content: input.content,
      meta: input.meta ?? {},
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

    return eventId;
  }

  private async exportIfEnabled(event: InteractionEvent): Promise<void> {
    if (this.options.enabled === false || !this.options.exportDir) return;
    await exportInteractionEventJsonl(join(this.options.exportDir, `${event.chatId}.jsonl`), event);
  }
}
