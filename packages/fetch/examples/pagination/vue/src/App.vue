<script setup>
import { ref as vueRef, computed } from "vue";
import { useWcBindable } from "@wc-bindable/vue";

const LIMIT = 12;

// --- page state ------------------------------------------------------------
const page = vueRef(1);
const url = computed(() => `/api/items?page=${page.value}&limit=${LIMIT}`);

// Bind the headless <wcs-fetch> node: `fetcherRef` is attached to the element,
// `values` mirrors its wcBindable properties (value/loading/error/status). No
// fetch()/AbortController here — writing the `:url` (in the template) makes
// <wcs-fetch> refetch and abort the previous in-flight request, so
// stale-response protection lives in the element.
// status is not used by the UI here, but every demo mirrors it to show
// <wcs-fetch> exposes the HTTP status too.
const { ref: fetcherRef, values } = useWcBindable({
  value: null,
  loading: false,
  error: null,
  status: 0,
});

// --- derived values --------------------------------------------------------
const body = computed(() => values.value); // the <wcs-fetch> "value" property
const items = computed(() => (body.value ? body.value.items : []));
const total = computed(() => (body.value ? body.value.total : 0));
const totalPages = computed(() => (body.value ? body.value.totalPages : 1));
const loading = computed(() => values.loading);
const hasData = computed(() => items.value.length > 0);
const firstLoading = computed(() => loading.value && !hasData.value);

// The node IS a state machine; these expose its observable state. We don't
// orchestrate the fetch — we read which state the node is in (idle → loading →
// ready / error) and the HTTP status it produced.
const machineState = computed(() =>
  values.error ? "error" : values.loading ? "loading" : hasData.value ? "ready" : "idle"
);
const statusLabel = computed(() => (values.status ? `HTTP ${values.status}` : "—"));

const rangeText = computed(() => {
  if (!hasData.value) return "Loading…";
  const start = (page.value - 1) * LIMIT + 1;
  const end = start + items.value.length - 1;
  return `${start}–${end} of ${total.value}`; // EN DASH (U+2013)
});

const pageLabel = computed(() =>
  hasData.value ? `Page ${page.value} / ${totalPages.value}` : ""
);

const isFirst = computed(() => page.value <= 1);
const isLast = computed(() => page.value >= totalPages.value);

// pageWindow: first, last, current ±1; collapse gaps to an ellipsis.
function pageWindow(current, pages) {
  const set = new Set([1, pages, current - 1, current, current + 1]);
  const sorted = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

// Token objects carry a stable v-for key (numbers are unique; gaps key by index).
const tokens = computed(() =>
  pageWindow(page.value, totalPages.value).map((tok, i) =>
    tok === "gap"
      ? { kind: "gap", key: `gap-${i}` }
      : { kind: "page", n: tok, key: `p-${tok}` }
  )
);

// --- actions ---------------------------------------------------------------
function go(p) {
  if (p >= 1 && p <= totalPages.value && p !== page.value) page.value = p;
}
function prev() {
  if (!isFirst.value) page.value -= 1;
}
function next() {
  if (!isLast.value) page.value += 1;
}
</script>

<template>
  <div class="demo">
    <header class="demo-header">
      <span class="demo-badge">Vue</span>
      <h1>Pagination — Vue</h1>
      <p>Composition API + &lt;wcs-fetch&gt; via @wc-bindable/vue</p>
    </header>

    <!-- Headless data node. The reactive :url triggers a fetch (and aborts the
         previous one); ref="fetcherRef" streams its state into `values`. -->
    <wcs-fetch ref="fetcherRef" :url="url"></wcs-fetch>

    <div class="panel">
      <!-- The node's state machine: input (the page we write) → current state →
           the HTTP status it produced. -->
      <div class="machine">
        <span class="machine-io">page {{ page }}</span>
        <span class="machine-arrow">→</span>
        <span class="machine-state" :class="`is-${machineState}`">{{ machineState }}</span>
        <span class="machine-arrow">→</span>
        <span class="machine-io">{{ statusLabel }}</span>
      </div>

      <div class="toolbar">
        <span class="status">{{ rangeText }}</span>
        <span class="status">{{ pageLabel }}</span>
      </div>

      <!-- (a) first-load spinner: loading and no rows yet -->
      <div v-if="firstLoading" class="spinner" aria-hidden="true"></div>

      <!-- (b) error -->
      <div v-else-if="values.error" class="error" role="alert">Failed to load. Try again.</div>

      <!-- (c) the list: keep showing during reloads, dim it via "stale". Only
           shown once rows exist, so hasData is guaranteed and `loading` alone
           drives the stale dimming — matching the other four demos. -->
      <ul v-else class="member-list" :class="{ stale: loading }">
        <li v-for="m in items" :key="m.id">
          <div class="member-item">
            <div class="member-main">
              <span class="member-name">{{ m.name }}</span>
              <span class="member-email">{{ m.email }}</span>
            </div>
            <div class="member-meta">
              <span class="member-date">{{ m.joinedAt }}</span>
              <span class="role-badge" :class="m.role">{{ m.role }}</span>
            </div>
          </div>
        </li>
      </ul>

      <nav class="pagination" aria-label="Pagination">
        <button class="page-btn" :disabled="isFirst" @click="prev">‹ Prev</button>
        <template v-for="tok in tokens" :key="tok.key">
          <span v-if="tok.kind === 'gap'" class="page-ellipsis">…</span>
          <button
            v-else
            class="page-btn"
            :class="{ active: tok.n === page }"
            :disabled="tok.n === page"
            :aria-current="tok.n === page ? 'page' : 'false'"
            @click="go(tok.n)"
          >{{ tok.n }}</button>
        </template>
        <button class="page-btn" :disabled="isLast" @click="next">Next ›</button>
      </nav>
    </div>

    <p class="note">
      Vue drives the headless <code>&lt;wcs-fetch&gt;</code> node declaratively: the
      <code>:url</code> is derived from <code>page</code>, and
      <code>@wc-bindable/vue</code>'s <code>useWcBindable</code> mirrors the element's
      <code>value</code> / <code>loading</code> / <code>error</code> into reactive
      state. The element refetches and aborts the previous request on its own — no
      <code>AbortController</code> glue. It hits the same shared
      <code>/api/items</code> server as the other four demos.
    </p>
  </div>
</template>
