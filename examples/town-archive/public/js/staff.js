// 整理台帳 — the cataloguers' table, written with @wcstack/signals (no @wcstack/state, no router).
// The I/O nodes are wcstack elements created with mountNode(); the definitions ride the module graph.
import "@wcstack/fetch/auto";
import "@wcstack/sse/auto";
import "@wcstack/resize/auto";
import {
  signal, computed, effect, createRoot, mountNode, bindNode, h, render, For, selector, delegateEvents,
} from "@wcstack/signals/dom";
import {
  ROW_PX, compareBy, sortRecords, filterRecords, reposition, visibleWindow, rangeIds, headerState, keepListed,
  moveIndex, scrollToKeep, formatUpdated,
} from "./lib/table.js";

const params = new URLSearchParams(location.search);
const delay = Number(params.get("delay")) > 0 ? `delay=${Number(params.get("delay"))}` : "";
const withDelay = (url) => (delay ? `${url}${url.includes("?") ? "&" : "?"}${delay}` : url);

// One listener per event type on the document for the rows' handlers (12,000 records, a few hundred
// rows at a time, each with handlers). Called before anything is built: elements made before the
// call keep their own listeners.
delegateEvents(["click", "dblclick", "keydown", "input", "focusin"]);

// ------------------------------------------------------------------ I/O nodes
const loader = mountNode("wcs-fetch", { attrs: { url: withDelay("/api/staff/photos") } });
const areasNode = mountNode("wcs-fetch", { attrs: { url: "/api/areas" } });
// One element per kind of change (one request at a time each).
const saveNode = mountNode("wcs-fetch", { attrs: { method: "PATCH", manual: true } });
const bulkNode = mountNode("wcs-fetch", { attrs: { url: withDelay("/api/staff/photos"), method: "PATCH", manual: true } });
const sse = mountNode("wcs-sse", { attrs: { url: "/api/staff/events", events: "updated,added" } });

// ------------------------------------------------------------------ data
const byId = new Map(); // id → the current version of each record
let loaded = false;
const sorted = signal([]); // every record, in the order shown
const sortKey = signal("id");
const sortDir = signal(1);
const filterText = signal("");
const filterArea = signal("");
const listed = computed(() => filterRecords(sorted.get(), filterText.get(), filterArea.get()));
const listedIds = computed(() => listed.get().map((r) => r.id));
const totalCount = computed(() => sorted.get().length);
const areaNames = computed(() => {
  const m = {};
  for (const a of areasNode.signals.value.get() ?? []) m[a.code] = a.name;
  return m;
});

const selected = signal(new Set()); // ids; a new Set on every change
let anchorId = null; // where the last checkbox click was (Shift+click selects from there)
const currentId = signal(null);
const editingId = signal(null);
const draft = signal("");
const editError = signal("");
const editorFocus = { want: false }; // the editor had the focus (give it back when its row comes back)
const notice = signal(""); // the result of a bulk change, or why it failed
const remoteNote = signal(""); // another staff member changed the record being edited

const scrollTop = signal(0);
const viewportH = signal(480);
const win = computed(
  () => visibleWindow(scrollTop.get(), viewportH.get(), listed.get().length),
  (a, b) => a.start === b.start && a.end === b.end,
);
const rows = computed(() => listed.get().slice(win.get().start, win.get().end));
const header = computed(() => headerState(listedIds.get(), selected.get()));

let body = null; // the scrolling element
let scrollQueued = false;

// ------------------------------------------------------------------ applying data
effect(() => {
  const v = loader.signals.value.get();
  if (loaded || !Array.isArray(v)) return;
  loaded = true;
  for (const r of v) byId.set(r.id, r);
  sorted.set(sortRecords(v, sortKey.peek(), sortDir.peek()));
  if (pending.length) flushRemote();
});

