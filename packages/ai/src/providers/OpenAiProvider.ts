import { IAiProvider, AiMessage, AiUsage, AiRequestOptions, AiProviderRequest, AiStreamChunkResult } from "../types.js";

export class OpenAiProvider implements IAiProvider {
  buildRequest(messages: AiMessage[], options: AiRequestOptions): AiProviderRequest {
    const baseUrl = options.baseUrl || "https://api.openai.com";
    const url = `${baseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.apiKey) {
      headers["Authorization"] = `Bearer ${options.apiKey}`;
    }

    const body: Record<string, any> = {
      model: options.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: options.stream ?? true,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (body.stream) body.stream_options = { include_usage: true };

    return { url, headers, body: JSON.stringify(body) };
  }

  parseResponse(data: any): { content: string; usage?: AiUsage } {
    const content = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage ? this._parseUsage(data.usage) : undefined;
    return { content, usage };
  }

  parseStreamChunk(_event: string | undefined, data: string): AiStreamChunkResult | null {
    if (data === "[DONE]") return { done: true };

    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta?.content || undefined;
      const usage = parsed.usage ? this._parseUsage(parsed.usage) : undefined;
      return { delta, usage, done: false };
    } catch {
      return null;
    }
  }

  protected _parseUsage(usage: any): AiUsage {
    const promptTokens = Number(usage.prompt_tokens) || 0;
    const completionTokens = Number(usage.completion_tokens) || 0;
    const totalTokens = Number(usage.total_tokens) || (promptTokens + completionTokens);
    return { promptTokens, completionTokens, totalTokens };
  }
}
