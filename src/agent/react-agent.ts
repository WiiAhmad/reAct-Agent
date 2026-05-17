import { config } from "../config";
import type { MemoryService } from "../memory/core/service";
import type { EventMeta } from "../memory/core/types";
import { truncateText } from "../utils/text";
import type { ToolRegistry } from "../tools/registry";
import type { AgentMessage, LlmProvider, ToolCall } from "./types";

export type RunAgentInput = {
  chatId: string;
  userId: string;
  input: string;
  memory: MemoryService;
  registry: ToolRegistry;
  llm: LlmProvider;
  mode?: "chat" | "autonomous";
};

function scenarioBody(scenario: { body_markdown?: string; bodyMarkdown?: string }): string {
  return scenario.body_markdown ?? scenario.bodyMarkdown ?? "";
}

function formatRecall(recall: Awaited<ReturnType<MemoryService["recall"]>>): string {
  const sections: string[] = [];
  if (recall.persona) sections.push(`## L3 Persona\n${recall.persona}`);
  if (recall.scenarios.length) {
    sections.push(
      `## L2 Scenarios\n${recall.scenarios
        .map((s) => `### Scenario #${s.id}: ${s.title}\n${truncateText(scenarioBody(s), 1600)}`)
        .join("\n\n")}`,
    );
  }
  if (recall.atoms.length) {
    sections.push(`## L1 Memory atoms\n${recall.atoms.map((a) => `- atom_id=${a.id} importance=${a.importance}: ${a.text}`).join("\n")}`);
  }
  if (recall.conversations.length) {
    sections.push(
      `## L0 Related conversation evidence\n${recall.conversations
        .map((c) => `- turn_id=${c.id} ${c.created_at} ${c.role}: ${truncateText(c.content, 600)}`)
        .join("\n")}`,
    );
  }
  if (recall.taskCanvas) {
    sections.push(`## Active Mermaid task canvas\n\`\`\`mermaid\n${truncateText(recall.taskCanvas, 2200)}\n\`\`\``);
  }
  return sections.join("\n\n") || "No prior memory found.";
}

function toolCallSummary(call: ToolCall): string {
  return `${call.name}(${truncateText(JSON.stringify(call.arguments ?? {}), 800)})`;
}

function logAgentEvent(event: string, details: Record<string, unknown>) {
  console.log(`[agent:${event}]`, details);
}

function asEventMeta(value: Record<string, unknown>): EventMeta {
  return JSON.parse(JSON.stringify(value)) as EventMeta;
}

