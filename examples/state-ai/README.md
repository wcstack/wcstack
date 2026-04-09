# state + ai demo

A local demo combining `@wcstack/state` and `@wcstack/ai` into a streaming chat interface.

## What it uses

- `@wcstack/state` via CDN (`esm.run`)
- `@wcstack/ai` via CDN (`esm.run`)

## Setup

```bash
# Start the demo server with your AI settings
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

Open `http://localhost:3200`.

## Environment variables

- `AI_BASE_URL`: required — base URL of the LLM API
- `AI_PROVIDER`: optional, defaults to `openai` — `openai` / `anthropic` / `azure-openai`
- `AI_MODEL`: optional, defaults to `gpt-4o-mini`
- `AI_API_KEY`: optional — API key (not needed for local Ollama)
- `AI_SYSTEM`: optional — system prompt
- `PORT`: optional, defaults to `3200`

## Endpoint examples

| Provider | AI_BASE_URL | AI_PROVIDER | AI_MODEL |
|----------|-------------|-------------|----------|
| Ollama (local) | `http://localhost:11434/v1` | `openai` | `gemma3:4b` |
| OpenAI | `https://api.openai.com` | `openai` | `gpt-4o-mini` |
| Anthropic | `https://api.anthropic.com` | `anthropic` | `claude-sonnet-4-20250514` |
| Azure OpenAI | `https://YOUR.openai.azure.com` | `azure-openai` | `your-deployment` |

## What the demo shows

- `content`, `messages`, `usage`, `loading`, `streaming`, and `error` bound from `<wcs-ai>` into `<wcs-state>`
- inference triggered from state via `prompt` + `trigger`
- real-time streaming display (rAF-batched content updates)
- conversation history rendered with `for:` loop
- token usage display
- Shift+Enter for newline, Enter to send
