<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useWcBindable } from "@wc-bindable/vue";

// Template refs are named statically (`ref="workerEl"`): a `:ref="…"` binding gets the ref unwrapped
// in <script setup>, passes null, and the adapter never binds (docs/framework-adapter-integration.md §2).

// `message` is an occurrence, not a state: Vue skips a value equal to the last one ("pong" twice was
// seen once), so the messages are taken off the elements' events (§5). The adapter keeps the states.
function listen(elRef, type, handler) {
  const on = (e) => handler(e.detail);
  onMounted(() => elRef.value?.addEventListener(type, on));
  onUnmounted(() => elRef.value?.removeEventListener(type, on));
}

// ---- the worker ------------------------------------------------------------
const { ref: workerEl, values: worker } = useWcBindable({ error: null, running: false });
const ready = ref(false);
const pongs = ref(0);
const job = ref(0);
const progress = ref([]); // progress messages, in order
const rows = ref([]); // parsed rows, kept in Vue state
const parseErrors = ref([]);
const fileName = ref("");

listen(workerEl, "wcs-worker:message", (msg) => {
  if (msg === "ready") { ready.value = true; return; }
  if (msg === "pong") { pongs.value++; return; }
  if (!msg || msg.job !== job.value) return;
  if (msg.type === "progress") progress.value = [...progress.value, `${msg.done} / ${msg.total}`];
  if (msg.type === "rows") { rows.value = msg.rows; parseErrors.value = msg.errors; }
});

async function onFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  progress.value = [];
  rows.value = [];
  parseErrors.value = [];
  imported.value = null;
  job.value++;
  const text = await file.text();
  workerEl.value.post({ type: "parse", text, job: job.value });
}
function ping() { workerEl.value.post("ping"); }

// ---- the picked list, shared with the React app over <wcs-broadcast> ----------
// Wire format: { type: "picked", items: [{ id, sku, name, qty }], from } | { type: "hello", from }
const { ref: bcEl, values: bc } = useWcBindable({ error: null });
const picked = ref([]);
const pickSku = ref("");
function sendPicked() {
  // A deep plain copy: the list's rows are reactive proxies too, which structured clone refuses, and
  // toRaw() unwraps one level only (§3).
  bcEl.value.post({ type: "picked", items: JSON.parse(JSON.stringify(picked.value)), from: "vue" });
}
listen(bcEl, "wcs-broadcast:message", (m) => {
  if (!m || typeof m !== "object") return;
  if (m.type === "picked" && Array.isArray(m.items)) picked.value = m.items;
  if (m.type === "hello") sendPicked();
});
function markDone(sku) { picked.value = picked.value.filter((x) => x.sku !== sku); sendPicked(); }
function addPick() {
  const sku = pickSku.value.trim();
  if (!sku) return;
  const i = picked.value.findIndex((x) => x.sku === sku);
  picked.value = i >= 0
    ? picked.value.map((x) => (x.sku === sku ? { ...x, qty: x.qty + 1 } : x))
    : [...picked.value, { id: Number(sku.replace(/\D/g, "")) || 0, sku, name: "(from warehouse)", qty: 1 }];
  pickSku.value = "";
  sendPicked();
}
onMounted(() => bcEl.value.post({ type: "hello", from: "vue" }));

// ---- the import --------------------------------------------------------------
const { ref: importEl, values: imp } = useWcBindable({ value: null, loading: false, error: null, status: 0 });
const imported = ref(null);
watch(() => imp.value, (v) => { if (v && imp.status === 200) imported.value = v; });
const serverErrors = computed(() => {
  const e = imp.error;
  if (!e?.body) return [];
  try { return JSON.parse(e.body).errors ?? []; } catch { return []; }
});
function importRows() {
  const el = importEl.value;
  // a new object every time: the element uses `body` up, and a body changed in place is not written again
  el.body = { rows: rows.value };
  el.fetch();
}
</script>

<template>
  <header>
    <strong>Warehouse</strong>
    <a href="/">Back office (React)</a>
    <span class="badge" :class="worker.running ? 'on' : 'off'" data-testid="worker-status">worker: {{ worker.running ? (ready ? 'ready' : 'starting') : 'stopped' }}</span>
  </header>

  <wcs-worker ref="workerEl" src="/csv-worker.js" data-testid="worker"></wcs-worker>
  <wcs-fetch ref="importEl" url="/api/stock/import" method="POST" manual data-testid="import-fetch">
    <wcs-fetch-header name="Content-Type" value="application/json"></wcs-fetch-header>
  </wcs-fetch>

  <wcs-broadcast ref="bcEl" name="inv-picked" data-testid="bc"></wcs-broadcast>
  <aside data-testid="picked">
    <strong>Picked ({{ picked.reduce((n, x) => n + x.qty, 0) }})</strong>
    <span v-if="bc.error" class="error" data-testid="picked-error"> {{ bc.error.name }}: {{ bc.error.message }}</span>
    <ul data-testid="picked-list">
      <li v-for="x in picked" :key="x.sku" :data-sku="x.sku">{{ x.sku }} {{ x.name }} × {{ x.qty }}
        <button data-testid="picked-done" @click="markDone(x.sku)">Done</button></li>
    </ul>
    <input v-model="pickSku" placeholder="SKU" data-testid="pick-sku" /> <button data-testid="pick-add" @click="addPick">Pick</button>
  </aside>

  <section>
    <h2>Import stock from CSV</h2>
    <div class="toolbar">
      <input type="file" accept=".csv,text/csv" data-testid="csv-input" @change="onFile" />
      <button data-testid="ping" @click="ping">Ping worker</button>
      <span data-testid="pongs">{{ pongs }} pong(s)</span>
    </div>
    <p v-if="worker.error" class="error" data-testid="worker-error">Worker: {{ worker.error.name }} — {{ worker.error.message }}</p>
    <ol data-testid="progress"><li v-for="(p, i) in progress" :key="i">{{ p }}</li></ol>
    <p v-if="rows.length" data-testid="parsed">{{ rows.length }} rows parsed from {{ fileName }}<span v-if="parseErrors.length">, {{ parseErrors.length }} lines skipped</span></p>
    <ul v-if="parseErrors.length" data-testid="parse-errors"><li v-for="e in parseErrors" :key="e.line">line {{ e.line }}: {{ e.message }}</li></ul>
    <table v-if="rows.length">
      <thead><tr><th>SKU</th><th>Stock</th></tr></thead>
      <tbody data-testid="rows"><tr v-for="r in rows" :key="r.sku"><td>{{ r.sku }}</td><td>{{ r.stock }}</td></tr></tbody>
    </table>
    <p>
      <button data-testid="import" :disabled="!rows.length || imp.loading" @click="importRows">Import {{ rows.length }} rows</button>
      <span v-if="imp.loading" data-testid="import-loading">Importing…</span>
    </p>
    <p v-if="imported" data-testid="import-done">Updated {{ imported.updated }} products.</p>
    <div v-if="imp.error" class="error" data-testid="import-error">
      Import refused ({{ imp.error.status }}).
      <ul><li v-for="e in serverErrors" :key="e.row + e.message">row {{ e.row }}: {{ e.message }}</li></ul>
    </div>
  </section>
</template>
