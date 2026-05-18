import { config } from "../config";
import type { MemoryService } from "../memory/core/service";
import type { EventMeta } from "../memory/core/types";
import { truncateText } from "../utils/text";
import type { ToolRegistry } from "../tools/registry";
import type { AgentMessage, LlmProvider, ToolCall } from "./types";
import { buildAgentSystemPrompt } from "./prompts/system";

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
  if (recall.taskCanvases.length) {
    sections.push(
      `## Relevant historical task canvases\n${recall.taskCanvases
        .map((task) => `### Task #${task.id}: ${task.label} (${task.status})\nfile_path=${task.filePath}\n\`\`\`mermaid\n${truncateText(task.canvas, 2200)}\n\`\`\``)
        .join("\n\n")}`,
    );
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

function shouldExposeSchedulingTools(input: string): boolean {
  const normalized = input.normalize("NFKC").toLowerCase();
  return [
    /\bingatkan\b/u,
    /\bpengingat\b/u,
    /\bjadwalkan\b/u,
    /\bjadwal\b/u,
    /\bremind(?:er)?\b/u,
    /\bschedul(?:e|ed)\b/u,
    /\bset alarm\b/u,
    /\bsetiap\b/u,
    /\btiap\b/u,
    /\bevery\b/u,
    /\bbesok\b/u,
    /\btomorrow\b/u,
    /\b(\d+)\s*(detik|menit|jam|hari|seconds?|minutes?|hours?|days?)\b/u,
  ].some((pattern) => pattern.test(normalized));
}

export async function runReactAgent(input: RunAgentInput): Promise<string> {
  logAgentEvent("start", {
    mode: input.mode ?? "chat",
    chatId: input.chatId,
    userId: input.userId,
    input: truncateText(input.input, 200),
  });

  const sourceConversationId = await input.memory.logUserMessage({
    chatId: input.chatId,
    userId: input.userId,
    content: input.input,
    mode: input.mode ?? "chat",
  });
  const taskRouting = await input.memory.judgeTaskTurn({
    chatId: input.chatId,
    userId: input.userId,
    latestUserMessage: input.input,
    sourceConversationId,
  });
  logAgentEvent("l15", {
    mode: input.mode ?? "chat",
    chatId: input.chatId,
    isLongTask: taskRouting.judgment.isLongTask,
    isContinuation: taskRouting.judgment.isContinuation,
    taskCompleted: taskRouting.judgment.taskCompleted,
    taskId: taskRouting.taskId,
    source: taskRouting.judgment.source,
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
      taskCanvases: recall.taskCanvases.length,
    },
  });

  const system = buildAgentSystemPrompt();

  const memoryContext = `Relevant layered memory snapshot:\n\n${formatRecall(recall)}`;

  const messages: AgentMessage[] = [
    { role: "system", content: system },
    { role: "system", content: memoryContext },
    ...recent
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }) as AgentMessage),
  ];

  const schedulingAllowed = shouldExposeSchedulingTools(input.input);
  const tools = input.registry
    .list()
    .filter((tool) => input.mode !== "autonomous" || (tool.name !== "tdai_create_job" && tool.name !== "telegram_send_message"))
    .filter((tool) => tool.name !== "tdai_create_job" || input.mode === "autonomous" || schedulingAllowed);
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
        taskId: taskRouting.taskId,
        toolCallId: call.id,
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