export async function runReactAgent(input: RunAgentInput): Promise<string> {
  logAgentEvent("start", {
    mode: input.mode ?? "chat",
    chatId: input.chatId,
    userId: input.userId,
    input: truncateText(input.input, 200),
  });

  await input.memory.logUserMessage({
    chatId: input.chatId,
    userId: input.userId,
    content: input.input,
    mode: input.mode ?? "chat",
  });

  const [recent, recall] = await Promise.all([
    input.memory.recentMessages(input.userId, input.chatId, config.agent.maxRecentMessages),
    input.memory.recall(input.userId, input.input, config.memory.recallMaxResults, input.chatId),
  ]);

  logAgentEvent("context", {
    mode: input.mode ?? "chat",
    chatId: input.chatId,
    recentMessages: recent.length,
    recall: {
      atoms: recall.atoms.length,
      scenarios: recall.scenarios.length,
      conversations: recall.conversations.length,
      hasPersona: Boolean(recall.persona),
      hasCanvas: Boolean(recall.taskCanvas),
    },
  });

  const system = `You are a Telegram AI agent running on grammY with built-in local tools and a project-owned local memory backend.

Use a ReAct-style loop internally:
1. Understand the user goal.
2. Recall memory first, especially L3 Persona and L2 Scenarios.
3. Decide whether a tool is needed.
4. Call tools when useful.
5. Observe tool results. If a result was offloaded, use tdai_context_ref_read only when raw details are needed.
6. Answer clearly in the user's language.

Memory layers:
- L0 Conversation: raw JSONL + SQLite history.
- L1 Atom: durable facts/preferences/workflow facts.
- L2 Scenario: grouped scene markdown with source atom references.
- L3 Persona: stable profile injected before turns.
- Short-term context offload: heavy tool results go to refs/*.md and a Mermaid task canvas with node_id/result_ref.

Rules:
- Do not reveal hidden chain-of-thought. Give concise reasoning summaries only when useful.
- Prefer tools for fresh/private/actionable data.
- Use save_memory only for durable preferences, stable project context, or reusable workflow facts.
- If a tool fails, recover or explain the limitation.
- For Telegram, keep the final answer practical and not too long.`;

  const memoryContext = `Relevant layered memory snapshot:\n\n${formatRecall(recall)}`;

  const messages: AgentMessage[] = [
    { role: "system", content: system },
    { role: "system", content: memoryContext },
    ...recent
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }) as AgentMessage),
  ];

  const tools = input.registry.list();
  let final = "";

  for (let i = 0; i < config.agent.maxToolIterations; i++) {
    logAgentEvent("iteration", {
      mode: input.mode ?? "chat",
      chatId: input.chatId,
      iteration: i + 1,
      messageCount: messages.length,
      toolCount: tools.length,
    });

    const response = await input.llm.complete({ messages, tools });
    final = response.content || final;

    logAgentEvent("llm-response", {
      mode: input.mode ?? "chat",
      chatId: input.chatId,
      iteration: i + 1,
      toolCalls: response.toolCalls.length,
      contentPreview: truncateText(response.content || "", 200),
    });

    if (response.toolCalls.length === 0) {
      const answer = response.content || "Saya belum bisa menghasilkan jawaban.";
      await input.memory.logAssistantMessage({
        chatId: input.chatId,
        userId: input.userId,
        content: answer,
        meta: { mode: input.mode ?? "chat", tool_iterations: i },
      });
      logAgentEvent("complete", {
        mode: input.mode ?? "chat",
        chatId: input.chatId,
        iterations: i + 1,
        answerLength: answer.length,
        answerPreview: truncateText(answer, 200),
      });
      return answer;
    }

    messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });

    for (const call of response.toolCalls) {
      logAgentEvent("tool-call", {
        mode: input.mode ?? "chat",
        chatId: input.chatId,
        tool: call.name,
        args: truncateText(JSON.stringify(call.arguments ?? {}), 200),
      });

      await input.memory.logToolCall({
        chatId: input.chatId,
        userId: input.userId,
        toolName: call.name,
        toolCallId: call.id,
        content: `CALL ${toolCallSummary(call)}`,
        meta: { tool_call_id: call.id, tool_name: call.name },
      });

      const rawResult = await input.registry.call(call.name, call.arguments, {
        chatId: input.chatId,
        userId: input.userId,
        memory: input.memory,
      });

      const offload = await input.memory.offloadToolResult({
        chatId: input.chatId,
        userId: input.userId,
        toolName: call.name,
        args: asEventMeta(call.arguments ?? {}),
        rawResult,
      });

      const observation = truncateText(offload.content, 12000);
      messages.push({
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: observation,
      });

      await input.memory.logToolResult({
        chatId: input.chatId,
        userId: input.userId,
        toolName: call.name,
        toolCallId: call.id,
        content: `RESULT ${call.name}${offload.offloaded ? ` offloaded node_id=${offload.nodeId} result_ref=${offload.resultRef}` : ""}:\n${observation}`,
        offloaded: offload.offloaded,
        meta: {
          tool_call_id: call.id,
          tool_name: call.name,
          offloaded: offload.offloaded,
          ...(offload.nodeId ? { node_id: offload.nodeId } : {}),
          ...(offload.resultRef ? { result_ref: offload.resultRef } : {}),
        },
      });

      logAgentEvent("tool-result", {
        mode: input.mode ?? "chat",
        chatId: input.chatId,
        tool: call.name,
        offloaded: offload.offloaded,
        nodeId: offload.nodeId,
        resultRef: offload.resultRef,
        preview: truncateText(observation, 200),
      });
    }
  }

  const fallback = final || "Tool loop mencapai batas iterasi. Coba pecah request jadi lebih kecil.";
  await input.memory.logAssistantMessage({
    chatId: input.chatId,
    userId: input.userId,
    content: fallback,
    meta: { mode: input.mode ?? "chat", stopped: "max_tool_iterations" },
  });
  logAgentEvent("max-iterations", {
    mode: input.mode ?? "chat",
    chatId: input.chatId,
    answerLength: fallback.length,
    answerPreview: truncateText(fallback, 200),
  });
  return fallback;
}
