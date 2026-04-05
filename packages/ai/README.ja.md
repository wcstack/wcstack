# @wcstack/ai

`@wcstack/ai` は wcstack エコシステムのためのヘッドレス AI 推論コンポーネントです。

視覚的な UI ウィジェットではありません。
LLM 推論とリアクティブな状態をつなぐ **I/O ノード** です — **ストリーミングファースト**で設計されています。

`@wcstack/state` と組み合わせると、`<wcs-ai>` はパス契約を通じて直接バインドできます:

- **入力 / コマンドサーフェス**: `prompt`, `trigger`, `model`, `provider`
- **出力ステートサーフェス**: `content`, `messages`, `usage`, `loading`, `streaming`, `error`

つまり、チャット UI や AI 機能を HTML 内で宣言的に表現できます。UI レイヤーに fetch 呼び出し、SSE パース、トークン管理、ストリーミングのグルーコードを書く必要はありません。

`@wcstack/ai` は [HAWC](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/docs/articles/HAWC.md) アーキテクチャに従います:

- **Core** (`AiCore`) がプロバイダ抽象化、ストリーミング、会話状態を処理
- **Shell** (`<wcs-ai>`) がその状態を DOM に接続
- フレームワークやバインディングシステムは [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol) 経由で利用

**ランタイム依存ゼロ。** すべてのプロバイダは `fetch` + `ReadableStream` + SSE パースで実装されており、SDK は不要です。

## なぜこれが存在するのか

チャット UI の構築には多くの配管作業が必要です。
プロバイダ API への HTTP リクエスト、SSE ストリームパース、コンテンツの蓄積、トークン追跡、会話履歴管理、abort 処理。

`@wcstack/ai` はそのすべてを再利用可能なコンポーネントに移し、結果をバインド可能な状態として公開します。

`@wcstack/state` と組み合わせたフローは:

1. ユーザーが `prompt` を書き込み
2. `trigger` が発火
3. `<wcs-ai>` がレスポンスをストリーム — `content` がチャンクごとに更新
4. UI は `data-wcs` で `content` にバインド — DOM が ~60fps で自動更新
5. 完了時に `messages` に完全な会話が含まれる

LLM 推論が命令的な UI コードではなく、**状態遷移**になります。

## インストール

```bash
npm install @wcstack/ai
```

ピア依存は不要です。

## 対応プロバイダ

| プロバイダ | `provider` 値 | デフォルトベース URL |
|----------|-----------------|------------------|
| OpenAI | `"openai"` | `https://api.openai.com` |
| Anthropic | `"anthropic"` | `https://api.anthropic.com` |
| Azure OpenAI | `"azure-openai"` | (`base-url` で指定必須) |

OpenAI 互換 API (Ollama, vLLM, LiteLLM 等) は `provider="openai"` とカスタム `base-url` で動作します。

## クイックスタート

### 1. 状態バインディングによるストリーミングチャット

`trigger` が発火すると、`<wcs-ai>` がプロンプトを送信しレスポンスをストリームします。`content` がチャンクごとに更新され、`@wcstack/state` が DOM に自動反映します。

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
    <wcs-ai-message role="system">あなたは親切なアシスタントです。</wcs-ai-message>
  </wcs-ai>

  <div class="chat">
    <template data-wcs="for: chatHistory">
      <div data-wcs="class: chatHistory.*.role; textContent: chatHistory.*.content"></div>
    </template>
    <template data-wcs="if: isLoading">
      <div class="assistant" data-wcs="textContent: assistantText"></div>
    </template>
  </div>

  <input data-wcs="value: userInput" placeholder="メッセージを入力...">
  <button data-wcs="onclick: send">送信</button>
</wcs-state>
```

ストリーミング中、`assistantText` がチャンクごとに更新され (~60fps、rAF バッチング)、バインディングシステムが DOM にリアルタイム反映します。

### 2. 非ストリーミングリクエスト

`no-stream` を追加してストリーミングを無効化し、完全なレスポンスを一度に受け取ります:

```html
<wcs-ai
  provider="openai"
  model="gpt-4o"
  base-url="/api/ai"
  no-stream
  data-wcs="prompt: userInput; trigger: sendTrigger; content: result">
</wcs-ai>
```

### 3. Anthropic プロバイダ

```html
<wcs-ai
  provider="anthropic"
  model="claude-sonnet-4-20250514"
  base-url="/api/anthropic"
  max-tokens="4096"
  data-wcs="prompt: userInput; trigger: sendTrigger; content: assistantText">
  <wcs-ai-message role="system">簡潔なコーディングアシスタントです。</wcs-ai-message>
