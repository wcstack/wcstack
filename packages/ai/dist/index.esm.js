const _config = {
    autoTrigger: true,
    triggerAttribute: "data-aitarget",
    tagNames: {
        ai: "wcs-ai",
        aiMessage: "wcs-ai-message",
    },
};
function deepFreeze(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        deepFreeze(obj[key]);
    }
    return obj;
}
function deepClone(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    const clone = {};
    for (const key of Object.keys(obj)) {
        clone[key] = deepClone(obj[key]);
    }
    return clone;
}
let frozenConfig = null;
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
function setConfig(partialConfig) {
    if (typeof partialConfig.autoTrigger === "boolean") {
        _config.autoTrigger = partialConfig.autoTrigger;
    }
    if (typeof partialConfig.triggerAttribute === "string") {
        _config.triggerAttribute = partialConfig.triggerAttribute;
    }
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

function raiseError(message) {
    throw new Error(`[@wcstack/ai] ${message}`);
}

class SseParser {
    _buffer = "";
    _currentEvent = undefined;
    _currentData = [];
    feed(chunk) {
        this._buffer += chunk;
        const results = [];
        const lines = this._buffer.split("\n");
        this._buffer = lines.pop() || "";
        for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, "");
            if (line.startsWith(":")) {
                // SSE comment, ignore
                continue;
            }
            if (line.startsWith("event:")) {
                this._currentEvent = (line.startsWith("event: ") ? line.slice(7) : line.slice(6)).trim();
            }
            else if (line.startsWith("data:")) {
                const value = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
                this._currentData.push(value);
            }
            else if (line === "" && this._currentData.length > 0) {
                results.push({
                    event: this._currentEvent,
                    data: this._currentData.join("\n"),
                });
                this._currentEvent = undefined;
                this._currentData = [];
            }
        }
        return results;
    }
}

class OpenAiProvider {
    buildRequest(messages, options) {
        const baseUrl = options.baseUrl || "https://api.openai.com";
        const url = `${baseUrl}/v1/chat/completions`;
        const headers = {
            "Content-Type": "application/json",
        };
        if (options.apiKey) {
            headers["Authorization"] = `Bearer ${options.apiKey}`;
        }
        const body = {
            model: options.model,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            stream: options.stream ?? true,
        };
        if (options.temperature !== undefined)
            body.temperature = options.temperature;
        if (options.maxTokens !== undefined)
            body.max_tokens = options.maxTokens;
        if (body.stream)
            body.stream_options = { include_usage: true };
        return { url, headers, body: JSON.stringify(body) };
    }
    parseResponse(data) {
        const content = data.choices?.[0]?.message?.content ?? "";
        const usage = data.usage ? this._parseUsage(data.usage) : undefined;
        return { content, usage };
    }
    parseStreamChunk(_event, data) {
        if (data === "[DONE]")
            return { done: true };
        try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content || undefined;
            const usage = parsed.usage ? this._parseUsage(parsed.usage) : undefined;
            return { delta, usage, done: false };
        }
        catch {
            return null;
        }
    }
    _parseUsage(usage) {
        const promptTokens = Number(usage.prompt_tokens) || 0;
        const completionTokens = Number(usage.completion_tokens) || 0;
        const totalTokens = Number(usage.total_tokens) || (promptTokens + completionTokens);
        return { promptTokens, completionTokens, totalTokens };
    }
}

