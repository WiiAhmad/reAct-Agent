import { config } from "../../config";
import type { RuntimeTraceEmitter } from "../../logging/types";
import type { LlmProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { OpenAiProvider } from "./openai";
import { TracedLlmProvider } from "./traced";

export function createLlmProvider(trace?: RuntimeTraceEmitter): LlmProvider {
  switch (config.llm.provider) {
    case "anthropic":
      return new TracedLlmProvider(new AnthropicProvider({
        apiKey: config.llm.anthropic.apiKey,
        model: config.llm.anthropic.model,
      }), {
        provider: "anthropic",
        model: config.llm.anthropic.model,
        trace,
      });
    case "openai":
      return new TracedLlmProvider(new OpenAiProvider({
        apiKey: config.llm.openai.apiKey,
        baseURL: config.llm.openai.baseURL,
        model: config.llm.openai.model,
      }), {
        provider: "openai",
        model: config.llm.openai.model,
        trace,
      });
    default:
      throw new Error(`Unsupported LLM_PROVIDER=\"${config.llm.provider}\"`);
  }
}
