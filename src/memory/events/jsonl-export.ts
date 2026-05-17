import { appendJsonl } from "../jsonl";
import type { InteractionEvent } from "../core/types";

export async function exportInteractionEventJsonl(exportPath: string, event: InteractionEvent): Promise<void> {
  await appendJsonl(exportPath, {
    id: event.id,
    chat_id: event.chatId,
    user_id: event.userId,
    type: event.type,
    content: event.content,
    tool_name: event.toolName,
    tool_call_id: event.toolCallId,
    offloaded: event.offloaded,
    meta: event.meta,
    created_at: event.createdAt,
  });
}
