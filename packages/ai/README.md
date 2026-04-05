# @wcstack/ai

`@wcstack/ai` is a headless AI inference component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **I/O node** that connects LLM inference to reactive state — with first-class streaming support.

With `@wcstack/state`, `<wcs-ai>` can be bound directly through path contracts:

- **input / command surface**: `prompt`, `trigger`, `model`, `provider`
- **output state surface**: `content`, `messages`, `usage`, `loading`, `streaming`, `error`

This means chat UIs and AI-powered features can be expressed declaratively in HTML, without writing fetch calls, SSE parsing, token management, or streaming glue code in your UI layer.

`@wcstack/ai` follows the [HAWC](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/docs/articles/HAWC.md) architecture:

- **Core** (`AiCore`) handles provider abstraction, streaming, and conversation state
- **Shell** (`<wcs-ai>`) connects that state to the DOM
- frameworks and binding systems consume it through [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol)

**Zero runtime dependencies.** All providers are implemented with `fetch` + `ReadableStream` + SSE parsing — no SDK required.

## Why this exists

Building a chat UI requires significant plumbing:
HTTP requests to provider APIs, SSE stream parsing, content accumulation, token tracking, conversation history management, and abort handling.

`@wcstack/ai` moves all of that into a reusable component and exposes the result as bindable state.

With `@wcstack/state`, the flow becomes:

1. user writes `prompt`
2. `trigger` fires
3. `<wcs-ai>` streams the response — `content` updates on every chunk
4. UI binds to `content` with `data-wcs` — DOM updates automatically at ~60fps
5. on completion, `messages` includes the full exchange

This turns LLM inference into **state transitions**, not imperative UI code.

## Install

```bash
npm install @wcstack/ai
```

No peer dependencies required.

## Supported Providers

| Provider | `provider` value | Default base URL |
|----------|-----------------|------------------|
| OpenAI | `"openai"` | `https://api.openai.com` |
| Anthropic | `"anthropic"` | `https://api.anthropic.com` |
| Azure OpenAI | `"azure-openai"` | (required via `base-url`) |

OpenAI-compatible APIs (Ollama, vLLM, LiteLLM, etc.) work with `provider="openai"` and a custom `base-url`.

## Quick Start

### 1. Streaming chat with state binding

When `trigger` fires, `<wcs-ai>` sends the prompt and streams the response. `content` updates on every chunk, and `@wcstack/state` binds it to the DOM automatically.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/ai/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      userInput: "",
      assistantText: "",
      chatHistory: [],
      isLoading: false,
      sendTrigger: false,

      send() {
        this.sendTrigger = true;
      },
    };
  </script>

  <wcs-ai
    id="chat"
    provider="openai"
    model="gpt-4o"
    base-url="/api/ai"
    data-wcs="
      prompt: userInput;
      trigger: sendTrigger;
      content: assistantText;
      messages: chatHistory;
      loading: isLoading
    ">
    <wcs-ai-message role="system">You are a helpful assistant.</wcs-ai-message>
  </wcs-ai>

  <div class="chat">
    <template data-wcs="for: chatHistory">
      <div data-wcs="class: chatHistory.*.role; textContent: chatHistory.*.content"></div>
    </template>
    <template data-wcs="if: isLoading">
      <div class="assistant" data-wcs="textContent: assistantText"></div>
    </template>
  </div>

  <input data-wcs="value: userInput" placeholder="Type a message...">
  <button data-wcs="onclick: send">Send</button>
</wcs-state>
```

During streaming, `assistantText` updates on every chunk (~60fps via rAF batching), and the binding system reflects it to the DOM in real-time.

### 2. Non-streaming request

Add `no-stream` to disable streaming and receive the complete response at once:

```html
<wcs-ai
  provider="openai"
  model="gpt-4o"
  base-url="/api/ai"
  no-stream
  data-wcs="prompt: userInput; trigger: sendTrigger; content: result">
