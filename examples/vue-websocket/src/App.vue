<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from "vue";
import { useWcBindable } from "@wc-bindable/vue";
import type { WcsWsValues, WcsWebSocket } from "@wcstack/websocket";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

interface WsMessage {
  type: string;
  content?: string;
  from?: string;
  clients?: number;
  uptime?: number;
  timestamp?: number;
}

interface LogEntry {
  type: string;
  time: string;
  text: string;
}

const logContainer = ref<HTMLDivElement | null>(null);

const { ref: wsEl, values: ws } = useWcBindable<WcsWebSocket, WcsWsValues<WsMessage | null>>({
  message: null,
  connected: false,
  loading: false,
  error: null,
  readyState: 0,
  trigger: false,
  send: null,
});

const stats = ref<{ clients: number; uptime: number } | null>(null);
const messageLog = reactive<LogEntry[]>([]);
const echoInput = ref("");
const broadcastInput = ref("");
const nickname = ref("vue-" + Math.random().toString(36).slice(2, 6));

const connectionLabel = computed(() => {
  if (ws.loading) return "Connecting…";
  return ws.connected ? "Connected" : "Disconnected";
});

watch(() => ws.message, (msg) => {
  if (!msg) return;

  if (msg.type === "stats") {
    stats.value = msg as { clients: number; uptime: number };
    return;
  }

  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString()
    : new Date().toLocaleTimeString();

  const entry: LogEntry = { type: msg.type || "unknown", time, text: "" };
  if (msg.type === "echo") {
    entry.text = msg.content ?? "";
  } else if (msg.type === "broadcast") {
    entry.text = `[${msg.from}] ${msg.content}`;
  } else if (msg.type === "connected") {
    entry.text = `WebSocket connected (${msg.clients} clients)`;
  } else {
    entry.text = JSON.stringify(msg);
  }

  messageLog.push(entry);
});

watch(() => messageLog.length, () => {
  nextTick(() => {
    const el = logContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
});

function sendEcho() {
  const text = echoInput.value.trim();
  if (!text || !ws.connected || !wsEl.value) return;
  wsEl.value.send = JSON.stringify({ type: "echo", content: text });
  echoInput.value = "";
}

function sendBroadcast() {
  const text = broadcastInput.value.trim();
  if (!text || !ws.connected || !wsEl.value) return;
  wsEl.value.send = JSON.stringify({ type: "broadcast", content: text, from: nickname.value });
  broadcastInput.value = "";
}
</script>

<template>
  <wcs-ws
    ref="wsEl"
    :url="WS_URL"
    auto-reconnect
    reconnect-interval="3000"
    max-reconnects="10"
  />

  <main>
    <section class="hero">
      <span class="eyebrow">Framework Interop Demo</span>
      <h1>wcstack WebSocket<br>from Vue</h1>
      <p class="lead">
        A Vue 3 app uses the <code>&lt;wcs-ws&gt;</code> Web Component for real-time
        communication. The power of framework-agnostic web standards.
      </p>
      <div class="tech-badges">
        <span class="tech-badge vue">Vue 3</span>
        <span class="tech-badge wc">&lt;wcs-ws&gt; Web Component</span>
        <span class="tech-badge bind">@wc-bindable/vue</span>
      </div>
    </section>

    <div class="status-bar">
      <div class="status">
        <span class="dot" :class="{ live: ws.connected }" />
        <span>{{ connectionLabel }}</span>
      </div>
      <div class="stat-badge">
        Clients: <strong>{{ stats?.clients ?? '—' }}</strong>
      </div>
      <div class="stat-badge">
        Uptime: <strong>{{ stats ? stats.uptime + 's' : '—' }}</strong>
      </div>
    </div>

    <div v-if="ws.error" class="callout error" style="margin-bottom: 14px;">
      <strong>Connection Error</strong><br>
      {{ (ws.error as any)?.message || String(ws.error) }}
    </div>

    <div class="grid">
      <div class="panel">
        <h2>Echo</h2>
        <p class="lead">Send a message and the server echoes it back.</p>
        <div class="input-row">
          <input
            type="text"
            placeholder="Echo message…"
            v-model="echoInput"
            @keydown.enter="sendEcho"
          >
          <button
            class="btn-echo"
            :disabled="!ws.connected || !echoInput.trim()"
            @click="sendEcho"
          >Send</button>
        </div>
      </div>

      <div class="panel">
        <h2>Broadcast</h2>
        <p class="lead">Deliver a message to all connected clients.</p>
        <div class="input-row">
          <input
            type="text"
            placeholder="Broadcast message…"
            v-model="broadcastInput"
            @keydown.enter="sendBroadcast"
          >
          <button
            class="btn-broadcast"
            :disabled="!ws.connected || !broadcastInput.trim()"
            @click="sendBroadcast"
          >Send</button>
        </div>
        <div class="input-row">
          <input
            type="text"
            placeholder="Nickname"
            v-model="nickname"
            style="max-width: 180px;"
          >
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top: 18px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2>Message Log</h2>
        <button
          style="background: rgba(0,0,0,0.06); color: var(--muted); font-size: 0.8rem; padding: 6px 12px;"
          @click="messageLog.length = 0"
        >Clear</button>
      </div>

      <div class="log" ref="logContainer">
        <div v-if="messageLog.length === 0" class="log-empty">
          Messages will appear here after connecting.
        </div>
        <div
          v-for="(entry, i) in messageLog"
          :key="i"
          class="log-entry"
          :class="'log-' + entry.type"
        >
          <span class="log-time">{{ entry.time }}</span>
          {{ entry.type === 'echo' ? 'Echo: ' : '' }}{{ entry.text }}
        </div>
      </div>
    </div>

    <div class="callout" style="margin-top: 18px; font-size: 0.88rem;">
      <strong>How it works:</strong> The <code>useWcBindable()</code> composable from
      <code>@wc-bindable/vue</code> automatically syncs all properties of
      <code>&lt;wcs-ws&gt;</code> (message, connected, loading, error) into Vue reactive state.
      No manual <code>addEventListener</code> needed.
    </div>
  </main>
</template>
