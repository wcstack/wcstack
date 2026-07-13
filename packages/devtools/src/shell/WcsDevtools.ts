/**
 * shell/WcsDevtools.ts
 *
 * `<wcs-devtools>` — ページ内オーバーレイ DevTools 本体（devtools-tag-design.md）。
 *
 * - ShadowRoot 内で完結（ページの CSS/DOM を変更しない）
 * - ハイライトはページ要素の style/class を触らず、fixed 配置の
 *   オーバーレイ枠で描く（devtools-tag-design.md §2）
 * - UI レンダリングは vanilla DOM（記録済み決定: inspected ランタイムの
 *   updater キューに devtools 描画負荷を混ぜない = 観測者効果の排除。
 *   wcs-state ドッグフーディングは Phase 2 で再評価）
 * - 描画は Core の change 通知を rAF で 1 回に合流（イベント毎 DOM 追加禁止、
 *   devtools-tag-design.md §3.3）
 */

import { DevtoolsCore, IRosterEntry, ITimelineEntry, IWiringEntry } from "../core/DevtoolsCore";
import { formatValue } from "../core/formatValue";
import { IDeclaredBinding, scanDeclaredBindings } from "../core/declaredScan";

const STYLE_TEXT = /* css */ `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483647;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  inset: auto 0 0 auto;
}
* { box-sizing: border-box; }
.badge {
  position: fixed;
  right: 12px;
  bottom: 12px;
  width: 40px;
  height: 40px;
  border-radius: 20px;
  border: 1px solid #2b4f78;
  background: #10263f;
  color: #9fd0ff;
  font-weight: 700;
  cursor: pointer;
}
.panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  background: #0d1b2a;
  color: #d7e3f4;
  border: 1px solid #2b4f78;
  box-shadow: 0 0 24px rgba(0,0,0,.5);
}
.panel.dock-bottom { left: 0; right: 0; bottom: 0; height: 45vh; }
.panel.dock-right { top: 0; right: 0; bottom: 0; width: 420px; }
.panel[hidden] { display: none; }
header {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid #2b4f78;
  background: #10263f;
}
header .title { font-weight: 700; color: #9fd0ff; margin-right: 4px; }
header select, header button {
  font: inherit;
  background: #16324f;
  color: #d7e3f4;
  border: 1px solid #2b4f78;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}
header button[aria-pressed="true"] { background: #2b5d8f; }
header .spacer { flex: 1; }
.panes { display: flex; flex: 1; min-height: 0; }
.pane { flex: 1; min-width: 0; overflow: auto; padding: 6px 8px; border-right: 1px solid #1d3a5c; }
.pane:last-child { border-right: none; }
.pane h3 {
  margin: 0 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: #7ba7d4;
}
.tree-row { display: flex; gap: 6px; padding: 1px 0; align-items: baseline; white-space: nowrap; }
.tree-row .toggle { width: 14px; cursor: pointer; color: #7ba7d4; user-select: none; }
.tree-row .key { color: #9fd0ff; cursor: pointer; }
.tree-row .value { color: #ffd9a0; overflow: hidden; text-overflow: ellipsis; }
.tree-row .value.editable { cursor: pointer; }
.tree-row input { font: inherit; background: #16324f; color: #ffd9a0; border: 1px solid #2b4f78; }
.badge-tag {
  display: inline-block;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  background: #26456a;
  color: #a8c6e8;
}
.badge-tag.warn { background: #6a3326; color: #ffb3a0; }
.badge-tag.declared { background: #4a4426; color: #efe3a0; }
.wiring-row, .timeline-row { padding: 1px 0; white-space: nowrap; }
.wiring-row .prop { color: #b7f0c0; }
.wiring-row .path { color: #9fd0ff; }
.timeline-row .t { color: #6f88a3; }
.timeline-row .label { color: #9fd0ff; }
.timeline-row .detail { color: #ffd9a0; }
.timeline-row .kind { display: inline-block; min-width: 52px; text-align: center; }
.empty { color: #6f88a3; font-style: italic; padding: 4px 0; }
.notice { color: #efe3a0; padding: 2px 0 6px; }
.notice button { font: inherit; margin-left: 6px; cursor: pointer; }
.hl-box {
  position: fixed;
  pointer-events: none;
  border: 1px solid #58c2ff;
  background: rgba(88,194,255,.18);
}
`;

type PaneName = "state" | "wiring" | "timeline";

