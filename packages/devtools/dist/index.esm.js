/**
 * protocol/types.ts
 *
 * DevTools Hook Protocol (docs/devtools-hook-protocol.md) の devtools 側型定義。
 *
 * ランタイム（@wcstack/state）側の内部型は import しない — プロトコルは
 * 「文書化された構造」への構造的型付けで両側が独立に実装する（protocol §2）。
 * そのためランタイム内部オブジェクトは *Like インターフェースとして、
 * devtools が実際に触るプロパティだけを宣言する。
 */
/** グローバル registry のプロパティ名 */
const DEVTOOLS_HOOK_GLOBAL = "__WCSTACK_DEVTOOLS_HOOK__";
/** プロトコル版。additive change では上げない（protocol §2） */
const DEVTOOLS_PROTOCOL_VERSION = 1;

/**
 * protocol/registry.ts
 *
 * registry 最小実装の devtools 側コピー（protocol §2）。
 * ロード順非依存にするため、ランタイム側（@wcstack/state の bridge）と
 * devtools 側の両方が同一仕様の最小実装を持ち、先にロードされた方が
 * globalThis に置く（先勝ち・振る舞い差し替えなし）。
 */
function createMinimalRegistry() {
    const sources = new Map();
    const listeners = new Set();
    const applySink = (source) => {
        if (listeners.size === 0) {
            source._setSink(null);
            return;
        }
        const sourceId = source.id;
        source._setSink((event) => {
            for (const listener of listeners) {
                listener.onEvent?.(sourceId, event);
            }
        });
    };
    return {
        version: DEVTOOLS_PROTOCOL_VERSION,
        sources,
        register(source) {
            if (sources.has(source.id)) {
                return;
            }
            sources.set(source.id, source);
            applySink(source);
            for (const listener of listeners) {
                listener.onSourceRegistered?.(source);
            }
        },
        unregister(sourceId) {
            const source = sources.get(sourceId);
            if (source === undefined) {
                return;
            }
            source._setSink(null);
            sources.delete(sourceId);
            for (const listener of listeners) {
                listener.onSourceUnregistered?.(sourceId);
            }
        },
        addListener(listener) {
            listeners.add(listener);
            for (const source of sources.values()) {
                applySink(source);
                listener.onSourceRegistered?.(source);
            }
            return () => {
                if (!listeners.delete(listener)) {
                    return;
                }
                for (const source of sources.values()) {
                    applySink(source);
                }
            };
        },
    };
}
function getOrCreateHookRegistry() {
    const globals = globalThis;
    const existing = globals[DEVTOOLS_HOOK_GLOBAL];
    if (existing !== undefined) {
        if (existing.version !== DEVTOOLS_PROTOCOL_VERSION) {
            // 先勝ち固定。振る舞いは差し替えない（protocol §2）
            console.warn(`[wcstack/devtools] hook registry version mismatch: found ${existing.version}, expected ${DEVTOOLS_PROTOCOL_VERSION}. Keeping the existing registry (first-wins).`);
        }
        return existing;
    }
    const registry = createMinimalRegistry();
    globals[DEVTOOLS_HOOK_GLOBAL] = registry;
    return registry;
}

/**
 * core/formatValue.ts
 *
 * 値フォーマッタ（devtools-tag-design.md §6）。
 *
 * 規範:
 * - primitive はそのまま（文字列は引用 + 80 文字上限）
 * - 配列 / plain object は深さ制限 + 要素数制限つきの要約
 * - それ以外（MediaStream, Blob, Element, class インスタンス等）は
 *   `[[ClassName]]` タグ表示のみ
 * - structuredClone / JSON.stringify を全値に無差別適用しない
 *   （生ハンドル・循環・巨大値対策。camera G1 との共存）
 */