</wcs-ai>
```

### 3. Anthropic provider

```html
<wcs-ai
  provider="anthropic"
  model="claude-sonnet-4-20250514"
  base-url="/api/anthropic"
  max-tokens="4096"
  data-wcs="prompt: userInput; trigger: sendTrigger; content: assistantText">
  <wcs-ai-message role="system">You are a concise coding assistant.</wcs-ai-message>
</wcs-ai>
```

Anthropic's system message format is handled automatically — the provider extracts system messages and places them in the top-level `system` field.

### 4. Azure OpenAI

```html
<wcs-ai
  provider="azure-openai"
  model="gpt-4o"
  base-url="https://myresource.openai.azure.com"
  api-key="your-azure-key"
  api-version="2024-02-01"
  data-wcs="prompt: userInput; trigger: sendTrigger; content: assistantText">
</wcs-ai>
```

The URL is constructed as `{base-url}/openai/deployments/{model}/chat/completions?api-version={api-version}`.

### 5. Local model via Ollama

```html
<wcs-ai
  provider="openai"
  model="llama3"
  base-url="http://localhost:11434"
  data-wcs="prompt: userInput; trigger: sendTrigger; content: assistantText">
</wcs-ai>
```

Any OpenAI-compatible API works by setting `base-url`.

### 6. Authenticated requests via backend proxy

`<wcs-ai>` sends requests to `base-url` using the browser's standard `fetch`. If your backend proxy uses cookie/session-based authentication, the browser includes credentials automatically:

```html
<wcs-ai
  provider="openai"
  model="gpt-4o"
  base-url="/api/ai"
  data-wcs="prompt: userInput; trigger: sendTrigger; content: assistantText">
</wcs-ai>
```

The backend proxy at `/api/ai` validates the user's session and forwards the request to the AI provider with the server-side API key. This is the recommended production pattern — no API key in the browser, no custom auth header injection needed.

## State Surface vs Command Surface

`<wcs-ai>` exposes two different kinds of properties.

### Output state (bindable async state)

These properties represent the current inference state and are the main HAWC surface:

| Property | Type | Description |
|----------|------|-------------|
| `content` | `string` | Current response text. **Updates on every streaming chunk** (~60fps via rAF batching) |
| `messages` | `AiMessage[]` | Full conversation history (user + assistant). Updated on send and completion |
| `usage` | `AiUsage \| null` | Token usage `{ promptTokens, completionTokens, totalTokens }` |
| `loading` | `boolean` | `true` from send to completion or error |
| `streaming` | `boolean` | `true` from first chunk to stream completion |
| `error` | `AiHttpError \| Error \| null` | Error info |

### Input / command surface

These properties control inference execution:

| Property | Type | Description |
|----------|------|-------------|
| `provider` | `"openai" \| "anthropic" \| "azure-openai"` | Provider selection |
| `model` | `string` | Model name (or Azure deployment name) |
| `base-url` | `string` | API endpoint (for proxies, local models, Azure) |
| `api-key` | `string` | API key (development only — use a backend proxy in production) |
| `system` | `string` | System message (shortcut, attribute) |
| `prompt` | `string` | User input text (JS property) |
| `trigger` | `boolean` | One-way send trigger |
| `no-stream` | `boolean` | Disable streaming |
| `temperature` | `number` | Generation temperature |
| `max-tokens` | `number` | Maximum output tokens |

## Architecture

`@wcstack/ai` follows the HAWC architecture.

### Core: `AiCore`

`AiCore` is a pure `EventTarget` class.
It contains:

- provider-agnostic HTTP execution
- SSE stream parsing and content accumulation
- rAF-batched content event emission (~60fps)
- conversation history management
- abort control
- `wc-bindable-protocol` declaration

### Shell: `<wcs-ai>`

`<wcs-ai>` is a thin `HTMLElement` wrapper around `AiCore`.
It adds:

- attribute / property mapping
- DOM lifecycle integration
- child element collection (`<wcs-ai-message>`)
- declarative execution helpers such as `trigger`

### Providers

Providers implement the `IAiProvider` interface, translating between the unified internal format and each API's specific request/response shapes:

```typescript
interface IAiProvider {
  buildRequest(messages, options): { url, headers, body };
  parseResponse(data): { content, usage? };
  parseStreamChunk(event, data): { delta?, usage?, done } | null;
}
```

`AzureOpenAiProvider` extends `OpenAiProvider`, overriding only `buildRequest` for Azure-specific URL and header construction.

### Target injection

The Core dispatches events directly on the Shell via **target injection**, so no event re-dispatch is needed.

### Streaming pipeline

```
fetch → ReadableStream → TextDecoder → SseParser → Provider.parseStreamChunk
                                                          ↓
                                               content accumulation
                                                          ↓
                                              rAF batching (~60fps)
                                                          ↓
                                         wcs-ai:content-changed event
                                                          ↓
                                          @wcstack/state DOM binding