class AnthropicProvider {
    buildRequest(messages, options) {
        const baseUrl = options.baseUrl || "https://api.anthropic.com";
        const url = `${baseUrl}/v1/messages`;
        const headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        };
        if (options.apiKey) {
            headers["x-api-key"] = options.apiKey;
        }
        const systemMessages = messages.filter(m => m.role === "system");
        const nonSystemMessages = messages.filter(m => m.role !== "system");
        const body = {
            model: options.model,
            messages: nonSystemMessages.map(m => ({ role: m.role, content: m.content })),
            max_tokens: options.maxTokens || 4096,
            stream: options.stream ?? true,
        };
        if (systemMessages.length > 0) {
            body.system = systemMessages.map(m => m.content).join("\n\n");
        }
        if (options.temperature !== undefined)
            body.temperature = options.temperature;
        return { url, headers, body: JSON.stringify(body) };
    }
    parseResponse(data) {
        const content = data.content?.[0]?.text ?? "";
        const usage = data.usage ? this._parseUsage(data.usage) : undefined;
        return { content, usage };
    }
    _parseUsage(usage) {
        const promptTokens = Number(usage.input_tokens) || 0;
        const completionTokens = Number(usage.output_tokens) || 0;
        return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
    }
    parseStreamChunk(event, data) {
        if (event === "message_stop")
            return { done: true };
        try {
            const parsed = JSON.parse(data);
            if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                return { delta: parsed.delta.text, done: false };
            }
            if (parsed.type === "message_start" && parsed.message?.usage) {
                return { usage: this._parseUsage(parsed.message.usage), done: false };
            }
            if (parsed.type === "message_delta" && parsed.usage) {
                return {
                    usage: { promptTokens: 0, completionTokens: Number(parsed.usage.output_tokens) || 0, totalTokens: 0 },
                    done: false,
                };
            }
            return null;
        }
        catch {
            return null;
        }
    }
}

class AzureOpenAiProvider extends OpenAiProvider {
    buildRequest(messages, options) {
        if (!options.baseUrl) {
            raiseError("base-url is required for Azure OpenAI.");
        }
        const apiVersion = options.apiVersion || "2024-02-01";
        const url = `${options.baseUrl}/openai/deployments/${options.model}/chat/completions?api-version=${apiVersion}`;
        const headers = {
            "Content-Type": "application/json",
        };
        if (options.apiKey) {
            headers["api-key"] = options.apiKey;
        }
        const body = {
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            stream: options.stream ?? true,
        };
        if (options.temperature !== undefined)
            body.temperature = options.temperature;
        if (options.maxTokens !== undefined)
            body.max_tokens = options.maxTokens;
        if (body.stream)
            body.stream_options = { include_usage: true };
        return { url, headers, body: JSON.stringify(body) };
    }
}