/** Records changed (the server's answer, or other staff's): put each where it belongs. */
function applyChanges(records) {
  const changed = records.filter((r) => {
    const old = byId.get(r.id);
    return !old || old.updatedAt !== r.updatedAt || old.title !== r.title || old.public !== r.public || old.tags.join() !== r.tags.join();
  });
  if (!changed.length) return;
  const anchor = topAnchor(new Set(changed.map((r) => r.id)));
  const cmp = compareBy(sortKey.peek(), sortDir.peek());
  let next = sorted.peek();
  if (changed.length > 50) {
    for (const r of changed) byId.set(r.id, r);
    next = sortRecords([...byId.values()], sortKey.peek(), sortDir.peek());
  } else {
    for (const r of changed) {
      const old = byId.get(r.id) ?? null;
      byId.set(r.id, r);
      next = reposition(next, old, r, cmp);
    }
  }
  sorted.set(next);
  if (editingId.peek() !== null && changed.some((r) => r.id === editingId.peek())) {
    remoteNote.set("このレコードは他の人が変更しました（入力中の文字はそのままです）");
  }
  keepAnchor(anchor);
}

/** The first row on the screen that is not among `changed`, and how far into it the view is. */
function topAnchor(changed) {
  const list = listed.peek();
  const st = body ? body.scrollTop : scrollTop.peek();
  let i = Math.floor(st / ROW_PX);
  while (i < list.length && changed.has(list[i].id)) i++;
  if (i >= list.length) return null;
  return { id: list[i].id, offset: st - i * ROW_PX };
}
/** After the order changed: scroll so that the anchor row is where it was (nothing jumps). */
function keepAnchor(anchor) {
  if (!anchor || !body) return;
  const i = listedIds.peek().indexOf(anchor.id);
  if (i < 0) return;
  const want = i * ROW_PX + anchor.offset;
  if (Math.abs(body.scrollTop - want) >= 1) {
    body.scrollTop = want;
    scrollTop.set(body.scrollTop);
  }
}

// Other staff's changes: each message is folded as it comes (on() sees every emit, even an equal
// one), and applied once per frame, so a burst of a thousand (a bulk change echoed back) is one update.
const pending = [];
let flushQueued = false;
function flushRemote() {
  flushQueued = false;
  if (!loaded || !pending.length) return;
  const batch = pending.splice(0);
  const latest = new Map();
  for (const r of batch) latest.set(r.id, r);
  applyChanges([...latest.values()]);
}
function safeParse(t) { try { return JSON.parse(t); } catch { return null; } }
sse.on("message", {
  initial: 0,
  fold: (n, msg) => {
    if (msg && (msg.event === "updated" || msg.event === "added")) {
      // <wcs-sse> has already parsed `data` as JSON (it would be the text with the `raw` attribute)
      const rec = typeof msg.data === "string" ? safeParse(msg.data) : msg.data;
      if (rec && typeof rec.id === "number") pending.push(rec);
      if (!flushQueued) { flushQueued = true; requestAnimationFrame(flushRemote); }
    }
    return n + 1;
  },
});

effect(() => {
  // a new sort: everything in the new order (the selection and the editor stay with their rows)
  const key = sortKey.get();
  const dir = sortDir.get();
  if (!loaded) return;
  sorted.set(sortRecords([...byId.values()], key, dir));
});

// ------------------------------------------------------------------ selection and the current row
const isSelected = (id) => selected.get().has(id);
function setSelected(next) { selected.set(next); }
function toggleOne(id, shift) {
  const sel = new Set(selected.peek());
  if (shift && anchorId !== null) {
    const want = !sel.has(id) || sel.has(anchorId);
    for (const x of rangeIds(listedIds.peek(), anchorId, id)) { if (want) sel.add(x); else sel.delete(x); }
  } else if (sel.has(id)) sel.delete(id);
  else sel.add(id);
  anchorId = id;
  setSelected(sel);
}
function toggleAll() {
  const sel = new Set(selected.peek());
  const ids = listedIds.peek();
  if (header.peek() === "all") for (const id of ids) sel.delete(id);
  else for (const id of ids) sel.add(id);
  setSelected(sel);
}
function setCurrent(id, keepInView = true) {
  currentId.set(id);
  if (!keepInView || !body || id === null) return;
  const i = listedIds.peek().indexOf(id);
  if (i < 0) return;
  const st = scrollToKeep(i, body.scrollTop, body.clientHeight);
  if (st !== body.scrollTop) { body.scrollTop = st; scrollTop.set(body.scrollTop); }
}

