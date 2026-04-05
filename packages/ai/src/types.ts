export interface ITagNames {
  readonly ai: string;
  readonly aiMessage: string;
}

export interface IWritableTagNames {
  ai?: string;
  aiMessage?: string;
}

export interface IConfig {
  readonly autoTrigger: boolean;
  readonly triggerAttribute: string;
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  autoTrigger?: boolean;
  triggerAttribute?: string;
  tagNames?: IWritableTagNames;
}

export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
}

export interface IWcBindable {
  readonly protocol: "wc-bindable";
  readonly version: number;
  readonly properties: IWcBindableProperty[];
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiRequestOptions {
  model: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  system?: string;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
}

export interface AiProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface AiStreamChunkResult {
  delta?: string;
  usage?: AiUsage;
  done: boolean;
}

export interface IAiProvider {
  buildRequest(messages: AiMessage[], options: AiRequestOptions): AiProviderRequest;
  parseResponse(data: any): { content: string; usage?: AiUsage };
  parseStreamChunk(event: string | undefined, data: string): AiStreamChunkResult | null;
}

export interface AiHttpError {
  status: number;
  statusText: string;
  body: string;
}

export interface WcsAiCoreValues {
  content: string;
  messages: AiMessage[];
  usage: AiUsage | null;
  loading: boolean;
  streaming: boolean;
  error: AiHttpError | Error | null;
}

export interface WcsAiValues extends WcsAiCoreValues {
  trigger: boolean;
}