```

## Headless Usage (Core only)

`AiCore` can be used without the Shell element:

```typescript
import { AiCore } from "@wcstack/ai";
import { bind } from "@wc-bindable/core";

const core = new AiCore();
core.provider = "openai";

const unbind = bind(core, (name, value) => {
  if (name === "content") process.stdout.write(value);
});

await core.send("Explain quantum computing in one paragraph.", {
  model: "gpt-4o",
  baseUrl: "/api/ai",
});

console.log("\n---");
console.log("Tokens:", core.usage);
console.log("History:", core.messages);

unbind();
```

### Custom provider

```typescript
import { AiCore } from "@wcstack/ai";

const core = new AiCore();
core.provider = {
  buildRequest(messages, options) {
    return {
      url: `${options.baseUrl}/v1/generate`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: messages.at(-1)?.content, model: options.model }),
    };
  },
  parseResponse(data) {
    return { content: data.text };
  },
  parseStreamChunk(_event, data) {
    if (data === "[DONE]") return { done: true };
    try {
      const parsed = JSON.parse(data);
      return { delta: parsed.token, done: false };
    } catch { return null; }
  },
};
```

## Conversation History

`AiCore` owns the conversation history. Each `send()` call:

1. appends `{ role: "user", content: prompt }` to messages
2. on success, appends `{ role: "assistant", content }` to messages
3. on error, removes the user message (keeps history clean for retry)

Read and write the history via the `messages` property:

```javascript
const aiEl = document.querySelector("wcs-ai");

// Read history
console.log(aiEl.messages);

// Clear history
aiEl.messages = [];

// Restore from saved state
aiEl.messages = savedMessages;
```

## Abort

Like `<wcs-fetch>`, in-flight requests can be aborted:

```javascript
const aiEl = document.querySelector("wcs-ai");
aiEl.abort(); // Cancels streaming or pending request
```

A new `send()` call automatically aborts any previous request.

## Programmatic Usage

```javascript
const aiEl = document.querySelector("wcs-ai");

// Set prompt and send
aiEl.prompt = "What is the meaning of life?";
const result = await aiEl.send();