</wcs-ai>
```

Anthropic の system メッセージ形式は自動的に処理されます — プロバイダが system メッセージを抽出してトップレベルの `system` フィールドに配置します。

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

URL は `{base-url}/openai/deployments/{model}/chat/completions?api-version={api-version}` の形式で構築されます。

### 5. Ollama によるローカルモデル

```html
<wcs-ai
  provider="openai"
  model="llama3"
  base-url="http://localhost:11434"
  data-wcs="prompt: userInput; trigger: sendTrigger; content: assistantText">
</wcs-ai>
```

OpenAI 互換 API は `base-url` を変えるだけで動作します。

### 6. バックエンドプロキシによる認証済みリクエスト

`<wcs-ai>` はブラウザ標準の `fetch` で `base-url` にリクエストを送信します。バックエンドプロキシが Cookie/セッションベース認証を使用している場合、ブラウザが自動的に認証情報を含めます:

```html
<wcs-ai
  provider="openai"
  model="gpt-4o"
  base-url="/api/ai"
  data-wcs="prompt: userInput; trigger: sendTrigger; content: assistantText">
</wcs-ai>
```

`/api/ai` のバックエンドプロキシがユーザーのセッションを検証し、サーバーサイドの API キーで AI プロバイダにリクエストを転送します。これが推奨される本番パターンです — ブラウザに API キーを持たず、カスタム認証ヘッダーの注入も不要です。

## ステートサーフェス vs コマンドサーフェス

`<wcs-ai>` は 2 種類のプロパティを公開します。

### 出力状態（バインド可能な非同期状態）

現在の推論状態を表すプロパティで、HAWC のメインサーフェスです:

| プロパティ | 型 | 説明 |
|----------|------|-------------|
| `content` | `string` | 現在のレスポンステキスト。**ストリーミング中はチャンクごとに更新** (~60fps、rAF バッチング) |
| `messages` | `AiMessage[]` | 会話履歴全体 (user + assistant)。送信時と完了時に更新 |
| `usage` | `AiUsage \| null` | トークン使用量 `{ promptTokens, completionTokens, totalTokens }` |
| `loading` | `boolean` | 送信〜完了またはエラーまで `true` |
| `streaming` | `boolean` | 最初のチャンク〜ストリーム完了まで `true` |
| `error` | `AiHttpError \| Error \| null` | エラー情報 |

### 入力 / コマンドサーフェス

推論実行を制御するプロパティ:

| プロパティ | 型 | 説明 |
|----------|------|-------------|
| `provider` | `"openai" \| "anthropic" \| "azure-openai"` | プロバイダ選択 |
| `model` | `string` | モデル名 (または Azure デプロイメント名) |
| `base-url` | `string` | API エンドポイント (プロキシ、ローカルモデル、Azure) |
| `api-key` | `string` | API キー (開発用のみ — 本番ではプロキシ推奨) |
| `system` | `string` | システムメッセージ (ショートカット、属性) |
| `prompt` | `string` | ユーザー入力テキスト (JS プロパティ) |
| `trigger` | `boolean` | 一方向送信トリガー |
| `no-stream` | `boolean` | ストリーミング無効化 |
| `temperature` | `number` | 生成温度 |
| `max-tokens` | `number` | 最大出力トークン数 |

## アーキテクチャ

`@wcstack/ai` は HAWC アーキテクチャに従います。

### Core: `AiCore`

`AiCore` は純粋な `EventTarget` クラスです。
以下を含みます:

- プロバイダ非依存の HTTP 実行
- SSE ストリームパースとコンテンツ蓄積
- rAF バッチングによるコンテンツイベント発行 (~60fps)
- 会話履歴管理
- abort 制御
- `wc-bindable-protocol` 宣言

### Shell: `<wcs-ai>`

`<wcs-ai>` は `AiCore` の薄い `HTMLElement` ラッパーです。
以下を追加します:

- 属性 / プロパティマッピング
- DOM ライフサイクル統合
- 子要素収集 (`<wcs-ai-message>`)
- `trigger` などの宣言的実行ヘルパー

### プロバイダ

プロバイダは `IAiProvider` インターフェースを実装し、統一された内部形式と各 API 固有のリクエスト/レスポンス形式を変換します:

```typescript
interface IAiProvider {
  buildRequest(messages, options): { url, headers, body };
  parseResponse(data): { content, usage? };
  parseStreamChunk(event, data): { delta?, usage?, done } | null;
}
```

`AzureOpenAiProvider` は `OpenAiProvider` を継承し、Azure 固有の URL とヘッダー構築のために `buildRequest` のみをオーバーライドします。

### ターゲットインジェクション

Core は **ターゲットインジェクション** により Shell 上で直接イベントをディスパッチするため、イベントの再ディスパッチは不要です。

### ストリーミングパイプライン

```
fetch → ReadableStream → TextDecoder → SseParser → Provider.parseStreamChunk
                                                          ↓
                                               コンテンツ蓄積
                                                          ↓
                                              rAF バッチング (~60fps)
                                                          ↓
                                         wcs-ai:content-changed イベント
                                                          ↓
                                          @wcstack/state DOM バインディング