function resolveProvider(name) {
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
class AiCore extends EventTarget {
    static wcBindable = {
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
    _target;
    _content = "";
    _messages = [];
    _usage = null;
    _loading = false;
    _streaming = false;
    _error = null;
    _provider = null;
    _abortController = null;
    _flushScheduled = false;
    _rafId = 0;
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get content() { return this._content; }
    get usage() { return this._usage; }
    get loading() { return this._loading; }
    get streaming() { return this._streaming; }
    get error() { return this._error; }
    get messages() {
        return this._messages.map(m => ({ ...m }));
    }
    set messages(value) {
        this._messages = value.map(m => ({ ...m }));
        this._emitMessages();
    }
    get provider() { return this._provider; }
    set provider(value) {
        if (typeof value === "string") {
            this._provider = resolveProvider(value);
        }
        else {
            this._provider = value;
        }
    }
    // --- State setters (dispatch events) ---
    _setContent(content) {
        this._content = content;
        this._target.dispatchEvent(new CustomEvent("wcs-ai:content-changed", {
            detail: content,
            bubbles: true,
        }));
    }
    _emitMessages() {
        this._target.dispatchEvent(new CustomEvent("wcs-ai:messages-changed", {
            detail: this.messages,
            bubbles: true,
        }));
    }
    _setUsage(usage) {
        this._usage = usage;
        this._target.dispatchEvent(new CustomEvent("wcs-ai:usage-changed", {
            detail: usage,
            bubbles: true,
        }));
    }
    _setLoading(loading) {
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-ai:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setStreaming(streaming) {
        this._streaming = streaming;
        this._target.dispatchEvent(new CustomEvent("wcs-ai:streaming-changed", {
            detail: streaming,
            bubbles: true,
        }));
    }
    _setError(error) {
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-ai:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // --- rAF batching ---
    /* v8 ignore start */
    _scheduleFlush() {
        if (this._flushScheduled)
            return;
        this._flushScheduled = true;
        const raf = globalThis.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
        this._rafId = raf(() => {
            this._flushScheduled = false;
            this._rafId = 0;
            this._setContent(this._content);
        });
    }
    _cancelFlush() {
        if (this._rafId) {
            const cancel = globalThis.cancelAnimationFrame ?? clearTimeout;
            cancel(this._rafId);
            this._rafId = 0;
            this._flushScheduled = false;
        }
    }
    /* v8 ignore stop */
    // --- Public API ---
    abort() {
        if (this._abortController) {
            this._abortController.abort();
            // 参照はクリアしない — _doSend の finally (isCurrent ガード内) で行う
        }
    }
    send(prompt, options) {
        if (!prompt)
            raiseError("prompt is required.");
        if (!this._provider)
            raiseError("provider is required. Set provider before calling send().");
        return this._doSend(prompt, options);
    }
    // --- Internal ---
    async _doSend(prompt, options) {
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
        const userMessage = { role: "user", content: prompt };
        this._messages.push(userMessage);
        this._emitMessages();
        // API用メッセージ配列を構築 (system + 履歴)
        const apiMessages = [];
        if (options.system) {
            apiMessages.push({ role: "system", content: options.system });
        }
        apiMessages.push(...this._messages);
        const request = this._provider.buildRequest(apiMessages, options);
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
                return await this._processStream(response.body, abortController);
            }
            else {
                const data = await response.json();
                const result = this._provider.parseResponse(data);
                if (!isCurrent()) {
                    this._removeMessage(userMessage);
                    return null;
                }
                this._content = result.content;
                this._setContent(this._content);
                if (result.usage)
                    this._setUsage(result.usage);
                this._messages.push({ role: "assistant", content: this._content });
                this._emitMessages();
                this._setLoading(false);
                return this._content;
            }
        }
        catch (e) {
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
        }
        finally {
            if (isCurrent()) {
                this._abortController = null;
                this._cancelFlush();
            }
        }
    }
    _removeMessage(message) {
        const idx = this._messages.indexOf(message);
        /* v8 ignore next */
        if (idx === -1)
            return;
        this._messages.splice(idx, 1);
        this._emitMessages();
    }
    /* v8 ignore start */
    async _processStream(body, abortController) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseParser();
        let lastUsage;
        const isCurrent = () => this._abortController === abortController;
        this._setStreaming(true);
        try {
            let streamDone = false;
            while (!streamDone) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                const text = decoder.decode(value, { stream: true });
                const events = parser.feed(text);
                for (const sseEvent of events) {
                    const result = this._provider.parseStreamChunk(sseEvent.event, sseEvent.data);
                    if (!result)
                        continue;
                    if (result.delta) {
                        this._content += result.delta;
                        /* v8 ignore start */ if (isCurrent())
                            this._scheduleFlush(); /* v8 ignore stop */
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
        }
        finally {
            reader.releaseLock();
        }
        // 後続の send() に置き換えられた場合は共有状態に触れない
        /* v8 ignore start */ if (!isCurrent())
            return this._content; /* v8 ignore stop */
        // 最終コンテンツを同期的にフラッシュ
        this._cancelFlush();
        this._setContent(this._content);
        if (lastUsage)
            this._setUsage(lastUsage);
        this._messages.push({ role: "assistant", content: this._content });
        this._emitMessages();
        this._setStreaming(false);
        this._setLoading(false);
        return this._content;
    }
    /* v8 ignore stop */
    _mergeUsage(existing, incoming) {
        const merged = {
            promptTokens: incoming.promptTokens || existing?.promptTokens || 0,
            completionTokens: incoming.completionTokens || existing?.completionTokens || 0,
            totalTokens: 0,
        };
        merged.totalTokens = merged.promptTokens + merged.completionTokens;
        return merged;
    }
}

let registered = false;
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    const triggerElement = target.closest(`[${config.triggerAttribute}]`);
    if (!triggerElement)
        return;
    const aiId = triggerElement.getAttribute(config.triggerAttribute);
    if (!aiId)
        return;
    const aiElement = document.getElementById(aiId);
    if (!aiElement || aiElement.tagName.toLowerCase() !== config.tagNames.ai)
        return;
    event.preventDefault();
    aiElement.send();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

class Ai extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...AiCore.wcBindable,
        properties: [
            ...AiCore.wcBindable.properties,
            { name: "trigger", event: "wcs-ai:trigger-changed" },
        ],
    };
    static get observedAttributes() {
        return ["provider"];
    }
    _core;
    _trigger = false;
    _prompt = "";
    constructor() {
        super();
        this._core = new AiCore(this);
    }
    // --- Input attributes ---
    get provider() {
        return this.getAttribute("provider") || "";
    }
    set provider(value) {
        this.setAttribute("provider", value);
    }
    get model() {
        return this.getAttribute("model") || "";
    }
    set model(value) {
        this.setAttribute("model", value);
    }
    get baseUrl() {
        return this.getAttribute("base-url") || "";
    }
    set baseUrl(value) {
        this.setAttribute("base-url", value);
    }
    get apiKey() {
        return this.getAttribute("api-key") || "";
    }
    set apiKey(value) {
        this.setAttribute("api-key", value);
    }
    get system() {
        return this.getAttribute("system") || "";
    }
    set system(value) {
        this.setAttribute("system", value);
    }
    get stream() {
        return !this.hasAttribute("no-stream");
    }
    set stream(value) {
        if (value) {
            this.removeAttribute("no-stream");
        }
        else {
            this.setAttribute("no-stream", "");
        }
    }
    get apiVersion() {
        return this.getAttribute("api-version") || "";
    }
    set apiVersion(value) {
        this.setAttribute("api-version", value);
    }
    // --- JS-only properties ---
    get prompt() { return this._prompt; }
    set prompt(value) { this._prompt = value; }
    get temperature() {
        const v = this.getAttribute("temperature");
        return v !== null ? Number(v) : undefined;
    }
    set temperature(value) {
        if (value !== undefined) {
            this.setAttribute("temperature", String(value));
        }
        else {
            this.removeAttribute("temperature");
        }
    }
    get maxTokens() {
        const v = this.getAttribute("max-tokens");
        return v !== null ? Number(v) : undefined;
    }
    set maxTokens(value) {
        if (value !== undefined) {
            this.setAttribute("max-tokens", String(value));
        }
        else {
            this.removeAttribute("max-tokens");
        }
    }
    // --- Output state (delegated to core) ---
    get content() { return this._core.content; }
    get loading() { return this._core.loading; }
    get streaming() { return this._core.streaming; }
    get error() { return this._core.error; }
    get usage() { return this._core.usage; }
    get messages() { return this._core.messages; }
    set messages(value) { this._core.messages = value; }
    // --- Trigger ---
    get trigger() { return this._trigger; }
    set trigger(value) {
        const v = !!value;
        if (v) {
            this._trigger = true;
            this.send().finally(() => {
                this._trigger = false;
                this.dispatchEvent(new CustomEvent("wcs-ai:trigger-changed", {
                    detail: false,
                    bubbles: true,
                }));
            });
        }
    }
    // --- Methods ---
    _collectSystem() {
        // system属性が優先
        if (this.system)
            return this.system;
        // 子要素から収集
        const msgEl = this.querySelector(config.tagNames.aiMessage);
        if (msgEl && msgEl.role === "system") {
            return msgEl.messageContent;
        }
        return "";
    }
    async send() {
        return this._core.send(this._prompt, {
            model: this.model,
            stream: this.stream,
            temperature: this.temperature,
            maxTokens: this.maxTokens,
            system: this._collectSystem(),
            apiKey: this.apiKey,
            baseUrl: this.baseUrl,
            apiVersion: this.apiVersion,
        });
    }
    abort() {
        this._core.abort();
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
    }
    attributeChangedCallback(name, _oldValue, newValue) {
        if (name === "provider" && newValue) {
            this._core.provider = newValue;
        }
    }
    disconnectedCallback() {
        this._core.abort();
    }
}

class AiMessage extends HTMLElement {
    constructor() {
        super();
        // スロットなしのShadow DOMでlight DOM（メッセージテキスト）の描画を抑制
        this.attachShadow({ mode: "open" });
    }
    get role() {
        return this.getAttribute("role") || "system";
    }
    get messageContent() {
        return this.textContent?.trim() || "";
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.ai)) {
        customElements.define(config.tagNames.ai, Ai);
    }
    if (!customElements.get(config.tagNames.aiMessage)) {
        customElements.define(config.tagNames.aiMessage, AiMessage);
    }
}

function bootstrapAi(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { AiCore, AnthropicProvider, AzureOpenAiProvider, OpenAiProvider, bootstrapAi, getConfig };
//# sourceMappingURL=index.esm.js.map