// ------------------------------------------------------------------ editing a title
function startEdit(id) {
  if (id === null || id === undefined) return;
  const r = byId.get(id);
  if (!r) return;
  if (editingId.peek() !== id) {
    draft.set(r.title);
    editError.set("");
    remoteNote.set("");
  }
  editorFocus.want = true;
  setCurrent(id);
  editingId.set(id);
}
function cancelEdit() {
  editingId.set(null);
  editError.set("");
  remoteNote.set("");
  editorFocus.want = false;
  body?.focus({ preventScroll: true });
}
async function saveEdit(id) {
  const title = draft.peek();
  saveNode.set("url", withDelay(`/api/staff/photos/${id}`));
  saveNode.set("body", { title }); // a new object each time: the body is used up by each request
  await saveNode.command("fetch");
  const el = saveNode.el;
  if (el.status === 200 && el.value) {
    applyChanges([el.value]);
    if (editingId.peek() === id) cancelEdit();
    return;
  }
  if (el.status === 422) {
    let msg = "保存できませんでした。";
    try { msg = JSON.parse(el.error?.body ?? "{}").errors?.title ?? msg; } catch { /* keep */ }
    editError.set(msg);
  } else {
    editError.set(`保存できませんでした（${el.status || "通信エラー"}）。`);
  }
}
function editor(id) {
  const input = h("input", {
    class: "title-editor",
    type: "text",
    value: draft.peek(),
    "aria-label": "タイトル",
    "aria-invalid": () => (editError.get() ? "true" : "false"),
    "aria-describedby": `edit-msg-${id}`,
    onInput: (e) => draft.set(e.target.value),
    onKeydown: (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); saveEdit(id); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
      else e.stopPropagation(); // typing is not the table's keyboard
    },
  });
  const wrap = h("span", { class: "editor" },
    input,
    h("span", { class: "edit-msg", id: `edit-msg-${id}`, role: "alert" }, () => editError.get() || remoteNote.get()),
  );
  if (editorFocus.want) {
    queueMicrotask(() => { if (input.isConnected) { input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); } });
  }
  return wrap;
}

// ------------------------------------------------------------------ bulk changes
async function bulk(patch, label) {
  const ids = [...selected.peek()];
  if (!ids.length) return;
  notice.set(`${ids.length.toLocaleString("ja-JP")} 件を変更しています…`);
  bulkNode.set("body", { ids, patch });
  await bulkNode.command("fetch");
  const el = bulkNode.el;
  if (el.status === 200 && Array.isArray(el.value?.updated)) {
    applyChanges(el.value.updated);
    notice.set(`${el.value.updated.length.toLocaleString("ja-JP")} 件を${label}`);
  } else {
    notice.set(`一括変更できませんでした（${el.status || "通信エラー"}）。選択はそのままです。`);
  }
}
function addTag() {
  if (!selected.peek().size) return;
  const tag = prompt("付けるタグを入力してください");
  if (tag === null || !tag.trim()) return;
  bulk({ addTag: tag.trim() }, `「${tag.trim()}」タグを付けました`);
}

// ------------------------------------------------------------------ keyboard on the table
function onTableKey(e) {
  if (e.target.closest?.(".title-editor")) return;
  const ids = listedIds.peek();
  const cur = currentId.peek();
  const index = cur === null ? -1 : ids.indexOf(cur);
  const pageRows = Math.max(1, Math.floor((body?.clientHeight ?? viewportH.peek()) / ROW_PX) - 1);
  const to = moveIndex(e.key, index, ids.length, pageRows);
  if (to !== null) { e.preventDefault(); setCurrent(ids[to]); return; }
  if (e.key === " " && cur !== null) { e.preventDefault(); toggleOne(cur, e.shiftKey); return; }
  if ((e.key === "Enter" || e.key === "F2") && cur !== null) { e.preventDefault(); startEdit(cur); }
}

