import { describe, it, expect } from "vitest";
import { OpenAiProvider } from "../src/providers/OpenAiProvider";
import { AnthropicProvider } from "../src/providers/AnthropicProvider";
import { AzureOpenAiProvider } from "../src/providers/AzureOpenAiProvider";

describe("OpenAiProvider", () => {
  const provider = new OpenAiProvider();

  describe("buildRequest", () => {
    it("正しいURLとヘッダーでリクエストを構築する", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hello" }],
        { model: "gpt-4o", apiKey: "sk-test" }
      );
      expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
      expect(req.headers["Authorization"]).toBe("Bearer sk-test");
      expect(req.headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(req.body);
      expect(body.model).toBe("gpt-4o");
      expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
      expect(body.stream).toBe(true);
    });

    it("カスタムbaseUrlを使用できる", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "llama3", baseUrl: "http://localhost:11434" }
      );
      expect(req.url).toBe("http://localhost:11434/v1/chat/completions");
    });

    it("apiKey未設定時はAuthorizationヘッダーを含まない", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4o" }
      );
      expect(req.headers["Authorization"]).toBeUndefined();
    });

    it("temperatureとmaxTokensを設定できる", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4o", temperature: 0.5, maxTokens: 1000 }
      );
      const body = JSON.parse(req.body);
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(1000);
    });

    it("temperatureとmaxTokens未設定時はbodyに含まない", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4o" }
      );
      const body = JSON.parse(req.body);
      expect(body.temperature).toBeUndefined();
      expect(body.max_tokens).toBeUndefined();
    });

    it("stream=falseの場合stream_optionsを含まない", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4o", stream: false }
      );
      const body = JSON.parse(req.body);
      expect(body.stream).toBe(false);
      expect(body.stream_options).toBeUndefined();
    });
  });

  describe("parseResponse", () => {
    it("レスポンスからcontentとusageを抽出する", () => {
      const result = provider.parseResponse({
        choices: [{ message: { content: "Hello!" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      expect(result.content).toBe("Hello!");
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    });

    it("usageがない場合はundefinedを返す", () => {
      const result = provider.parseResponse({
        choices: [{ message: { content: "Hi" } }],
      });
      expect(result.content).toBe("Hi");
      expect(result.usage).toBeUndefined();
    });

    it("空のレスポンスを処理できる", () => {
      const result = provider.parseResponse({});
      expect(result.content).toBe("");
    });

    it("usageの値が0の場合も正しく処理する", () => {
      const result = provider.parseResponse({
        choices: [{ message: { content: "Hi" } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
      expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    });
  });

  describe("parseStreamChunk", () => {
    it("[DONE]でdone=trueを返す", () => {
      const result = provider.parseStreamChunk(undefined, "[DONE]");
      expect(result).toEqual({ done: true });
    });

    it("deltaのcontentを抽出する", () => {
      const result = provider.parseStreamChunk(undefined,
        '{"choices":[{"delta":{"content":"Hello"}}]}'
      );
      expect(result).toEqual({ delta: "Hello", usage: undefined, done: false });
    });

    it("usageチャンクを処理する", () => {
      const result = provider.parseStreamChunk(undefined,
        '{"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}'
      );
      expect(result?.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    });

    it("usageチャンクの値が0の場合も処理する", () => {
      const result = provider.parseStreamChunk(undefined,
        '{"choices":[{"delta":{}}],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}'
      );
      expect(result?.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    });

    it("不正なJSONでnullを返す", () => {
      const result = provider.parseStreamChunk(undefined, "invalid json");
      expect(result).toBeNull();
    });

    it("deltaなし・usageなしの場合", () => {
      const result = provider.parseStreamChunk(undefined,
        '{"choices":[{"delta":{}}]}'
      );
      expect(result).toEqual({ delta: undefined, usage: undefined, done: false });
    });
  });
});

describe("AnthropicProvider", () => {
  const provider = new AnthropicProvider();

  describe("buildRequest", () => {
    it("systemメッセージを分離してトップレベルに配置する", () => {
      const req = provider.buildRequest(
        [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hello" },
        ],
        { model: "claude-sonnet-4-20250514", apiKey: "sk-ant-test" }
      );
      expect(req.url).toBe("https://api.anthropic.com/v1/messages");
      expect(req.headers["x-api-key"]).toBe("sk-ant-test");
      expect(req.headers["anthropic-version"]).toBe("2023-06-01");
      const body = JSON.parse(req.body);
      expect(body.system).toBe("You are helpful");
      expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
      expect(body.max_tokens).toBe(4096);
    });

    it("複数のsystemメッセージを結合する", () => {
      const req = provider.buildRequest(
        [
          { role: "system", content: "First" },
          { role: "system", content: "Second" },
          { role: "user", content: "Hi" },
        ],
        { model: "claude-sonnet-4-20250514" }
      );
      const body = JSON.parse(req.body);
      expect(body.system).toBe("First\n\nSecond");
    });

    it("systemメッセージがない場合はsystemフィールドを含まない", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514" }
      );
      const body = JSON.parse(req.body);
      expect(body.system).toBeUndefined();
    });

    it("maxTokensを指定できる", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514", maxTokens: 1000 }
      );
      const body = JSON.parse(req.body);
      expect(body.max_tokens).toBe(1000);
    });

    it("apiKey未設定時はx-api-keyヘッダーを含まない", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514" }
      );
      expect(req.headers["x-api-key"]).toBeUndefined();
    });

    it("stream=false、temperature指定", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514", stream: false, temperature: 0.5 }
      );
      const body = JSON.parse(req.body);
      expect(body.stream).toBe(false);
      expect(body.temperature).toBe(0.5);
    });

    it("temperature未設定時はbodyに含まない", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514" }
      );
      const body = JSON.parse(req.body);
      expect(body.temperature).toBeUndefined();
    });

    it("カスタムbaseUrlを使用できる", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514", baseUrl: "http://localhost:8080" }
      );
      expect(req.url).toBe("http://localhost:8080/v1/messages");
    });
  });

  describe("parseResponse", () => {
    it("Anthropicのレスポンス形式を処理する", () => {
      const result = provider.parseResponse({
        content: [{ type: "text", text: "Hello!" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      expect(result.content).toBe("Hello!");
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    });

    it("usageがない場合はundefinedを返す", () => {
      const result = provider.parseResponse({
        content: [{ type: "text", text: "Hi" }],
      });
      expect(result.usage).toBeUndefined();
    });

    it("空のレスポンスを処理できる", () => {
      const result = provider.parseResponse({});
      expect(result.content).toBe("");
    });

    it("usageの値が0の場合も正しく処理する", () => {
      const result = provider.parseResponse({
        content: [{ type: "text", text: "Hi" }],
        usage: { input_tokens: 0, output_tokens: 0 },
      });
      expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    });
  });

  describe("parseStreamChunk", () => {
    it("message_stopでdone=trueを返す", () => {
      const result = provider.parseStreamChunk("message_stop", '{"type":"message_stop"}');
      expect(result).toEqual({ done: true });
    });

    it("content_block_deltaからテキスト差分を抽出する", () => {
      const result = provider.parseStreamChunk("content_block_delta",
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}'
      );
      expect(result).toEqual({ delta: "Hello", done: false });
    });

    it("message_startからusageを抽出する", () => {
      const result = provider.parseStreamChunk("message_start",
        '{"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}'
      );
      expect(result?.usage).toEqual({ promptTokens: 25, completionTokens: 1, totalTokens: 26 });
    });

    it("message_startのusage値が0の場合も処理する", () => {
      const result = provider.parseStreamChunk("message_start",
        '{"type":"message_start","message":{"usage":{"input_tokens":0,"output_tokens":0}}}'
      );
      expect(result?.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    });

    it("message_startにusageがない場合はnullを返す", () => {
      const result = provider.parseStreamChunk("message_start",
        '{"type":"message_start","message":{}}'
      );
      expect(result).toBeNull();
    });

    it("message_deltaからoutput usageを抽出する", () => {
      const result = provider.parseStreamChunk("message_delta",
        '{"type":"message_delta","usage":{"output_tokens":15}}'
      );
      expect(result?.usage).toEqual({ promptTokens: 0, completionTokens: 15, totalTokens: 0 });
    });

    it("message_deltaのoutput_tokensが0の場合も処理する", () => {
      const result = provider.parseStreamChunk("message_delta",
        '{"type":"message_delta","usage":{"output_tokens":0}}'
      );
      expect(result?.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    });

    it("message_deltaにusageがない場合はnullを返す", () => {
      const result = provider.parseStreamChunk("message_delta",
        '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}'
      );
      expect(result).toBeNull();
    });

    it("未知のイベントタイプでnullを返す", () => {
      const result = provider.parseStreamChunk("ping",
        '{"type":"ping"}'
      );
      expect(result).toBeNull();
    });

    it("不正なJSONでnullを返す", () => {
      const result = provider.parseStreamChunk(undefined, "invalid");
      expect(result).toBeNull();
    });
  });
});

describe("AzureOpenAiProvider", () => {
  const provider = new AzureOpenAiProvider();

  describe("buildRequest", () => {
    it("AzureのURL形式でリクエストを構築する", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hello" }],
        { model: "gpt-4o", baseUrl: "https://myresource.openai.azure.com", apiKey: "azure-key" }
      );
      expect(req.url).toBe("https://myresource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01");
      expect(req.headers["api-key"]).toBe("azure-key");
      expect(req.headers["Authorization"]).toBeUndefined();
      const body = JSON.parse(req.body);
      expect(body.model).toBeUndefined();
    });

    it("カスタムapiVersionを使用できる", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4o", baseUrl: "https://myresource.openai.azure.com", apiVersion: "2024-06-01" }
      );
      expect(req.url).toContain("api-version=2024-06-01");
    });

    it("baseUrl未設定時にエラーをスローする", () => {
      expect(() => provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4o" }
      )).toThrow("[@wcstack/ai] base-url is required for Azure OpenAI.");
    });

    it("apiKey未設定時はapi-keyヘッダーを含まない", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4o", baseUrl: "https://test.openai.azure.com" }
      );
      expect(req.headers["api-key"]).toBeUndefined();
    });

    it("temperatureとmaxTokensを設定できる", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4o", baseUrl: "https://test.openai.azure.com", temperature: 0.5, maxTokens: 500 }
      );
      const body = JSON.parse(req.body);
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(500);
    });

    it("stream=falseの場合stream_optionsを含まない", () => {
      const req = provider.buildRequest(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4o", baseUrl: "https://test.openai.azure.com", stream: false }
      );
      const body = JSON.parse(req.body);
      expect(body.stream).toBe(false);
      expect(body.stream_options).toBeUndefined();
    });
  });

  describe("parseResponse", () => {
    it("OpenAIと同じレスポンス形式を処理する", () => {
      const result = provider.parseResponse({
        choices: [{ message: { content: "Hello!" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      expect(result.content).toBe("Hello!");
    });
  });

  describe("parseStreamChunk", () => {
    it("OpenAIと同じストリーム形式を処理する", () => {
      const result = provider.parseStreamChunk(undefined, "[DONE]");
      expect(result).toEqual({ done: true });
    });
  });
});