```

## ヘッドレス利用（Core のみ）

`AiCore` は Shell 要素なしで使用できます:

```typescript
import { AiCore } from "@wcstack/ai";
import { bind } from "@wc-bindable/core";

const core = new AiCore();
core.provider = "openai";

const unbind = bind(core, (name, value) => {
  if (name === "content") process.stdout.write(value);
});

await core.send("量子コンピューティングを一段落で説明してください。", {
  model: "gpt-4o",
  baseUrl: "/api/ai",
});

console.log("\n---");
console.log("トークン:", core.usage);
console.log("履歴:", core.messages);

unbind();
```

### カスタムプロバイダ

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

## 会話履歴

`AiCore` が会話履歴を所有します。各 `send()` 呼び出し:

1. `{ role: "user", content: prompt }` を messages に追加
2. 成功時に `{ role: "assistant", content }` を messages に追加
3. エラー時にはユーザーメッセージを除去（リトライのために履歴をクリーンに保つ）

`messages` プロパティで履歴の読み書きが可能:

```javascript
const aiEl = document.querySelector("wcs-ai");

// 履歴を読む
console.log(aiEl.messages);

// 履歴をクリア
aiEl.messages = [];

// 保存した状態から復元
aiEl.messages = savedMessages;
```

## Abort

`<wcs-fetch>` と同様に、進行中のリクエストを中断できます:

```javascript
const aiEl = document.querySelector("wcs-ai");
aiEl.abort(); // ストリーミングまたは保留中のリクエストをキャンセル
```

新しい `send()` 呼び出しは、前のリクエストを自動的に abort します。

## プログラム的な使用

```javascript
const aiEl = document.querySelector("wcs-ai");

// プロンプトを設定して送信
aiEl.prompt = "人生の意味とは？";
const result = await aiEl.send();

console.log(result);          // 完全なレスポンステキスト
console.log(aiEl.content);    // result と同じ
console.log(aiEl.messages);   // 会話履歴
console.log(aiEl.usage);      // { promptTokens, completionTokens, totalTokens }
console.log(aiEl.loading);    // false
console.log(aiEl.streaming);  // false
```

## オプションの DOM トリガー

`autoTrigger` が有効（デフォルト）の場合、`data-aitarget` を持つ要素をクリックすると、対応する `<wcs-ai>` 要素の `send()` がトリガーされます:

```html
<button data-aitarget="chat">送信</button>
<wcs-ai id="chat" provider="openai" model="gpt-4o" base-url="/api/ai"></wcs-ai>
```

イベント委譲を使用しているため、動的に追加された要素でも動作します。

これは便利機能です。
wcstack アプリケーションでは、**`trigger` による状態駆動のトリガー** が通常の主要パターンです。

## 要素

### `<wcs-ai>`

| 属性 | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `provider` | `string` | — | `"openai"`, `"anthropic"`, `"azure-openai"` |
| `model` | `string` | — | モデル名または Azure デプロイメント名 |
| `base-url` | `string` | — | API エンドポイント URL |
| `api-key` | `string` | — | API キー (開発用のみ) |
| `system` | `string` | — | システムメッセージ (ショートカット) |
| `no-stream` | `boolean` | `false` | ストリーミング無効化 |
| `temperature` | `number` | — | 生成温度 |
| `max-tokens` | `number` | — | 最大出力トークン数 |
| `api-version` | `string` | `2024-02-01` | Azure OpenAI API バージョン |

| プロパティ | 型 | 説明 |
|----------|------|-------------|
| `content` | `string` | 現在のレスポンス (リアルタイムストリーム) |
| `messages` | `AiMessage[]` | 会話履歴 (読み書き可) |
| `usage` | `AiUsage \| null` | トークン使用量 |
| `loading` | `boolean` | リクエスト中なら `true` |
| `streaming` | `boolean` | チャンク受信中なら `true` |
| `error` | `AiHttpError \| Error \| null` | エラー情報 |
| `prompt` | `string` | ユーザー入力テキスト |
| `trigger` | `boolean` | `true` に設定して送信 |

| メソッド | 説明 |
|--------|-------------|
| `send()` | 現在の `prompt` を送信 |
| `abort()` | 進行中のリクエストをキャンセル |

### `<wcs-ai-message>`

初期メッセージを定義します。`<wcs-ai>` の子要素として配置します。

| 属性 | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `role` | `string` | `system` | メッセージのロール |

メッセージの内容は要素のテキストコンテンツから取得されます。Shadow DOM で描画を抑制します。

```html
<wcs-ai provider="openai" model="gpt-4o" base-url="/api/ai">
  <wcs-ai-message role="system">
    あなたは親切なコーディングアシスタントです。
    常に TypeScript の例を提供してください。
  </wcs-ai-message>