console.log(result);          // Complete response text
console.log(aiEl.content);    // Same as result
console.log(aiEl.messages);   // Conversation history
console.log(aiEl.usage);      // { promptTokens, completionTokens, totalTokens }
console.log(aiEl.loading);    // false
console.log(aiEl.streaming);  // false
```

## Optional DOM Triggering

If `autoTrigger` is enabled (default), clicking an element with `data-aitarget` triggers the corresponding `<wcs-ai>` element's `send()`:

```html
<button data-aitarget="chat">Send</button>
<wcs-ai id="chat" provider="openai" model="gpt-4o" base-url="/api/ai"></wcs-ai>
```

Event delegation is used — works with dynamically added elements.

This is a convenience feature.
In wcstack applications, **state-driven triggering via `trigger`** is usually the primary pattern.

## Elements

### `<wcs-ai>`

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `provider` | `string` | — | `"openai"`, `"anthropic"`, or `"azure-openai"` |
| `model` | `string` | — | Model name or Azure deployment name |
| `base-url` | `string` | — | API endpoint URL |
| `api-key` | `string` | — | API key (development only) |
| `system` | `string` | — | System message (shortcut) |
| `no-stream` | `boolean` | `false` | Disable streaming |
| `temperature` | `number` | — | Generation temperature |
| `max-tokens` | `number` | — | Maximum output tokens |
| `api-version` | `string` | `2024-02-01` | Azure OpenAI API version |

| Property | Type | Description |
|----------|------|-------------|
| `content` | `string` | Current response (streams in real-time) |
| `messages` | `AiMessage[]` | Conversation history (read/write) |
| `usage` | `AiUsage \| null` | Token usage |
| `loading` | `boolean` | `true` while request is active |
| `streaming` | `boolean` | `true` while receiving chunks |
| `error` | `AiHttpError \| Error \| null` | Error info |
| `prompt` | `string` | User input text |
| `trigger` | `boolean` | Set to `true` to send |

| Method | Description |
|--------|-------------|
| `send()` | Send the current `prompt` |
| `abort()` | Cancel the in-flight request |

### `<wcs-ai-message>`

Defines an initial message. Place it as a child of `<wcs-ai>`.

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `role` | `string` | `system` | Message role |

The message content is taken from the element's text content. Shadow DOM suppresses rendering.

```html
<wcs-ai provider="openai" model="gpt-4o" base-url="/api/ai">
  <wcs-ai-message role="system">
    You are a helpful coding assistant.
    Always provide TypeScript examples.
  </wcs-ai-message>
</wcs-ai>
```

## wc-bindable-protocol

Both `AiCore` and `<wcs-ai>` declare `wc-bindable-protocol` compliance.

### Core (`AiCore`)

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "content",   event: "wcs-ai:content-changed" },
    { name: "messages",  event: "wcs-ai:messages-changed" },
    { name: "usage",     event: "wcs-ai:usage-changed" },
    { name: "loading",   event: "wcs-ai:loading-changed" },
    { name: "streaming", event: "wcs-ai:streaming-changed" },
    { name: "error",     event: "wcs-ai:error" },
  ],
};
```

### Shell (`<wcs-ai>`)

```typescript
static wcBindable = {
  ...AiCore.wcBindable,
  properties: [
    ...AiCore.wcBindable.properties,
    { name: "trigger", event: "wcs-ai:trigger-changed" },
  ],
};
```

## TypeScript Types

```typescript
import type {
  IAiProvider, AiMessage, AiUsage, AiRequestOptions,
  AiProviderRequest, AiStreamChunkResult,
  AiHttpError, WcsAiCoreValues, WcsAiValues
} from "@wcstack/ai";
```

```typescript
interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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
```

## Provider Details

### OpenAI

- Endpoint: `{base-url}/v1/chat/completions`
- Auth: `Authorization: Bearer {api-key}`
- Streaming: SSE with `data: {"choices":[{"delta":{"content":"..."}}]}` and `data: [DONE]`
- Usage: `stream_options: { include_usage: true }` requests usage in the final chunk

### Anthropic

- Endpoint: `{base-url}/v1/messages`
- Auth: `x-api-key: {api-key}`, `anthropic-version: 2023-06-01`
- System: extracted from messages and placed in top-level `system` field
- Streaming: SSE with event types (`content_block_delta`, `message_start`, `message_delta`, `message_stop`)
- Usage: `input_tokens` from `message_start`, `output_tokens` from `message_delta` — merged by Core
- Default `max_tokens`: 4096

### Azure OpenAI

- Endpoint: `{base-url}/openai/deployments/{model}/chat/completions?api-version={api-version}`
- Auth: `api-key: {api-key}`
- Request/response format: same as OpenAI (inherits `parseResponse` and `parseStreamChunk`)

## Why this works well with `@wcstack/state`

`@wcstack/state` uses path strings as the only contract between UI and state.
`<wcs-ai>` fits this model naturally:

- state holds `prompt` and `trigger`
- `<wcs-ai>` streams the response
- `content` updates reactively on every chunk — the binding system reflects it to the DOM
- `messages` accumulates the conversation — `for:` templates render the history

