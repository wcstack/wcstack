# state + ai demo

`@wcstack/state` と `@wcstack/ai` を組み合わせた、ストリーミングチャットのローカルデモです。

## 使用パッケージ

- `@wcstack/state` — CDN (`esm.run`) 経由
- `@wcstack/ai` — CDN (`esm.run`) 経由

## 起動手順

```bash
# AI 設定を環境変数で渡して起動
# PowerShell
$env:AI_BASE_URL='http://localhost:11434/v1'
$env:AI_PROVIDER='openai'
$env:AI_MODEL='gemma3:4b'
node examples/state-ai/server.js

# Bash
AI_BASE_URL=http://localhost:11434/v1 \
AI_PROVIDER=openai \
AI_MODEL=gemma3:4b \
node examples/state-ai/server.js
```

ブラウザで `http://localhost:3200` を開いてください。

## 環境変数

- `AI_BASE_URL`: 必須。LLM API のベース URL
- `AI_PROVIDER`: 任意。`openai`（既定）/ `anthropic` / `azure-openai`
- `AI_MODEL`: 任意。既定値は `gpt-4o-mini`
- `AI_API_KEY`: 任意。API キー（ローカル Ollama などでは不要）
- `AI_SYSTEM`: 任意。システムプロンプト
- `PORT`: 任意。既定値は `3200`

## API エンドポイントの例

| プロバイダ | AI_BASE_URL | AI_PROVIDER | AI_MODEL |
|-----------|-------------|-------------|----------|
| Ollama (ローカル) | `http://localhost:11434/v1` | `openai` | `gemma3:4b` |
| OpenAI | `https://api.openai.com` | `openai` | `gpt-4o-mini` |
| Anthropic | `https://api.anthropic.com` | `anthropic` | `claude-sonnet-4-20250514` |
| Azure OpenAI | `https://YOUR.openai.azure.com` | `azure-openai` | `your-deployment` |

## このデモで確認できること

- `<wcs-ai>` の `content` / `messages` / `usage` / `loading` / `streaming` / `error` を `<wcs-state>` に束縛
- `prompt` + `trigger` を使った state 起点の推論実行
- ストリーミング応答のリアルタイム表示（rAF バッチング）
- 会話履歴の `for:` ループ表示
- トークン使用量の表示
- Shift+Enter で改行、Enter で送信
