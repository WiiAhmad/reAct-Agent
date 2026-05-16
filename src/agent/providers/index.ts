import { config } from "../../config";
import type { LlmProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { OpenAiProvider } from "./openai";

export function createLlmProvider(): LlmProvider {
  switch (config.llm.provider) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey: config.llm.anthropic.apiKey,
        model: config.llm.anthropic.model,
      });
    case "openai":
      return new OpenAiProvider({
        apiKey: config.llm.openai.apiKey,
        baseURL: config.llm.openai.baseURL,
        model: config.llm.openai.model,
      });
    default:
      throw new Error(`Unsupported LLM_PROVIDER=\"${config.llm.provider}\"`);
  }
}
