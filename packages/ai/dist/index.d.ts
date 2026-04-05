interface ITagNames {
    readonly ai: string;
    readonly aiMessage: string;
}
interface IWritableTagNames {
    ai?: string;
    aiMessage?: string;
}
interface IConfig {
    readonly autoTrigger: boolean;
    readonly triggerAttribute: string;
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    autoTrigger?: boolean;
    triggerAttribute?: string;
    tagNames?: IWritableTagNames;
}
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    readonly version: number;
    readonly properties: IWcBindableProperty[];
}
interface AiMessage {
    role: "system" | "user" | "assistant";
    content: string;
}
interface AiUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}
interface AiRequestOptions {
    model: string;
    stream?: boolean;
    temperature?: number;
    maxTokens?: number;
    system?: string;
    apiKey?: string;
    baseUrl?: string;
    apiVersion?: string;
}
interface AiProviderRequest {
    url: string;
    headers: Record<string, string>;
    body: string;
}
interface AiStreamChunkResult {
    delta?: string;
    usage?: AiUsage;
    done: boolean;
}
interface IAiProvider {
    buildRequest(messages: AiMessage[], options: AiRequestOptions): AiProviderRequest;
    parseResponse(data: any): {
        content: string;
        usage?: AiUsage;
    };
    parseStreamChunk(event: string | undefined, data: string): AiStreamChunkResult | null;
}
interface AiHttpError {
    status: number;
    statusText: string;
    body: string;
}
interface WcsAiCoreValues {
    content: string;
    messages: AiMessage[];
    usage: AiUsage | null;
    loading: boolean;
    streaming: boolean;
    error: AiHttpError | Error | null;
}
interface WcsAiValues extends WcsAiCoreValues {
    trigger: boolean;
}

declare function bootstrapAi(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless AI inference core.
 * Manages conversation history, streaming, and rAF-batched content updates.
 */
declare class AiCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _content;
    private _messages;
    private _usage;
    private _loading;
    private _streaming;
    private _error;
    private _provider;
    private _abortController;
    private _flushScheduled;
    private _rafId;
    constructor(target?: EventTarget);
    get content(): string;
    get usage(): AiUsage | null;
    get loading(): boolean;
    get streaming(): boolean;
    get error(): any;
    get messages(): AiMessage[];
    set messages(value: AiMessage[]);
    get provider(): IAiProvider | null;
    set provider(value: IAiProvider | string | null);
    private _setContent;
    private _emitMessages;
    private _setUsage;
    private _setLoading;
    private _setStreaming;
    private _setError;
    private _scheduleFlush;
    private _cancelFlush;
    abort(): void;
    send(prompt: string, options: AiRequestOptions): Promise<string | null>;
    private _doSend;
    private _removeMessage;
    private _processStream;
    private _mergeUsage;
}

declare class OpenAiProvider implements IAiProvider {
    buildRequest(messages: AiMessage[], options: AiRequestOptions): AiProviderRequest;
    parseResponse(data: any): {
        content: string;
        usage?: AiUsage;
    };
    parseStreamChunk(_event: string | undefined, data: string): AiStreamChunkResult | null;
    protected _parseUsage(usage: any): AiUsage;
}

declare class AnthropicProvider implements IAiProvider {
    buildRequest(messages: AiMessage[], options: AiRequestOptions): AiProviderRequest;
    parseResponse(data: any): {
        content: string;
        usage?: AiUsage;
    };
    private _parseUsage;
    parseStreamChunk(event: string | undefined, data: string): AiStreamChunkResult | null;
}

declare class AzureOpenAiProvider extends OpenAiProvider {
    buildRequest(messages: AiMessage[], options: AiRequestOptions): AiProviderRequest;
}

export { AiCore, AnthropicProvider, AzureOpenAiProvider, OpenAiProvider, bootstrapAi, getConfig };
export type { AiHttpError, AiMessage, AiProviderRequest, AiRequestOptions, AiStreamChunkResult, AiUsage, IAiProvider, IWritableConfig, IWritableTagNames, WcsAiCoreValues, WcsAiValues };