/** タイムラインの DOM 描画上限（buffer とは別。§3.3 のバースト圧縮の一部） */
const TIMELINE_RENDER_LIMIT = 200;
/** リスト展開の 1 階層あたり表示件数上限 */
const LIST_CHILD_LIMIT = 20;

interface ITreeNodeRef {
  readonly path: string;
  readonly indexes: number[];
}

function nodeKeyOf(ref: ITreeNodeRef): string {
  return `${ref.path}#${ref.indexes.join(",")}`;
}

function isExpandable(value: unknown): boolean {
  if (Array.isArray(value)) {
    return true;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function coerceInput(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export class WcsDevtools extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["open", "dock", "hotkey"];
  }

  private _core: DevtoolsCore | null = null;
  private _removeCoreListener: (() => void) | null = null;
  private _panel: HTMLElement | null = null;
  private _badge: HTMLButtonElement | null = null;
  private _stateSelect: HTMLSelectElement | null = null;
  private _paneElements: Partial<Record<PaneName, HTMLElement>> = {};
  private _highlightLayer: HTMLElement | null = null;
  private _dirtyPanes: Set<PaneName> = new Set();
  private _renderScheduled: boolean = false;
  private _selectedRosterKey: string | null = null;
  private _selectedPath: string | null = null;
  private _pickedNode: Node | null = null;
  private _pickMode: boolean = false;
  private _expanded: Set<string> = new Set();
  private _hotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private _pickHandler: ((event: MouseEvent) => void) | null = null;

  get core(): DevtoolsCore | null {
    return this._core;
  }

  connectedCallback(): void {
    // SSR では不活性（protocol 原則 6）
    if (document.documentElement.hasAttribute("data-wcs-server")) {
      return;
    }
    if (this.shadowRoot === null) {
      this._buildShadow();
    }
    const capacity = Number(this.getAttribute("buffer") ?? "");
    const hidden = (this.getAttribute("hidden-states") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    this._core = new DevtoolsCore({
      timelineCapacity: Number.isFinite(capacity) && capacity > 0 ? capacity : undefined,
      hiddenStateNames: hidden,
    });
    this._removeCoreListener = this._core.onChange((kind) => {
      if (kind === "roster" || kind === "sources") {
        this._markDirty("state");
        this._markDirty("wiring");
      } else if (kind === "wiring") {
        this._markDirty("wiring");
      } else {
        this._markDirty("timeline");
      }
    });
    this._core.connect();
    this._applyDock();
    this._applyOpen();
    this._installHotkey();
    this._markDirty("state");
    this._markDirty("wiring");
    this._markDirty("timeline");
  }

  disconnectedCallback(): void {
    this._removeCoreListener?.();
    this._removeCoreListener = null;
    this._core?.disconnect();
    this._core = null;
    this._uninstallHotkey();
    this._exitPickMode();
  }

  attributeChangedCallback(name: string): void {
    if (this.shadowRoot === null) {
      return;
    }
    if (name === "open") {
      this._applyOpen();
    } else if (name === "dock") {
      this._applyDock();
    } else if (name === "hotkey") {
      this._uninstallHotkey();
      this._installHotkey();
    }
  }

  /** テスト用: rAF を待たずに保留中の描画を実行する */
  __flushRenderForTest(): void {
    this._renderDirty();
  }

  // --- shadow construction ---

  private _buildShadow(): void {
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE_TEXT;
    shadow.append(style);

    const badge = document.createElement("button");
    badge.className = "badge";
    badge.title = "wcstack DevTools";
    badge.textContent = "WCS";
    badge.addEventListener("click", () => this.toggle());
    shadow.append(badge);
    this._badge = badge;

    const panel = document.createElement("div");
    panel.className = "panel dock-bottom";
    panel.hidden = true;

    const header = document.createElement("header");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = "wcstack devtools";
    header.append(title);

    const stateSelect = document.createElement("select");
    stateSelect.title = "state element";
    stateSelect.addEventListener("change", () => {
      this._selectedRosterKey = stateSelect.value || null;
      this._selectedPath = null;
      this._expanded.clear();
      this._markDirty("state");
      this._markDirty("wiring");
    });
    header.append(stateSelect);
    this._stateSelect = stateSelect;

    const pickButton = this._headerButton(header, "⌖ pick", "pick a page element");
    pickButton.addEventListener("click", () => {
      if (this._pickMode) {
        this._exitPickMode();
      } else {
        this._enterPickMode();
      }
      pickButton.setAttribute("aria-pressed", String(this._pickMode));
    });
    pickButton.dataset["role"] = "pick";

    const pauseButton = this._headerButton(header, "⏸", "pause timeline");
    pauseButton.addEventListener("click", () => {
      const core = this._core;
      if (core === null) {
        return;
      }
      core.paused = !core.paused;
      pauseButton.setAttribute("aria-pressed", String(core.paused));
    });
    pauseButton.dataset["role"] = "pause";

    const clearButton = this._headerButton(header, "🗑", "clear timeline");
    clearButton.addEventListener("click", () => {
      this._core?.clearTimeline();
    });
    clearButton.dataset["role"] = "clear";

    const spacer = document.createElement("span");
    spacer.className = "spacer";
    header.append(spacer);

    const dockButton = this._headerButton(header, "dock", "toggle dock position");
    dockButton.addEventListener("click", () => {
      const next = (this.getAttribute("dock") ?? "bottom") === "bottom" ? "right" : "bottom";
      this.setAttribute("dock", next);
    });
    dockButton.dataset["role"] = "dock";

    const closeButton = this._headerButton(header, "×", "close");
    closeButton.addEventListener("click", () => this.toggle(false));
    closeButton.dataset["role"] = "close";

    panel.append(header);

    const panes = document.createElement("div");
    panes.className = "panes";
    for (const [name, heading] of [
      ["state", "State"],
      ["wiring", "Wiring"],
      ["timeline", "Timeline"],
    ] as const) {
      const pane = document.createElement("section");
      pane.className = `pane pane-${name}`;
      const h3 = document.createElement("h3");
      h3.textContent = heading;
      const body = document.createElement("div");
      body.className = "pane-body";
      pane.append(h3, body);
      panes.append(pane);
      this._paneElements[name] = body;
    }
    panel.append(panes);
    shadow.append(panel);
    this._panel = panel;

    const highlightLayer = document.createElement("div");
    highlightLayer.className = "hl-layer";
    shadow.append(highlightLayer);
    this._highlightLayer = highlightLayer;
  }

  private _headerButton(header: HTMLElement, label: string, title: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-pressed", "false");
    header.append(button);
    return button;
  }

  // --- open/close/dock/hotkey ---

  get open(): boolean {
    return this.hasAttribute("open");
  }

  toggle(force?: boolean): void {
    const next = force ?? !this.open;
    if (next) {
      this.setAttribute("open", "");
    } else {
      this.removeAttribute("open");
    }
  }

  private _applyOpen(): void {
    // shadowRoot 構築後にしか呼ばれない（attributeChangedCallback 側でガード済み）
    this._panel!.hidden = !this.open;
    this._badge!.hidden = this.open;
    if (this.open) {
      this._markDirty("state");
      this._markDirty("wiring");
      this._markDirty("timeline");
    }
  }

  private _applyDock(): void {
    // shadowRoot 構築後にしか呼ばれない（attributeChangedCallback 側でガード済み）
    const dock = this.getAttribute("dock") === "right" ? "right" : "bottom";
    this._panel!.classList.toggle("dock-right", dock === "right");
    this._panel!.classList.toggle("dock-bottom", dock === "bottom");
  }

  private _installHotkey(): void {
    const spec = this.getAttribute("hotkey") ?? "Alt+Shift+D";
    if (spec === "none") {
      return;
    }
    const parts = spec.split("+").map((part) => part.trim().toLowerCase());
    const key = parts[parts.length - 1];
    const alt = parts.includes("alt");
    const shift = parts.includes("shift");
    const ctrl = parts.includes("ctrl");
    const meta = parts.includes("meta");
    this._hotkeyHandler = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === key &&
        event.altKey === alt &&
        event.shiftKey === shift &&
        event.ctrlKey === ctrl &&
        event.metaKey === meta
      ) {
        event.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener("keydown", this._hotkeyHandler);
  }

  private _uninstallHotkey(): void {
    if (this._hotkeyHandler !== null) {
      window.removeEventListener("keydown", this._hotkeyHandler);
      this._hotkeyHandler = null;
    }
  }

  // --- pick mode ---

  private _enterPickMode(): void {
    // 呼び出し元（pick ボタン）が toggle 済みのため、ここでは常に開始でよい
    this._pickMode = true;
    // click を capture で奪う（誤操作防止、devtools-tag-design.md G-U2 の既定側）
    this._pickHandler = (event: MouseEvent) => {
      const target = event.target as Node;
      // devtools 自身（実ブラウザでは retarget されて host、shadow 非 retarget 環境では
      // shadow 内ノード）は pick 対象外
      if (target.getRootNode() === this.shadowRoot || target === this) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this._pickedNode = target;
      this._selectedPath = null;
      this._exitPickMode();
      this._markDirty("wiring");
    };
    document.addEventListener("click", this._pickHandler, { capture: true });
  }

  private _exitPickMode(): void {
    if (this._pickHandler !== null) {
      document.removeEventListener("click", this._pickHandler, { capture: true });
      this._pickHandler = null;
    }
    this._pickMode = false;
    const pickButton = this.shadowRoot?.querySelector('button[data-role="pick"]');
    pickButton?.setAttribute("aria-pressed", "false");
  }

  // --- rendering ---

  private _markDirty(pane: PaneName): void {
    this._dirtyPanes.add(pane);
    if (this._renderScheduled) {
      return;
    }
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderDirty();
    });
  }

  private _renderDirty(): void {
    this._renderScheduled = false;
    if (this._core === null || this.shadowRoot === null) {
      this._dirtyPanes.clear();
      return;
    }
    const dirty = this._dirtyPanes;
    this._dirtyPanes = new Set();
    if (dirty.has("state")) {
      this._renderStatePane();
    }
    if (dirty.has("wiring")) {
      this._renderWiringPane();
    }
    if (dirty.has("timeline")) {
      this._renderTimelinePane();
    }
  }

  private _rosterKey(entry: IRosterEntry): string {
    return `${entry.sourceId}:${entry.name}`;
  }

  private _selectedRoster(): IRosterEntry | null {
    const core = this._core!;
    const roster = core.getRoster();
    if (roster.length === 0) {
      return null;
    }
    const found = roster.find((entry) => this._rosterKey(entry) === this._selectedRosterKey);
    return found ?? roster[0];
  }

  private _renderStatePane(): void {
    const core = this._core!;
    const body = this._paneElements["state"]!;
    const select = this._stateSelect!;
    const roster = core.getRoster();
    const selected = this._selectedRoster();

    select.replaceChildren(
      ...roster.map((entry) => {
        const option = document.createElement("option");
        option.value = this._rosterKey(entry);
        option.textContent = `${entry.name} (${entry.sourceId.slice(0, 12)})`;
        option.selected = selected !== null && this._rosterKey(entry) === this._rosterKey(selected);
        return option;
      })
    );

    body.replaceChildren();
    if (selected === null) {
      body.append(this._emptyRow("no <wcs-state> elements observed"));
      return;
    }
    this._selectedRosterKey = this._rosterKey(selected);
    const keys = core.keysOf(selected);
    if (keys.length === 0) {
      body.append(this._emptyRow("no readable keys (runtime without keys() API?)"));
      return;
    }
    for (const key of keys) {
      this._renderTreeNode(body, selected, { path: key, indexes: [] }, key, 0);
    }
  }

  private _renderTreeNode(
    container: HTMLElement,
    entry: IRosterEntry,
    ref: ITreeNodeRef,
    label: string,
    depth: number
  ): void {
    const core = this._core!;
    let value: unknown;
    let readable = true;
    try {
      value = core.readValue(entry, ref.path, ref.indexes);
    } catch {
      readable = false;
    }

    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.paddingLeft = `${depth * 14}px`;

    const expandable = readable && isExpandable(value);
    const key = nodeKeyOf(ref);
    const expanded = expandable && this._expanded.has(key);

    const toggle = document.createElement("span");
    toggle.className = "toggle";
    toggle.textContent = expandable ? (expanded ? "▾" : "▸") : "";
    if (expandable) {
      toggle.addEventListener("click", () => {
        if (this._expanded.has(key)) {
          this._expanded.delete(key);
        } else {
          this._expanded.add(key);
        }
        this._markDirty("state");
      });
    }
    row.append(toggle);

    const keySpan = document.createElement("span");
    keySpan.className = "key";
    keySpan.textContent = `${label}:`;
    keySpan.title = ref.path;
    keySpan.addEventListener("click", () => {
      this._selectedPath = ref.path;
      this._pickedNode = null;
      this._markDirty("wiring");
      this._highlightPath(entry, ref.path);
    });
    row.append(keySpan);

    const valueSpan = document.createElement("span");
    valueSpan.className = "value";
    if (!readable) {
      valueSpan.textContent = "(unreadable getter)";
    } else {
      valueSpan.textContent = formatValue(value, 1);
      const editable = value === null || typeof value !== "object";
      if (editable && typeof value !== "function") {
        valueSpan.classList.add("editable");
        valueSpan.title = "click to edit";
        valueSpan.addEventListener("click", () => {
          this._beginEdit(row, valueSpan, entry, ref, value);
        });
      }
    }
    row.append(valueSpan);
    container.append(row);

    if (expanded) {
      if (Array.isArray(value)) {
        const limit = Math.min(value.length, LIST_CHILD_LIMIT);
        for (let index = 0; index < limit; index++) {
          this._renderTreeNode(
            container,
            entry,
            { path: `${ref.path}.*`, indexes: [...ref.indexes, index] },
            `[${index}]`,
            depth + 1
          );
        }
        if (value.length > limit) {
          const more = this._emptyRow(`…(${value.length} items)`);
          more.style.paddingLeft = `${(depth + 1) * 14}px`;
          container.append(more);
        }
      } else {
        for (const childKey of Object.keys(value as Record<string, unknown>)) {
          this._renderTreeNode(
            container,
            entry,
            { path: `${ref.path}.${childKey}`, indexes: ref.indexes },
            childKey,
            depth + 1
          );
        }
      }
    }
  }

  private _beginEdit(
    row: HTMLElement,
    valueSpan: HTMLElement,
    entry: IRosterEntry,
    ref: ITreeNodeRef,
    current: unknown
  ): void {
    const input = document.createElement("input");
    input.value = typeof current === "string" ? current : String(current);
    const commit = (): void => {
      // 編集は通常のリアクティブパイプラインを通る（devtools-tag-design.md §3.1）
      this._core?.writeValue(entry, ref.path, coerceInput(input.value), ref.indexes);
      this._markDirty("state");
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        commit();
      } else if (event.key === "Escape") {
        this._markDirty("state");
      }
    });
    row.replaceChild(input, valueSpan);
    input.focus();
  }

  private _renderWiringPane(): void {
    const core = this._core!;
    const body = this._paneElements["wiring"]!;
    body.replaceChildren();

    let entries: IWiringEntry[];
    let contextLabel: string;
    if (this._pickedNode !== null) {
      entries = core.getWiringForNode(this._pickedNode);
      const target = this._pickedNode;
      contextLabel =
        target instanceof Element ? `<${target.tagName.toLowerCase()}>` : target.nodeName;
    } else if (this._selectedPath !== null) {
      const selected = this._selectedRoster();
      entries =
        selected !== null ? core.getWiringForPath(selected.name, this._selectedPath) : [];
      contextLabel = this._selectedPath;
    } else {
      entries = core.getAllWiring();
      contextLabel = "all";
    }

    const info = document.createElement("div");
    info.textContent = `context: ${contextLabel} — ${entries.length} live binding${entries.length === 1 ? "" : "s"}`;
    body.append(info);

    if (entries.length > 0) {
      for (const entry of entries) {
        body.append(this._wiringRow(entry));
      }
      return;
    }

    // ライブ台帳が空 → declared ビューへフォールバック（protocol §6）
    const selected = this._selectedRoster();
    const declared =
      selected !== null ? scanDeclaredBindings(this._scanRootOf(selected)) : [];
    if (declared.length === 0) {
      body.append(this._emptyRow("no bindings observed"));
      return;
    }
    const notice = document.createElement("div");
    notice.className = "notice";
    const tag = document.createElement("span");
    tag.className = "badge-tag declared";
    tag.textContent = "declared";
    notice.append(tag, document.createTextNode(" attached late — reload to capture live bindings "));
    const reload = document.createElement("button");
    reload.textContent = "reload";
    reload.addEventListener("click", () => {
      location.reload();
    });
    notice.append(reload);
    body.append(notice);
    for (const entry of declared) {
      body.append(this._declaredRow(entry));
    }
  }

  private _scanRootOf(entry: IRosterEntry): ParentNode {
    // instanceof はテスト環境（happy-dom）の Document 実体と一致しないことがあるため
    // nodeType で判定する（DOCUMENT_FRAGMENT_NODE は ShadowRoot を含む）
    const rootNode = entry.rootNode;
    if (
      rootNode.nodeType === Node.DOCUMENT_NODE ||
      rootNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE
    ) {
      return rootNode as unknown as ParentNode;
    }
    return document;
  }

  private _wiringRow(entry: IWiringEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "wiring-row";
    const prop = document.createElement("span");
    prop.className = "prop";
    prop.textContent = entry.propName;
    const arrow = document.createTextNode(" ← ");
    const path = document.createElement("span");
    path.className = "path";
    path.textContent = `${entry.path}@${entry.stateName}`;
    const type = document.createElement("span");
    type.className = "badge-tag";
    type.textContent = entry.bindingType;
    row.append(type, document.createTextNode(" "), prop, arrow, path);
    row.addEventListener("click", () => {
      const binding = entry.bindingRef.deref();
      if (binding !== undefined) {
        this._highlightNodes([binding.node, binding.replaceNode]);
      }
    });
    return row;
  }

  private _declaredRow(entry: IDeclaredBinding): HTMLElement {
    const row = document.createElement("div");
    row.className = "wiring-row";
    const type = document.createElement("span");
    type.className = "badge-tag declared";
    type.textContent = entry.origin;
    const prop = document.createElement("span");
    prop.className = "prop";
    prop.textContent = entry.propName;
    const path = document.createElement("span");
    path.className = "path";
    path.textContent = `${entry.path}@${entry.stateName}`;
    row.append(type, document.createTextNode(" "), prop, document.createTextNode(" ← "), path);
    row.addEventListener("click", () => {
      this._highlightNodes([entry.element]);
    });
    return row;
  }

  private _renderTimelinePane(): void {
    const core = this._core!;
    const body = this._paneElements["timeline"]!;
    const timeline = core.getTimeline();
    const start = Math.max(0, timeline.length - TIMELINE_RENDER_LIMIT);
    const rows: HTMLElement[] = [];
    if (start > 0) {
      rows.push(this._emptyRow(`…(${start} earlier entries)`));
    }
    for (let index = start; index < timeline.length; index++) {
      rows.push(this._timelineRow(timeline[index]));
    }
    if (rows.length === 0) {
      rows.push(this._emptyRow("no activity yet"));
    }
    body.replaceChildren(...rows);
    body.scrollTop = body.scrollHeight;
  }

  private _timelineRow(entry: ITimelineEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "timeline-row";
    const time = document.createElement("span");
    time.className = "t";
    time.textContent = `${(entry.time / 1000).toFixed(3)}s `;
    const kind = document.createElement("span");
    kind.className = "badge-tag kind";
    kind.textContent = entry.kind;
    // subscriber 0 の command/event 空撃ちは警告表示（devtools-tag-design.md §3.2）
    if (entry.subscriberCount === 0) {
      kind.classList.add("warn");
      kind.title = "emitted with no subscribers";
    }
    const label = document.createElement("span");
    label.className = "label";
    const stateName = entry.stateName !== null ? `@${entry.stateName}` : "";
    label.textContent = ` ${entry.label}${stateName} `;
    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = entry.detail;
    row.append(time, kind, label, detail);
    return row;
  }

  private _emptyRow(text: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "empty";
    row.textContent = text;
    return row;
  }

  // --- highlight ---

  private _highlightPath(entry: IRosterEntry, path: string): void {
    const core = this._core!;
    const nodes: Node[] = [];
    for (const wiring of core.getWiringForPath(entry.name, path)) {
      const binding = wiring.bindingRef.deref();
      if (binding !== undefined) {
        nodes.push(binding.node, binding.replaceNode);
      }
    }
    this._highlightNodes(nodes);
  }

  private _highlightNodes(nodes: readonly Node[]): void {
    // shadowRoot 構築後にしか呼ばれない（各リスナーは _buildShadow 内で配線される）
    const layer = this._highlightLayer!;
    layer.replaceChildren();
    const seen = new Set<Element>();
    for (const node of nodes) {
      const element = node instanceof Element ? node : node.parentElement;
      if (element === null || seen.has(element) || !element.isConnected) {
        continue;
      }
      seen.add(element);
      const rect = element.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "hl-box";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      layer.append(box);
    }
    // 2 秒後に自動で消す（追従はしない — クリック時スナップショット表示）
    setTimeout(() => {
      layer.replaceChildren();
    }, 2000);
  }
}