const MAX_STRING = 80;
const MAX_ITEMS = 3;
function isPlainObject(value) {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
function className(value) {
    const ctor = value.constructor;
    const name = ctor?.name;
    return typeof name === "string" && name.length > 0 ? name : "Object";
}
/**
 * 任意の値を表示用の短い文字列へ変換する。
 * @param value 対象値
 * @param depth 再帰許容深さ（既定 2。0 で複合値は要約タグのみ）
 */
function formatValue(value, depth = 2) {
    switch (typeof value) {
        case "string": {
            const body = value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…" : value;
            return `"${body}"`;
        }
        case "number":
        case "boolean":
        case "bigint":
            return String(value);
        case "symbol":
            return value.toString();
        case "undefined":
            return "undefined";
        case "function":
            return "[[Function]]";
    }
    if (value === null) {
        return "null";
    }
    const objectValue = value;
    if (Array.isArray(objectValue)) {
        if (depth <= 0) {
            return `[[Array(${objectValue.length})]]`;
        }
        const shown = objectValue.slice(0, MAX_ITEMS).map((item) => formatValue(item, depth - 1));
        const rest = objectValue.length > MAX_ITEMS ? `, …(${objectValue.length})` : "";
        return `[${shown.join(", ")}${rest}]`;
    }
    if (isPlainObject(objectValue)) {
        if (depth <= 0) {
            return "[[Object]]";
        }
        const keys = Object.keys(objectValue);
        const shown = keys.slice(0, MAX_ITEMS).map((key) => `${key}: ${formatValue(objectValue[key], depth - 1)}`);
        const rest = keys.length > MAX_ITEMS ? `, …(${keys.length})` : "";
        return `{${shown.join(", ")}${rest}}`;
    }
    // DOM ノード・生ハンドル・class インスタンス等はタグ表示のみ
    return `[[${className(objectValue)}]]`;
}
/**
 * throw された値の要約。
 *
 * `formatValue` は class インスタンスを `[[ClassName]]` に畳むため、Error に
 * そのまま使うと **最も知りたい message が消える**（`[[Error]]` だけになる）。
 * Error 形（name / message を持つ）だけは `Name: message` に開く。
 * 非 Error の throw（文字列・オブジェクト等）は通常の要約へ倒す。
 */
function formatError(error) {
    if (error !== null && typeof error === "object") {
        const { name, message } = error;
        if (typeof message === "string") {
            const label = typeof name === "string" && name.length > 0 ? name : className(error);
            const body = message.length > MAX_STRING ? message.slice(0, MAX_STRING) + "…" : message;
            return body.length > 0 ? `${label}: ${body}` : label;
        }
    }
    return formatValue(error, 1);
}
/**
 * token 引数の要約（先頭 3 引数 × 各 80 文字上限、devtools-tag-design.md §6）。
 */
function formatArgs(args) {
    if (args.length === 0) {
        return "";
    }
    const shown = args.slice(0, MAX_ITEMS).map((arg) => {
        const text = formatValue(arg, 1);
        return text.length > MAX_STRING ? text.slice(0, MAX_STRING) + "…" : text;
    });
    const rest = args.length > MAX_ITEMS ? `, …(${args.length})` : "";
    return `${shown.join(", ")}${rest}`;
}

/**
 * core/DevtoolsCore.ts
 *
 * hook client（devtools-tag-design.md §1）。DOM 非依存の純ロジック層。
 *
 * - registry への addListener / 解除（connect / disconnect）
 * - source 管理と roster（state 要素一覧）の維持
 * - 配線台帳（binding-added/removed イベントから構築。binding は WeakRef 保持）
 * - タイムライン ring buffer（既定 500 件 FIFO）
 * - 予約 prefix `wcs-devtools` の自己除外（protocol §5）
 *
 * 台帳はすべて devtools 側に置く（protocol 原則 2）。disconnect で
 * sources / roster / wiring をクリアし、残留参照を持たない。
 */
/** 予約 state 名 prefix（protocol §5）。この prefix の要素・イベントは常に除外 */
const RESERVED_STATE_NAME_PREFIX = "wcs-devtools";
const DEFAULT_TIMELINE_CAPACITY = 500;
function pathKeyOf(stateName, path) {
    return stateName + "\u0000" + path;
}
class DevtoolsCore {
    _timelineCapacity;
    _hiddenStateNames;
    _removeListener = null;
    _sources = new Map();
    _roster = new Map();
    _wiringByPathKey = new Map();
    _wiringEntryByBinding = new WeakMap();
    _timeline = [];
    _seq = 0;
    _paused = false;
    _changeListeners = new Set();
    constructor(options) {
        this._timelineCapacity = options?.timelineCapacity ?? DEFAULT_TIMELINE_CAPACITY;
        this._hiddenStateNames = new Set(options?.hiddenStateNames ?? []);
    }
    get connected() {
        return this._removeListener !== null;
    }
    get paused() {
        return this._paused;
    }
    set paused(value) {
        this._paused = value;
    }
    /** 表示から除外する state 名か（予約 prefix + hiddenStateNames、protocol §5） */
    isHiddenStateName(name) {
        if (name === null) {
            return false;
        }
        return name.startsWith(RESERVED_STATE_NAME_PREFIX) || this._hiddenStateNames.has(name);
    }
    connect() {
        if (this._removeListener !== null) {
            return;
        }
        const registry = getOrCreateHookRegistry();
        this._removeListener = registry.addListener({
            onSourceRegistered: (source) => {
                this._sources.set(source.id, source);
                this._refreshRosterOf(source);
                this._notify("sources");
            },
            onSourceUnregistered: (sourceId) => {
                this._sources.delete(sourceId);
                this._roster.delete(sourceId);
                this._notify("sources");
                this._notify("roster");
            },
            onEvent: (sourceId, event) => {
                this._ingest(sourceId, event);
            },
        });
    }
    /** 購読解除 + 台帳クリア（タイムラインは保持。protocol §7-2 の残留ゼロ） */
    disconnect() {
        if (this._removeListener === null) {
            return;
        }
        this._removeListener();
        this._removeListener = null;
        this._sources.clear();
        this._roster.clear();
        this._wiringByPathKey.clear();
        this._wiringEntryByBinding = new WeakMap();
        this._notify("sources");
        this._notify("roster");
        this._notify("wiring");
    }
    onChange(listener) {
        this._changeListeners.add(listener);
        return () => {
            this._changeListeners.delete(listener);
        };
    }
    getSources() {
        return [...this._sources.values()];
    }
    getRoster() {
        const entries = [];
        for (const list of this._roster.values()) {
            entries.push(...list);
        }
        return entries;
    }
    /** 全 source の state 要素一覧を pull で取り直す */
    refreshRoster() {
        for (const source of this._sources.values()) {
            this._refreshRosterOf(source);
        }
        this._notify("roster");
    }
    getTimeline() {
        return this._timeline;
    }
    clearTimeline() {
        this._timeline = [];
        this._notify("timeline");
    }
    /** 指定パスに束縛された配線（生存している binding のみ） */
    getWiringForPath(stateName, path) {
        const set = this._wiringByPathKey.get(pathKeyOf(stateName, path));
        if (set === undefined) {
            return [];
        }
        return this._collectAlive(set);
    }
    /** 全配線のスナップショット（生存している binding のみ） */
    getAllWiring() {
        const result = [];
        for (const set of this._wiringByPathKey.values()) {
            result.push(...this._collectAlive(set));
        }
        return result;
    }
    /** 指定ノード（またはその子孫のバインドノード）に載る配線 */
    getWiringForNode(node) {
        const result = [];
        for (const set of this._wiringByPathKey.values()) {
            for (const entry of this._collectAlive(set)) {
                const binding = entry.bindingRef.deref();
                if (binding.node === node ||
                    binding.replaceNode === node ||
                    node.contains(binding.node) ||
                    node.contains(binding.replaceNode)) {
                    result.push(entry);
                }
            }
        }
        return result;
    }
    /** roster entry の state からトップレベルキーを列挙（keys 未実装ランタイムは空） */
    keysOf(entry) {
        const source = this._sources.get(entry.sourceId);
        if (source === undefined || typeof source.keys !== "function") {
            return [];
        }
        return source.keys(entry.name, entry.rootNode);
    }
    readValue(entry, path, indexes) {
        const source = this._sources.get(entry.sourceId);
        if (source === undefined) {
            return undefined;
        }
        return source.read(entry.name, entry.rootNode, path, indexes);
    }
    writeValue(entry, path, value, indexes) {
        const source = this._sources.get(entry.sourceId);
        if (source === undefined) {
            return;
        }
        source.write(entry.name, entry.rootNode, path, value, indexes);
    }
    // --- internal ---
    _notify(kind) {
        for (const listener of this._changeListeners) {
            listener(kind);
        }
    }
    _refreshRosterOf(source) {
        const entries = [];
        for (const summary of source.getStateElements()) {
            if (this.isHiddenStateName(summary.name)) {
                continue;
            }
            entries.push({
                sourceId: source.id,
                name: summary.name,
                rootNode: summary.rootNode,
                summary,
            });
        }
        this._roster.set(source.id, entries);
    }
    _collectAlive(set) {
        const alive = [];
        for (const entry of set) {
            if (entry.bindingRef.deref() === undefined) {
                // GC 済み binding は遅延剪定（detach 漏れで DOM を残さないための WeakRef 側）
                set.delete(entry);
                continue;
            }
            alive.push(entry);
        }
        return alive;
    }
    _appendTimeline(entry) {
        if (this._paused) {
            return;
        }
        this._timeline.push({
            ...entry,
            seq: this._seq++,
            time: performance.now(),
        });
        const overflow = this._timeline.length - this._timelineCapacity;
        if (overflow > 0) {
            this._timeline.splice(0, overflow);
        }
        this._notify("timeline");
    }
    _labelOf(address) {
        const indexes = address.listIndex?.indexes;
        const path = address.absolutePathInfo.pathInfo.path;
        return indexes !== undefined ? `${path}[${indexes.join(",")}]` : path;
    }
    _ingest(sourceId, event) {
        switch (event.type) {
            case "state:element-registered": {
                if (this.isHiddenStateName(event.name)) {
                    return;
                }
                const source = this._sources.get(sourceId);
                if (source !== undefined) {
                    this._refreshRosterOf(source);
                    this._notify("roster");
                }
                this._appendTimeline({
                    sourceId,
                    kind: "element-registered",
                    stateName: event.name,
                    label: event.name,
                    detail: "",
                    subscriberCount: null,
                });
                return;
            }
            case "state:element-unregistered": {
                if (this.isHiddenStateName(event.name)) {
                    return;
                }
                const source = this._sources.get(sourceId);
                if (source !== undefined) {
                    this._refreshRosterOf(source);
                    this._notify("roster");
                }
                this._appendTimeline({
                    sourceId,
                    kind: "element-unregistered",
                    stateName: event.name,
                    label: event.name,
                    detail: "",
                    subscriberCount: null,
                });
                return;
            }
            case "state:write": {
                const stateName = event.absoluteAddress.absolutePathInfo.stateName;
                if (this.isHiddenStateName(stateName)) {
                    return;
                }
                const detail = event.hasOldValue
                    ? `${formatValue(event.value)} (was ${formatValue(event.oldValue)})`
                    : formatValue(event.value);
                this._appendTimeline({
                    sourceId,
                    kind: "write",
                    stateName,
                    label: this._labelOf(event.absoluteAddress),
                    detail,
                    subscriberCount: null,
                });
                return;
            }
            case "state:update-batch": {
                const labels = [];
                let total = 0;
                for (const address of event.addresses) {
                    if (this.isHiddenStateName(address.absolutePathInfo.stateName)) {
                        continue;
                    }
                    total++;
                    if (labels.length < 3) {
                        labels.push(this._labelOf(address));
                    }
                }
                if (total === 0) {
                    return;
                }
                const rest = total > labels.length ? `, …(${total})` : "";
                this._appendTimeline({
                    sourceId,
                    kind: "batch",
                    stateName: null,
                    label: `${total} address${total === 1 ? "" : "es"}`,
                    detail: `${labels.join(", ")}${rest}`,
                    subscriberCount: null,
                });
                return;
            }
            case "state:binding-added": {
                const stateName = event.absoluteAddress.absolutePathInfo.stateName;
                if (this.isHiddenStateName(stateName)) {
                    return;
                }
                const path = event.absoluteAddress.absolutePathInfo.pathInfo.path;
                const key = pathKeyOf(stateName, path);
                let set = this._wiringByPathKey.get(key);
                if (set === undefined) {
                    set = new Set();
                    this._wiringByPathKey.set(key, set);
                }
                const entry = {
                    sourceId,
                    stateName,
                    path,
                    propName: event.binding.propName,
                    bindingType: event.binding.bindingType,
                    bindingRef: new WeakRef(event.binding),
                };
                set.add(entry);
                this._wiringEntryByBinding.set(event.binding, entry);
                this._notify("wiring");
                return;
            }
            case "state:binding-removed": {
                const entry = this._wiringEntryByBinding.get(event.binding);
                if (entry === undefined) {
                    return;
                }
                this._wiringEntryByBinding.delete(event.binding);
                const key = pathKeyOf(entry.stateName, entry.path);
                const set = this._wiringByPathKey.get(key);
                if (set !== undefined) {
                    set.delete(entry);
                    if (set.size === 0) {
                        this._wiringByPathKey.delete(key);
                    }
                }
                this._notify("wiring");
                return;
            }
            case "state:binding-cleared": {
                const stateName = event.absoluteAddress.absolutePathInfo.stateName;
                const path = event.absoluteAddress.absolutePathInfo.pathInfo.path;
                const key = pathKeyOf(stateName, path);
                if (this._wiringByPathKey.delete(key)) {
                    this._notify("wiring");
                }
                return;
            }
            case "state:token-emit": {
                if (this.isHiddenStateName(event.stateName)) {
                    return;
                }
                this._appendTimeline({
                    sourceId,
                    kind: event.kind,
                    stateName: event.stateName,
                    label: event.tokenName,
                    detail: formatArgs(event.args),
                    subscriberCount: event.subscriberCount,
                });
                return;
            }
            case "state:watch-error": {
                if (this.isHiddenStateName(event.stateName)) {
                    return;
                }
                // ランタイム側は例外を握って drain を守るため、ここに出ないと失敗が
                // どこにも現れない（console を見ていない限り）。phase を detail の先頭に
                // 置くのは、getter の評価失敗とハンドラの失敗で直し方が違うため。
                this._appendTimeline({
                    sourceId,
                    kind: "watch-error",
                    stateName: event.stateName,
                    label: event.path,
                    detail: `${event.phase}: ${formatError(event.error)}`,
                    subscriberCount: null,
                });
                return;
            }
            case "state:watch-chain-limit": {
                this._appendTimeline({
                    sourceId,
                    kind: "watch-chain-limit",
                    stateName: null,
                    // 打ち切りはバッチ単位で state 名を持たない（複数 state のアドレスが
                    // 載りうる）ため、hidden 判定はここでは行わない。
                    label: `depth > ${event.maxDepth}`,
                    detail: event.paths.join(", "),
                    subscriberCount: null,
                });
                return;
            }
            case "propagation:suppressed": {
                // two-way エコーの辺単位抑止。state 名を持たない（node+member が主語）
                // ため hidden 判定はここでは行わない。
                this._appendTimeline({
                    sourceId,
                    kind: "propagation-suppressed",
                    stateName: null,
                    label: event.member,
                    detail: `${event.reason} (tx ${event.transactionId}, edge ${event.edgeId})`,
                    subscriberCount: null,
                });
                return;
            }
            case "propagation:coalesced": {
                const stateName = event.absoluteAddress.absolutePathInfo.stateName;
                if (this.isHiddenStateName(stateName)) {
                    return;
                }
                this._appendTimeline({
                    sourceId,
                    kind: "propagation-coalesced",
                    stateName,
                    label: this._labelOf(event.absoluteAddress),
                    detail: `tx ${event.droppedTransactionId} dropped (winner tx ${event.winnerTransactionId})`,
                    subscriberCount: null,
                });
                return;
            }
            case "propagation:hop-limit": {
                const stateName = event.absoluteAddress.absolutePathInfo.stateName;
                if (this.isHiddenStateName(stateName)) {
                    return;
                }
                this._appendTimeline({
                    sourceId,
                    kind: "propagation-hop-limit",
                    stateName,
                    label: this._labelOf(event.absoluteAddress),
                    detail: `hop ${event.hop} (tx ${event.transactionId})`,
                    subscriberCount: null,
                });
                return;
            }
            case "contract:drift": {
                // sidecar と live wcBindable の乖離。live が正本（wcstack-manifest-schema.md）。
                // sidecarEvent / liveEvent は型上 optional（reason と結合されていない構造的
                // 型付け）のため、欠落 payload でも "undefined" を表示しない防御を入れる。
                const memberPart = event.member !== undefined ? `: ${event.member}` : "";
                const eventPart = event.reason === "event-mismatch"
                    ? ` (sidecar ${event.sidecarEvent ?? "?"} / live ${event.liveEvent ?? "?"})`
                    : "";
                this._appendTimeline({
                    sourceId,
                    kind: "contract-drift",
                    stateName: null,
                    label: event.tag,
                    detail: `${event.reason}${memberPart}${eventPart}`,
                    subscriberCount: null,
                });
                return;
            }
            case "contract:manifest-read":
            case "contract:unsupported-extension": {
                // 情報イベント。contract analyzer の戻り値 API から取得でき、timeline は
                // 活動ログに絞る（static-wiring-dx-design.md §6 の行 4 種）。union に
                // 載せることで「型に無いイベントを黙って捨てる」状態だけを解消する。
                return;
            }
        }
    }
}

/**
 * core/declaredScan.ts
 *
 * 遅延アタッチ時の declared ビュー（protocol §6）。
 *
 * binding 台帳はフック接続前の分を復元できないため、DOM に残っている
 * `data-wcs` 属性と `<!--wcs-*: -->` コメントを再スキャンして
 * 「宣言レベルの配線ビュー」を組む。ライブ台帳と違い binding 実体・
 * 接続状態は分からない（UI では "declared" バッジで区別する）。
 *
 * パースは表示目的の簡易版（`prop[#mod]: path[@state][|filters]` を
 * `;` 区切りで分解するだけ）。正確なセマンティクスの正本は
 * @wcstack/state の bindTextParser であり、ここでは追随しない。
 */
const DEFAULT_BIND_ATTRIBUTE = "data-wcs";
const COMMENT_PREFIXES = ["wcs-text", "wcs-for", "wcs-if", "wcs-elseif", "wcs-else"];
function parseEntry(element, raw, origin) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const colon = trimmed.indexOf(":");
    if (colon < 0) {
        return null;
    }
    const propName = trimmed.slice(0, colon).trim();
    const rhs = trimmed.slice(colon + 1).trim();
    if (propName.length === 0 || rhs.length === 0) {
        return null;
    }
    const [pathPart, ...filterParts] = rhs.split("|").map((part) => part.trim());
    let path = pathPart;
    let stateName = "default";
    const at = pathPart.lastIndexOf("@");
    if (at > 0) {
        path = pathPart.slice(0, at).trim();
        stateName = pathPart.slice(at + 1).trim();
    }
    return {
        element,
        propName,
        path,
        stateName,
        filters: filterParts.filter((part) => part.length > 0),
        origin,
        raw: trimmed,
    };
}
/**
 * rootNode 配下の宣言配線を列挙する。
 * @param root 走査起点（Document / ShadowRoot / Element）
 * @param bindAttributeName バインド属性名（既定 data-wcs。setConfig で変えたページ用）
 */
