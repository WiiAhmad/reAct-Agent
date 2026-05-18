import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonl } from "../jsonl";
import type { EventMeta } from "../core/types";

export type ChatHistoryRole = "user" | "assistant" | "system" | "tool";

export type ChatHistoryRow<TMeta extends EventMeta = EventMeta> = {
  id: number;
  chat_id: string;
  user_id: string;
  role: ChatHistoryRole;
  content: string;
  meta: TMeta;
  created_at: string;
};

export type NewChatHistoryRow<TMeta extends EventMeta = EventMeta> = {
  chatId: string;
  userId: string;
  role: ChatHistoryRole;
  content: string;
  meta?: TMeta;
  createdAt?: string;
};

export type SearchChatHistoryInput = {
  historyDir: string;
  userId: string;
  query: string;
  limit: number;
  chatId?: string;
};

export function safeChatHistorySegment(chatId: string): string {
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe.length > 0 ? safe : "unknown";
}

export function getChatHistoryPath(historyDir: string, chatId: string): string {
  return join(historyDir, `${safeChatHistorySegment(chatId)}.jsonl`);
}

export async function appendChatHistoryTurn<TMeta extends EventMeta = EventMeta>(
  historyDir: string,
  input: NewChatHistoryRow<TMeta>,
): Promise<ChatHistoryRow<TMeta>> {
  const existing = await readChatHistoryRows(historyDir, input.chatId);
  const id = existing.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const row: ChatHistoryRow<TMeta> = {
    id,
    chat_id: input.chatId,
    user_id: input.userId,
    role: input.role,
    content: input.content,
    meta: input.meta ?? ({} as TMeta),
    created_at: input.createdAt ?? new Date().toISOString(),
  };
  await appendJsonl(getChatHistoryPath(historyDir, input.chatId), row);
  return row;
}

export async function readChatHistoryTail(historyDir: string, chatId: string, limit = 50): Promise<ChatHistoryRow[]> {
  return (await readChatHistoryRows(historyDir, chatId)).slice(-limit);
}

export async function searchChatHistory(input: SearchChatHistoryInput): Promise<ChatHistoryRow[]> {
  const query = input.query.trim().toLowerCase();
  if (!query) {
    return [];
  }
  const rows = await readCandidateRows(input.historyDir, input.chatId);
  return rows
    .filter((row) => row.user_id === input.userId)
    .filter((row) => {
      return row.content.toLowerCase().includes(query) || JSON.stringify(row.meta).toLowerCase().includes(query);
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-input.limit)
    .reverse();
}

export async function countChatHistoryRows(historyDir: string, userId: string, chatId?: string): Promise<number> {
  const rows = await readCandidateRows(historyDir, chatId);
  return rows.filter((row) => row.user_id === userId).length;
}

async function readCandidateRows(historyDir: string, chatId?: string): Promise<ChatHistoryRow[]> {
  if (chatId) {
    return readChatHistoryRows(historyDir, chatId);
  }

  let entries: string[];
  try {
    entries = await readdir(historyDir);
  } catch {
    return [];
  }

  const rows = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".jsonl"))
      .map((entry) => readRowsFromPath(join(historyDir, entry))),
  );
  return rows.flat();
}

async function readChatHistoryRows(historyDir: string, chatId: string): Promise<ChatHistoryRow[]> {
  return readRowsFromPath(getChatHistoryPath(historyDir, chatId));
}

async function readRowsFromPath(path: string): Promise<ChatHistoryRow[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ChatHistoryRow);
  } catch {
    return [];
  }
}
