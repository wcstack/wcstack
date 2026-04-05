import { raiseError } from "../raiseError.js";
import {
  IWcBindable, IAiProvider, AiMessage, AiUsage, AiRequestOptions,
} from "../types.js";
import { SseParser } from "../streaming/SseParser.js";
import { OpenAiProvider } from "../providers/OpenAiProvider.js";
import { AnthropicProvider } from "../providers/AnthropicProvider.js";
import { AzureOpenAiProvider } from "../providers/AzureOpenAiProvider.js";

function resolveProvider(name: string): IAiProvider {
  switch (name) {
    case "openai": return new OpenAiProvider();
    case "anthropic": return new AnthropicProvider();
    case "azure-openai": return new AzureOpenAiProvider();
    default: raiseError(`Unknown provider: "${name}". Use "openai", "anthropic", or "azure-openai".`);
  }
}

/**
 * Headless AI inference core.
 * Manages conversation history, streaming, and rAF-batched content updates.
 */
export class AiCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "content", event: "wcs-ai:content-changed" },
      { name: "messages", event: "wcs-ai:messages-changed" },
      { name: "usage", event: "wcs-ai:usage-changed" },
      { name: "loading", event: "wcs-ai:loading-changed" },
      { name: "streaming", event: "wcs-ai:streaming-changed" },
      { name: "error", event: "wcs-ai:error" },
    ],
  };

  private _target: EventTarget;
  private _content: string = "";
  private _messages: AiMessage[] = [];
  private _usage: AiUsage | null = null;
  private _loading: boolean = false;
  private _streaming: boolean = false;
  private _error: any = null;
  private _provider: IAiProvider | null = null;
  private _abortController: AbortController | null = null;
  private _flushScheduled: boolean = false;
  private _rafId: any = 0;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get content(): string { return this._content; }
  get usage(): AiUsage | null { return this._usage; }
  get loading(): boolean { return this._loading; }
  get streaming(): boolean { return this._streaming; }
  get error(): any { return this._error; }

  get messages(): AiMessage[] {
    return this._messages.map(m => ({ ...m }));
  }

  set messages(value: AiMessage[]) {
    this._messages = value.map(m => ({ ...m }));
    this._emitMessages();
  }

  get provider(): IAiProvider | null { return this._provider; }

  set provider(value: IAiProvider | string | null) {
    if (typeof value === "string") {
      this._provider = resolveProvider(value);
    } else {
      this._provider = value;
    }
  }

  // --- State setters (dispatch events) ---

  private _setContent(content: string): void {
    this._content = content;
    this._target.dispatchEvent(new CustomEvent("wcs-ai:content-changed", {
      detail: content,
      bubbles: true,
    }));
  }

  private _emitMessages(): void {
    this._target.dispatchEvent(new CustomEvent("wcs-ai:messages-changed", {
      detail: this.messages,
      bubbles: true,
    }));
  }

  private _setUsage(usage: AiUsage): void {
    this._usage = usage;
    this._target.dispatchEvent(new CustomEvent("wcs-ai:usage-changed", {
      detail: usage,
      bubbles: true,
    }));
  }

  private _setLoading(loading: boolean): void {
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-ai:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setStreaming(streaming: boolean): void {
    this._streaming = streaming;
    this._target.dispatchEvent(new CustomEvent("wcs-ai:streaming-changed", {
      detail: streaming,
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-ai:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // --- rAF batching ---

  private _scheduleFlush(): void {
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    const raf = globalThis.requestAnimationFrame ?? ((cb: FrameRequestCallback) => setTimeout(cb, 16));
    this._rafId = raf(() => {
      this._flushScheduled = false;
      this._rafId = 0;
      this._setContent(this._content);
    });
  }

  private _cancelFlush(): void {
    if (this._rafId) {
      const cancel = globalThis.cancelAnimationFrame ?? clearTimeout;
      cancel(this._rafId);
      this._rafId = 0;
      this._flushScheduled = false;
    }
  }

  // --- Public API ---

  abort(): void {
    if (this._abortController) {
      this._abortController.abort();
      // 参照はクリアしない — _doSend の finally (isCurrent ガード内) で行う
    }
  }

  send(prompt: string, options: AiRequestOptions): Promise<string | null> {
    if (!prompt) raiseError("prompt is required.");
    if (!this._provider) raiseError("provider is required. Set provider before calling send().");
    return this._doSend(prompt, options);
  }

  // --- Internal ---

  private async _doSend(prompt: string, options: AiRequestOptions): Promise<string | null> {
    this.abort();
    const abortController = new AbortController();
    this._abortController = abortController;
    const { signal } = abortController;
    const isCurrent = () => this._abortController === abortController;

    this._setLoading(true);
    this._setError(null);
    this._content = "";
    this._setContent("");

    // ユーザーメッセージを履歴に追加（参照を保持して abort 時に正確に除去）
    const userMessage: AiMessage = { role: "user", content: prompt };
    this._messages.push(userMessage);
    this._emitMessages();

    // API用メッセージ配列を構築 (system + 履歴)
    const apiMessages: AiMessage[] = [];
    if (options.system) {
      apiMessages.push({ role: "system", content: options.system });
    }
    apiMessages.push(...this._messages);

    const request = this._provider!.buildRequest(apiMessages, options);

    try {
      const response = await globalThis.fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        this._removeMessage(userMessage);
        if (isCurrent()) {
          this._setError({ status: response.status, statusText: response.statusText, body: errorBody });
          this._setLoading(false);
        }
        return null;
      }

      const shouldStream = (options.stream !== false) && response.body;
      if (shouldStream) {
        return await this._processStream(response.body!, abortController);
      } else {
        const data = await response.json();
        const result = this._provider!.parseResponse(data);
        if (!isCurrent()) {
          this._removeMessage(userMessage);
          return null;
        }
        this._content = result.content;
        this._setContent(this._content);
        if (result.usage) this._setUsage(result.usage);
        this._messages.push({ role: "assistant", content: this._content });
        this._emitMessages();
        this._setLoading(false);
        return this._content;
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        this._removeMessage(userMessage);
        if (isCurrent()) {
          this._setStreaming(false);
          this._setLoading(false);
        }
        return null;
      }
      this._removeMessage(userMessage);
      if (isCurrent()) {
        this._setError(e);
        this._setStreaming(false);
        this._setLoading(false);
      }
      return null;
    } finally {
      if (isCurrent()) {
        this._abortController = null;
        this._cancelFlush();
      }
    }
  }

  private _removeMessage(message: AiMessage): void {
    const idx = this._messages.indexOf(message);
    if (idx === -1) return;
    this._messages.splice(idx, 1);
    this._emitMessages();
  }

  private async _processStream(body: ReadableStream<Uint8Array>, abortController: AbortController): Promise<string | null> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let lastUsage: AiUsage | undefined;
    const isCurrent = () => this._abortController === abortController;

    this._setStreaming(true);

    try {
      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const events = parser.feed(text);

        for (const sseEvent of events) {
          const result = this._provider!.parseStreamChunk(sseEvent.event, sseEvent.data);
          if (!result) continue;

          if (result.delta) {
            this._content += result.delta;
            if (isCurrent()) this._scheduleFlush();
          }

          if (result.usage) {
            lastUsage = this._mergeUsage(lastUsage, result.usage);
          }

          if (result.done) {
            streamDone = true;
            break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 後続の send() に置き換えられた場合は共有状態に触れない
    if (!isCurrent()) return this._content;

    // 最終コンテンツを同期的にフラッシュ
    this._cancelFlush();
    this._setContent(this._content);

    if (lastUsage) this._setUsage(lastUsage);
    this._messages.push({ role: "assistant", content: this._content });
    this._emitMessages();
    this._setStreaming(false);
    this._setLoading(false);

    return this._content;
  }

  private _mergeUsage(existing: AiUsage | undefined, incoming: AiUsage): AiUsage {
    const merged = {
      promptTokens: incoming.promptTokens || existing?.promptTokens || 0,
      completionTokens: incoming.completionTokens || existing?.completionTokens || 0,
      totalTokens: 0,
    };
    merged.totalTokens = merged.promptTokens + merged.completionTokens;
    return merged;
  }
}