function scanDeclaredBindings(root, bindAttributeName = DEFAULT_BIND_ATTRIBUTE) {
    const result = [];
    // data-wcs 属性（template の for/if 宣言もこの属性に載る）
    for (const element of root.querySelectorAll(`[${bindAttributeName}]`)) {
        // querySelectorAll の一致条件上、属性は必ず存在する
        const raw = element.getAttribute(bindAttributeName);
        for (const part of raw.split(";")) {
            const entry = parseEntry(element, part, "attribute");
            if (entry !== null) {
                result.push(entry);
            }
        }
    }
    // <!--wcs-text: path--> 等のコメントノード（mustache 展開後の姿）
    const document = root.ownerDocument ?? root;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    let comment = walker.nextNode();
    while (comment !== null) {
        // コメントノードの textContent は常に文字列
        const text = comment.textContent.trim();
        const prefix = COMMENT_PREFIXES.find((candidate) => text === candidate || text.startsWith(candidate + ":"));
        if (prefix !== undefined) {
            const parentElement = comment.parentNode instanceof Element ? comment.parentNode : null;
            if (parentElement !== null) {
                const body = text === prefix ? "" : text.slice(prefix.length + 1).trim();
                if (body.length > 0) {
                    const propName = prefix === "wcs-text" ? "textContent" : prefix.slice("wcs-".length);
                    // propName / body とも非空のため parseEntry は必ず成功する
                    result.push(parseEntry(parentElement, `${propName}: ${body}`, "comment"));
                }
            }
        }
        comment = walker.nextNode();
    }
    return result;
}

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
/** タイムラインの DOM 描画上限（buffer とは別。§3.3 のバースト圧縮の一部） */
const TIMELINE_RENDER_LIMIT = 200;
/** リスト展開の 1 階層あたり表示件数上限 */
const LIST_CHILD_LIMIT = 20;
function nodeKeyOf(ref) {
    return `${ref.path}#${ref.indexes.join(",")}`;
}
function isExpandable(value) {
    if (Array.isArray(value)) {
        return true;
    }
    if (value === null || typeof value !== "object") {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
function coerceInput(text) {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return text;
    }
}
class WcsDevtools extends HTMLElement {
    static get observedAttributes() {
        return ["open", "dock", "hotkey"];
    }
    _core = null;
    _removeCoreListener = null;
    _panel = null;
    _badge = null;
    _stateSelect = null;
    _paneElements = {};
    _highlightLayer = null;
    _dirtyPanes = new Set();
    _renderScheduled = false;
    _selectedRosterKey = null;
    _selectedPath = null;
    _pickedNode = null;
    _pickMode = false;
    _expanded = new Set();
    _hotkeyHandler = null;
    _pickHandler = null;
    get core() {
        return this._core;
    }
    connectedCallback() {
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
            }
            else if (kind === "wiring") {
                this._markDirty("wiring");
            }
            else {
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
    disconnectedCallback() {
        this._removeCoreListener?.();
        this._removeCoreListener = null;
        this._core?.disconnect();
        this._core = null;
        this._uninstallHotkey();
        this._exitPickMode();
    }
    attributeChangedCallback(name) {
        if (this.shadowRoot === null) {
            return;
        }
        if (name === "open") {
            this._applyOpen();
        }
        else if (name === "dock") {
            this._applyDock();
        }
        else if (name === "hotkey") {
            this._uninstallHotkey();
            this._installHotkey();
        }
    }
    /** テスト用: rAF を待たずに保留中の描画を実行する */
    __flushRenderForTest() {
        this._renderDirty();
    }
    // --- shadow construction ---
    _buildShadow() {
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
            }
            else {
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
        ]) {
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
    _headerButton(header, label, title) {
        const button = document.createElement("button");
        button.textContent = label;
        button.title = title;
        button.setAttribute("aria-pressed", "false");
        header.append(button);
        return button;
    }
    // --- open/close/dock/hotkey ---
    get open() {
        return this.hasAttribute("open");
    }
    toggle(force) {
        const next = force ?? !this.open;
        if (next) {
            this.setAttribute("open", "");
        }
        else {
            this.removeAttribute("open");
        }
    }
    _applyOpen() {
        // shadowRoot 構築後にしか呼ばれない（attributeChangedCallback 側でガード済み）
        this._panel.hidden = !this.open;
        this._badge.hidden = this.open;
        if (this.open) {
            this._markDirty("state");
            this._markDirty("wiring");
            this._markDirty("timeline");
        }
    }
    _applyDock() {
        // shadowRoot 構築後にしか呼ばれない（attributeChangedCallback 側でガード済み）
        const dock = this.getAttribute("dock") === "right" ? "right" : "bottom";
        this._panel.classList.toggle("dock-right", dock === "right");
        this._panel.classList.toggle("dock-bottom", dock === "bottom");
    }
    _installHotkey() {
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
        this._hotkeyHandler = (event) => {
            if (event.key.toLowerCase() === key &&
                event.altKey === alt &&
                event.shiftKey === shift &&
                event.ctrlKey === ctrl &&
                event.metaKey === meta) {
                event.preventDefault();
                this.toggle();
            }
        };
        window.addEventListener("keydown", this._hotkeyHandler);
    }
    _uninstallHotkey() {
        if (this._hotkeyHandler !== null) {
            window.removeEventListener("keydown", this._hotkeyHandler);
            this._hotkeyHandler = null;
        }
    }
    // --- pick mode ---
    _enterPickMode() {
        // 呼び出し元（pick ボタン）が toggle 済みのため、ここでは常に開始でよい
        this._pickMode = true;
        // click を capture で奪う（誤操作防止、devtools-tag-design.md G-U2 の既定側）
        this._pickHandler = (event) => {
            const target = event.target;
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
    _exitPickMode() {
        if (this._pickHandler !== null) {
            document.removeEventListener("click", this._pickHandler, { capture: true });
            this._pickHandler = null;
        }
        this._pickMode = false;
        const pickButton = this.shadowRoot?.querySelector('button[data-role="pick"]');
        pickButton?.setAttribute("aria-pressed", "false");
    }
    // --- rendering ---
    _markDirty(pane) {
        this._dirtyPanes.add(pane);
        if (this._renderScheduled) {
            return;
        }
        this._renderScheduled = true;
        requestAnimationFrame(() => {
            this._renderDirty();
        });
    }
    _renderDirty() {
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
    _rosterKey(entry) {
        return `${entry.sourceId}:${entry.name}`;
    }
    _selectedRoster() {
        const core = this._core;
        const roster = core.getRoster();
        if (roster.length === 0) {
            return null;
        }
        const found = roster.find((entry) => this._rosterKey(entry) === this._selectedRosterKey);
        return found ?? roster[0];
    }
    _renderStatePane() {
        const core = this._core;
        const body = this._paneElements["state"];
        const select = this._stateSelect;
        const roster = core.getRoster();
        const selected = this._selectedRoster();
        select.replaceChildren(...roster.map((entry) => {
            const option = document.createElement("option");
            option.value = this._rosterKey(entry);
            option.textContent = `${entry.name} (${entry.sourceId.slice(0, 12)})`;
            option.selected = selected !== null && this._rosterKey(entry) === this._rosterKey(selected);
            return option;
        }));
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
    _renderTreeNode(container, entry, ref, label, depth) {
        const core = this._core;
        let value;
        let readable = true;
        try {
            value = core.readValue(entry, ref.path, ref.indexes);
        }
        catch {
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
                }
                else {
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
        }
        else {
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
                    this._renderTreeNode(container, entry, { path: `${ref.path}.*`, indexes: [...ref.indexes, index] }, `[${index}]`, depth + 1);
                }
                if (value.length > limit) {
                    const more = this._emptyRow(`…(${value.length} items)`);
                    more.style.paddingLeft = `${(depth + 1) * 14}px`;
                    container.append(more);
                }
            }
            else {
                for (const childKey of Object.keys(value)) {
                    this._renderTreeNode(container, entry, { path: `${ref.path}.${childKey}`, indexes: ref.indexes }, childKey, depth + 1);
                }
            }
        }
    }
    _beginEdit(row, valueSpan, entry, ref, current) {
        const input = document.createElement("input");
        input.value = typeof current === "string" ? current : String(current);
        const commit = () => {
            // 編集は通常のリアクティブパイプラインを通る（devtools-tag-design.md §3.1）
            this._core?.writeValue(entry, ref.path, coerceInput(input.value), ref.indexes);
            this._markDirty("state");
        };
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                commit();
            }
            else if (event.key === "Escape") {
                this._markDirty("state");
            }
        });
        row.replaceChild(input, valueSpan);
        input.focus();
    }
    _renderWiringPane() {
        const core = this._core;
        const body = this._paneElements["wiring"];
        body.replaceChildren();
        let entries;
        let contextLabel;
        if (this._pickedNode !== null) {
            entries = core.getWiringForNode(this._pickedNode);
            const target = this._pickedNode;
            contextLabel =
                target instanceof Element ? `<${target.tagName.toLowerCase()}>` : target.nodeName;
        }
        else if (this._selectedPath !== null) {
            const selected = this._selectedRoster();
            entries =
                selected !== null ? core.getWiringForPath(selected.name, this._selectedPath) : [];
            contextLabel = this._selectedPath;
        }
        else {
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
        const declared = selected !== null ? scanDeclaredBindings(this._scanRootOf(selected)) : [];
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
    _scanRootOf(entry) {
        // instanceof はテスト環境（happy-dom）の Document 実体と一致しないことがあるため
        // nodeType で判定する（DOCUMENT_FRAGMENT_NODE は ShadowRoot を含む）
        const rootNode = entry.rootNode;
        if (rootNode.nodeType === Node.DOCUMENT_NODE ||
            rootNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            return rootNode;
        }
        return document;
    }
    _wiringRow(entry) {
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
    _declaredRow(entry) {
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
    _renderTimelinePane() {
        const core = this._core;
        const body = this._paneElements["timeline"];
        const timeline = core.getTimeline();
        const start = Math.max(0, timeline.length - TIMELINE_RENDER_LIMIT);
        const rows = [];
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
    _timelineRow(entry) {
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
        // `$watch` の失敗はランタイムが握って drain を守るため、ここが唯一の
        // 「気づける場所」になる。空撃ちと同じ warn 表示に乗せる。
        if (entry.kind === "watch-error" || entry.kind === "watch-chain-limit") {
            kind.classList.add("warn");
            kind.title = entry.kind === "watch-error"
                ? "a $watch threw; the runtime isolated it (console.error only)"
                : "a $watch write chain hit the depth limit and was cut off";
        }
        // 伝播の打ち切りと契約 drift も「黙って起きる異常」なので warn に乗せる。
        // suppressed / coalesced は定常動作（エコー抑止・合流）のため通常表示。
        if (entry.kind === "propagation-hop-limit" || entry.kind === "contract-drift") {
            kind.classList.add("warn");
            kind.title = entry.kind === "propagation-hop-limit"
                ? "a two-way propagation chain hit the hop limit and was cut off"
                : "sidecar manifest drifted from the live wcBindable declaration (live wins)";
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
    _emptyRow(text) {
        const row = document.createElement("div");
        row.className = "empty";
        row.textContent = text;
        return row;
    }
    // --- highlight ---
    _highlightPath(entry, path) {
        const core = this._core;
        const nodes = [];
        for (const wiring of core.getWiringForPath(entry.name, path)) {
            const binding = wiring.bindingRef.deref();
            if (binding !== undefined) {
                nodes.push(binding.node, binding.replaceNode);
            }
        }
        this._highlightNodes(nodes);
    }
    _highlightNodes(nodes) {
        // shadowRoot 構築後にしか呼ばれない（各リスナーは _buildShadow 内で配線される）
        const layer = this._highlightLayer;
        layer.replaceChildren();
        const seen = new Set();
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

/**
 * bootstrapDevtools.ts
 *
 * `<wcs-devtools>` の登録と自動挿入（devtools-tag-design.md §2）。
 * - 既に定義済みなら再定義しない
 * - ページに `<wcs-devtools>` が無ければ body 末尾に 1 つ挿入
 *   （手動で書かれていれば挿入しない）
 * - SSR では何もしない
 */
const TAG_NAME = "wcs-devtools";
function insertIfAbsent() {
    if (document.querySelector(TAG_NAME) !== null) {
        return;
    }
    document.body.appendChild(document.createElement(TAG_NAME));
}
function bootstrapDevtools() {
    if (document.documentElement.hasAttribute("data-wcs-server")) {
        return;
    }
    if (!customElements.get(TAG_NAME)) {
        customElements.define(TAG_NAME, WcsDevtools);
    }
    if (document.body !== null) {
        insertIfAbsent();
    }
    else {
        document.addEventListener("DOMContentLoaded", insertIfAbsent, { once: true });
    }
}

export { DEVTOOLS_HOOK_GLOBAL, DEVTOOLS_PROTOCOL_VERSION, DevtoolsCore, RESERVED_STATE_NAME_PREFIX, WcsDevtools, bootstrapDevtools, formatArgs, formatValue, getOrCreateHookRegistry, scanDeclaredBindings };
//# sourceMappingURL=index.esm.js.map