The streaming story is where this integration shines: `content` fires `wcs-ai:content-changed` at ~60fps (rAF-batched), and `@wcstack/state`'s binding updates the DOM on each event. This gives a real-time typing effect with zero JS in the UI layer.

## Framework Integration

Since `<wcs-ai>` is HAWC + `wc-bindable-protocol`, it works with any framework through thin adapters from `@wc-bindable/*`.

### React

```tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsAiValues } from "@wcstack/ai";

function Chat() {
  const [ref, { content, messages, loading, streaming }] =
    useWcBindable<HTMLElement, WcsAiValues>();

  return (
    <>
      <wcs-ai ref={ref} provider="openai" model="gpt-4o" base-url="/api/ai" />
      <ul>
        {messages?.map((m, i) => (
          <li key={i} className={m.role}>{m.content}</li>
        ))}
        {streaming && <li className="assistant">{content}</li>}
      </ul>
    </>
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { useWcBindable } from "@wc-bindable/vue";
import type { WcsAiValues } from "@wcstack/ai";

const { ref, values } = useWcBindable<HTMLElement, WcsAiValues>();
</script>

<template>
  <wcs-ai :ref="ref" provider="openai" model="gpt-4o" base-url="/api/ai" />
  <ul>
    <li v-for="(m, i) in values.messages" :key="i" :class="m.role">{{ m.content }}</li>
    <li v-if="values.streaming" class="assistant">{{ values.content }}</li>
  </ul>
</template>
```

### Svelte

```svelte
<script>
import { wcBindable } from "@wc-bindable/svelte";

let content = $state("");
let messages = $state([]);
let streaming = $state(false);
</script>

<wcs-ai provider="openai" model="gpt-4o" base-url="/api/ai"
  use:wcBindable={{ onUpdate: (name, v) => {
    if (name === "content") content = v;
    if (name === "messages") messages = v;
    if (name === "streaming") streaming = v;
  }}} />

<ul>
  {#each messages as m, i (i)}
    <li class={m.role}>{m.content}</li>
  {/each}
  {#if streaming}
    <li class="assistant">{content}</li>
  {/if}
</ul>
```

### Vanilla — `bind()` directly

```javascript
import { bind } from "@wc-bindable/core";

const aiEl = document.querySelector("wcs-ai");

bind(aiEl, (name, value) => {
  if (name === "content") {
    document.getElementById("response").textContent = value;
  }
});
```

## Configuration

```javascript
import { bootstrapAi } from "@wcstack/ai";

bootstrapAi({
  autoTrigger: true,
  triggerAttribute: "data-aitarget",
  tagNames: {
    ai: "wcs-ai",
    aiMessage: "wcs-ai-message",
  },
});
```

## Security

> ⚠ The `api-key` attribute is exposed in the DOM and is intended for **development and prototyping only**.
> In production, use `base-url` to point to a backend proxy that handles authentication server-side.

```html
<!-- Development -->
<wcs-ai provider="openai" model="gpt-4o" api-key="sk-..." />

<!-- Production (recommended) -->
<wcs-ai provider="openai" model="gpt-4o" base-url="/api/ai" />
```

## Design Notes

- `content`, `messages`, `usage`, `loading`, `streaming`, and `error` are **output state**
- `prompt`, `trigger`, `provider`, `model` are **input / command surface**
- `trigger` is intentionally one-way: writing `true` executes send, reset emits completion
- `content` updates are batched via `requestAnimationFrame` — each rAF cycle emits at most one `wcs-ai:content-changed` event, limiting DOM updates to ~60fps even under high-throughput streaming
- on error, the user message is removed from history to keep it clean for retry
- a new `send()` automatically aborts any in-flight request (same as `<wcs-fetch>` URL change behavior)
- `messages` is both readable (output state) and writable (for history reset/restore)
- `system` attribute takes priority over `<wcs-ai-message role="system">`
- Anthropic's `max_tokens` defaults to 4096 if not specified
- zero runtime dependencies — all providers use `fetch` + `ReadableStream` + SSE parsing directly

## License

MIT
