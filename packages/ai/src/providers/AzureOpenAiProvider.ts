import { AiMessage, AiRequestOptions, AiProviderRequest } from "../types.js";
import { raiseError } from "../raiseError.js";
import { OpenAiProvider } from "./OpenAiProvider.js";

export class AzureOpenAiProvider extends OpenAiProvider {
  override buildRequest(messages: AiMessage[], options: AiRequestOptions): AiProviderRequest {
    if (!options.baseUrl) {
      raiseError("base-url is required for Azure OpenAI.");
    }

    const apiVersion = options.apiVersion || "2024-02-01";
    const url = `${options.baseUrl}/openai/deployments/${options.model}/chat/completions?api-version=${apiVersion}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.apiKey) {
      headers["api-key"] = options.apiKey;
    }

    const body: Record<string, any> = {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: options.stream ?? true,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (body.stream) body.stream_options = { include_usage: true };

    return { url, headers, body: JSON.stringify(body) };
  }
}