</wcs-ai>
```

## wc-bindable-protocol

`AiCore` と `<wcs-ai>` は `wc-bindable-protocol` 準拠を宣言しています。

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

## TypeScript 型

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

## プロバイダ詳細

### OpenAI

- エンドポイント: `{base-url}/v1/chat/completions`
- 認証: `Authorization: Bearer {api-key}`
- ストリーミング: SSE、`data: {"choices":[{"delta":{"content":"..."}}]}` と `data: [DONE]`
- 使用量: `stream_options: { include_usage: true }` で最終チャンクに使用量を含める

### Anthropic

- エンドポイント: `{base-url}/v1/messages`
- 認証: `x-api-key: {api-key}`, `anthropic-version: 2023-06-01`
- システム: messages から抽出してトップレベル `system` フィールドに配置
- ストリーミング: SSE、イベントタイプ付き (`content_block_delta`, `message_start`, `message_delta`, `message_stop`)
- 使用量: `message_start` から `input_tokens`、`message_delta` から `output_tokens` — Core がマージ
- デフォルト `max_tokens`: 4096

### Azure OpenAI

- エンドポイント: `{base-url}/openai/deployments/{model}/chat/completions?api-version={api-version}`
- 認証: `api-key: {api-key}`
- リクエスト/レスポンス形式: OpenAI と同じ (`parseResponse` と `parseStreamChunk` を継承)

## `@wcstack/state` との相性が良い理由

`@wcstack/state` は UI と状態の間の唯一の契約としてパス文字列を使用します。
`<wcs-ai>` はこのモデルに自然に適合します:

- 状態が `prompt` と `trigger` を保持
- `<wcs-ai>` がレスポンスをストリーム
- `content` がチャンクごとにリアクティブに更新 — バインディングシステムが DOM に反映
- `messages` が会話を蓄積 — `for:` テンプレートが履歴を描画

ストリーミングの統合がこの連携の真価です: `content` は ~60fps で `wcs-ai:content-changed` を発火し (rAF バッチング)、`@wcstack/state` のバインディングが各イベントで DOM を更新します。これにより、UI レイヤーに JS を一切書かずにリアルタイムのタイピング効果が得られます。

## フレームワーク連携

`<wcs-ai>` は HAWC + `wc-bindable-protocol` であるため、`@wc-bindable/*` の薄いアダプタを通じて任意のフレームワークで動作します。

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

### Vanilla — `bind()` を直接使用

```javascript
import { bind } from "@wc-bindable/core";

const aiEl = document.querySelector("wcs-ai");

bind(aiEl, (name, value) => {
  if (name === "content") {
    document.getElementById("response").textContent = value;
  }
});
```

## 設定

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

## セキュリティ

> ⚠ `api-key` 属性は DOM に露出するため、**開発・プロトタイプ用**です。
> 本番では `base-url` でバックエンドプロキシを使用し、認証をサーバーサイドで処理してください。

```html
<!-- 開発 -->
<wcs-ai provider="openai" model="gpt-4o" api-key="sk-..." />

<!-- 本番 (推奨) -->
<wcs-ai provider="openai" model="gpt-4o" base-url="/api/ai" />
```

## 設計ノート

- `content`, `messages`, `usage`, `loading`, `streaming`, `error` は **出力状態**
- `prompt`, `trigger`, `provider`, `model` は **入力 / コマンドサーフェス**
- `trigger` は意図的に一方向: `true` を書き込むと送信実行、リセットで完了を通知
- `content` の更新は `requestAnimationFrame` でバッチング — 各 rAF サイクルで最大 1 回の `wcs-ai:content-changed` イベントを発火し、高スループットストリーミングでも DOM 更新を ~60fps に制限
- エラー時はユーザーメッセージを履歴から除去（リトライのためにクリーンに保つ）
- 新しい `send()` は進行中のリクエストを自動的に abort (`<wcs-fetch>` の URL 変更と同じ動作)
- `messages` は読み取り可能（出力状態）かつ書き込み可能（履歴リセット/復元用）
- `system` 属性が `<wcs-ai-message role="system">` より優先
- Anthropic の `max_tokens` は未指定時に 4096 がデフォルト
- ランタイム依存ゼロ — すべてのプロバイダは `fetch` + `ReadableStream` + SSE パースを直接使用

## ライセンス

MIT