// ------------------------------------------------------------------ the view
const COLS = [
  ["id", "ID"], ["title", "タイトル"], ["year", "年"], ["area", "地区"], ["tags", "タグ"], ["public", "公開"], ["updatedAt", "更新日時"],
];
function sortBy(key) {
  if (sortKey.peek() === key) sortDir.set(-sortDir.peek());
  else { sortKey.set(key); sortDir.set(1); }
}
const fmt = (n) => n.toLocaleString("ja-JP");

createRoot(() => {
  const isCurrent = selector(currentId);
  const isEditing = selector(editingId);

  function row(rec, index, current) {
    const id = rec.id; // the key: everything else is read through current()
    return h("div", {
      role: "row",
      class: () => `t-row${isCurrent(id) ? " current" : ""}${isSelected(id) ? " selected" : ""}`,
      "data-id": String(id),
      "aria-rowindex": () => String(win.get().start + index() + 2),
      "aria-selected": () => (isSelected(id) ? "true" : "false"),
      onClick: (e) => { if (!e.target.closest(".c-check, .editor")) setCurrent(id, false); },
      onDblclick: (e) => { if (!e.target.closest(".c-check, .editor")) startEdit(id); },
    },
      h("div", { role: "gridcell", class: "c-check" },
        h("input", {
          type: "checkbox", tabindex: "-1",
          checked: () => isSelected(id),
          "aria-label": () => `${current().title} を選択`,
          onClick: (e) => { toggleOne(id, e.shiftKey); currentId.set(id); },
        })),
      h("div", { role: "gridcell", class: "c-id" }, String(id)),
      h("div", { role: "gridcell", class: "c-title" }, () => (isEditing(id) ? editor(id) : current().title)),
      h("div", { role: "gridcell", class: "c-year" }, () => String(current().year)),
      h("div", { role: "gridcell", class: "c-area" }, () => areaNames.get()[current().area] ?? current().area),
      h("div", { role: "gridcell", class: "c-tags" }, () => current().tags.join("、")),
      h("div", { role: "gridcell", class: () => `c-public${current().public ? "" : " private"}` }, () => (current().public ? "公開" : "非公開")),
      h("div", { role: "gridcell", class: "c-updated" }, () => formatUpdated(current().updatedAt)),
    );
  }

  const headerBox = h("input", {
    type: "checkbox", class: "check-all", "aria-label": "表示中の行をすべて選択",
    checked: () => header.get() === "all",
    indeterminate: () => header.get() === "some",
    onClick: (e) => { e.preventDefault(); toggleAll(); },
  });

  const probe = h("wcs-resize", { target: "self", round: true, class: "body-probe" });
  const sizes = bindNode(probe);
  effect(() => { const hgt = sizes.signals.height.get(); if (hgt > 0) viewportH.set(hgt); });

  body = h("div", {
    class: "t-body", role: "rowgroup", tabindex: "0", "aria-label": "レコード（↑↓で移動、Space で選択、Enter で題名を編集）",
    "aria-activedescendant": () => (currentId.get() !== null ? `row-${currentId.get()}` : null),
    // Read in the next animation frame (still before that frame is drawn): moving the rows from inside
    // the scroll event makes Firefox warn about a "scroll-linked positioning effect".
    onScroll: () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => { scrollQueued = false; scrollTop.set(body.scrollTop); });
    },
    onKeydown: onTableKey,
  },
    h("div", { class: "t-spacer", style: () => ({ height: `${listed.get().length * ROW_PX}px` }) },
      h("div", { class: "t-rows", style: () => ({ transform: `translateY(${win.get().start * ROW_PX}px)` }) },
        For(rows, row, { key: (r) => r.id }))),
  );

  // Whether the editor has the focus, to give it back when its row is rendered again: a row that
  // leaves the window takes the focused input with it (focus falls to <body>, no focusin), while a
  // focus that moves anywhere else says so.
  const view = h("div", { class: "app", onFocusin: (e) => { editorFocus.want = !!e.target.closest?.(".title-editor"); } },
    h("header", { class: "t-header" },
      h("h1", null, "整理台帳"),
      h("div", { class: "t-filters" },
        h("label", null, h("span", { class: "vh" }, "題名・タグで絞り込み"),
          h("input", {
            type: "search", class: "t-filter", placeholder: "題名・タグで絞り込み",
            onInput: (e) => { if (!e.isComposing) applyFilter(e.target.value, filterArea.peek()); },
            onCompositionend: (e) => applyFilter(e.target.value, filterArea.peek()),
          })),
        h("label", null, h("span", { class: "lbl" }, "地区"),
          h("select", { class: "t-area", onChange: (e) => applyFilter(filterText.peek(), e.target.value) },
            h("option", { value: "" }, "すべて"),
            () => (areasNode.signals.value.get() ?? []).map((a) => h("option", { value: a.code }, a.name)))),
        h("span", { class: "t-count", "aria-live": "polite" }, () => (loaded || totalCount.get() ? `${fmt(totalCount.get())} 件中 ${fmt(listed.get().length)} 件` : "読み込み中…")),
        h("span", { class: "t-selcount" }, () => `${fmt(selected.get().size)} 件選択中`),
      ),
      h("div", { class: "t-bulk", role: "toolbar", "aria-label": "選択した行をまとめて変更" },
        h("button", { type: "button", disabled: () => selected.get().size === 0, onClick: () => bulk({ public: true }, "公開にしました") }, "公開にする"),
        h("button", { type: "button", disabled: () => selected.get().size === 0, onClick: () => bulk({ public: false }, "非公開にしました") }, "非公開にする"),
        h("button", { type: "button", disabled: () => selected.get().size === 0, onClick: addTag }, "タグを付ける…"),
        h("span", { class: "t-notice", role: "status" }, () => notice.get()),
      ),
    ),
    h("div", { class: "t-table", role: "grid", "aria-rowcount": () => String(listed.get().length + 1), "aria-multiselectable": "true" },
      h("div", { class: "t-head", role: "row", "aria-rowindex": "1" },
        h("div", { role: "columnheader", class: "c-check" }, headerBox),
        ...COLS.map(([key, label]) => h("div", {
          role: "columnheader", class: `c-${key === "updatedAt" ? "updated" : key}`,
          "aria-sort": () => (sortKey.get() === key ? (sortDir.get() > 0 ? "ascending" : "descending") : "none"),
        }, h("button", { type: "button", class: "sort", onClick: () => sortBy(key) }, label,
          h("span", { class: "sort-mark", "aria-hidden": "true" }, () => (sortKey.get() === key ? (sortDir.get() > 0 ? " ▲" : " ▼") : ""))))),
      ),
      h("div", { class: "t-body-wrap" }, probe, body),
    ),
  );
  const app = document.getElementById("app");
  app.replaceWith(view);
  view.id = "app";
});

// row ids for aria-activedescendant
effect(() => { void rows.get(); queueMicrotask(() => { for (const el of body?.querySelectorAll(".t-row") ?? []) el.id = `row-${el.dataset.id}`; }); });

function applyFilter(text, area) {
  filterText.set(text);
  filterArea.set(area);
  // filtering keeps selected only what is still listed
  setSelected(keepListed(selected.peek(), listedIds.peek()));
  if (body) { body.scrollTop = 0; scrollTop.set(0); }
}

// For the tests and the console: a small read-only view of the table's state.
globalThis.__staff = {
  get listed() { return listed.peek().length; },
  get selected() { return selected.peek().size; },
  get rowsInDocument() { return body ? body.querySelectorAll(".t-row").length : 0; },
  get editing() { return editingId.peek(); },
  get draft() { return draft.peek(); },
};
