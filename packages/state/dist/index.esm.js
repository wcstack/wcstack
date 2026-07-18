function inSsr() {
    // キャッシュしない: SSR モードはプロセスの属性ではなく「現在の document」の
    // 属性。@wcstack/server はグローバル document を差し替えてサーバーレンダリング
    // した後、同一プロセスでクライアント側ハイドレーションが走る（SSR→hydrate の
    // e2e が該当）。サーバーフェーズの判定をキャッシュするとクライアントフェーズが
    // SSR モード扱いになり、hydrateBindings の代わりに buildBindings が選ばれて
    // connectedCallbackPromise が永久に未解決になる。
    const html = document.documentElement;
    return html ? html.hasAttribute('data-wcs-server') : false;
}
const _config = {
    bindAttributeName: 'data-wcs',
    commentTextPrefix: 'wcs-text',
    commentForPrefix: 'wcs-for',
    commentIfPrefix: 'wcs-if',
    commentElseIfPrefix: 'wcs-elseif',
    commentElsePrefix: 'wcs-else',
    tagNames: {
        state: 'wcs-state',
        ssr: 'wcs-ssr',
    },
    locale: 'en',
    debug: false,
    enableMustache: true,
    enableDirectionalInitialSync: true,
    enablePropagationContext: true,
    // Phase 5b の dev-time contract analyzer は意図的に explicit opt-in（既定 off）。
    // wcstack は buildless / zero-config で NODE_ENV 相当の確実な dev/prod 判定が無く、
    // hostname や minification の heuristic で auto-ON すると誤検出で prod にコストを
    // 乗せうるため、dev 既定 ON は採らない。利用側が setConfig で明示有効化する
    // （docs/architecture-hardening/10-defaulting-rollout-status.md §C）。
    enableContractAnalyzer: false,
    sameValueGuard: true,
};
// backward compatible export (read-only usage)
const config = _config;
function getConfig() {
    return config;
}
function setConfig(partialConfig) {
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    if (typeof partialConfig.bindAttributeName === "string") {
        _config.bindAttributeName = partialConfig.bindAttributeName;
    }
    if (typeof partialConfig.commentTextPrefix === "string") {
        _config.commentTextPrefix = partialConfig.commentTextPrefix;
    }
    if (typeof partialConfig.commentForPrefix === "string") {
        _config.commentForPrefix = partialConfig.commentForPrefix;
    }
    if (typeof partialConfig.commentIfPrefix === "string") {
        _config.commentIfPrefix = partialConfig.commentIfPrefix;
    }
    if (typeof partialConfig.commentElseIfPrefix === "string") {
        _config.commentElseIfPrefix = partialConfig.commentElseIfPrefix;
    }
    if (typeof partialConfig.commentElsePrefix === "string") {
        _config.commentElsePrefix = partialConfig.commentElsePrefix;
    }
    if (typeof partialConfig.locale === "string") {
        _config.locale = partialConfig.locale;
    }
    if (typeof partialConfig.debug === "boolean") {
        _config.debug = partialConfig.debug;
    }
    if (typeof partialConfig.enableMustache === "boolean") {
        _config.enableMustache = partialConfig.enableMustache;
    }
    if (typeof partialConfig.enableDirectionalInitialSync === "boolean") {
        _config.enableDirectionalInitialSync = partialConfig.enableDirectionalInitialSync;
    }
    if (typeof partialConfig.enablePropagationContext === "boolean") {
        _config.enablePropagationContext = partialConfig.enablePropagationContext;
    }
    if (typeof partialConfig.enableContractAnalyzer === "boolean") {
        _config.enableContractAnalyzer = partialConfig.enableContractAnalyzer;
    }
    if (typeof partialConfig.sameValueGuard === "boolean") {
        _config.sameValueGuard = partialConfig.sameValueGuard;
    }
}

const bindingPromiseByNode = new WeakMap();
// resolve 済みマーク。エントリ未生成のまま resolve されたノードは、後から
// wait された時に「生成して即 resolve」で追いつく。
const resolvedNodes = new WeakSet();
let id$1 = 0;
function getInitializeBindingPromiseByNode(node) {
    let bindingPromise = bindingPromiseByNode.get(node) || null;
    if (bindingPromise !== null) {
        return bindingPromise;
    }
    let resolveFn = undefined;
    const promise = new Promise((resolve) => {
        resolveFn = resolve;
    });
    bindingPromise = {
        id: ++id$1,
        promise,
        resolve: resolveFn
    };
    bindingPromiseByNode.set(node, bindingPromise);
    if (resolvedNodes.has(node)) {
        bindingPromise.resolve();
    }
    return bindingPromise;
}
async function waitInitializeBinding(node) {
    const bindingPromise = getInitializeBindingPromiseByNode(node);
    await bindingPromise.promise;
}
function resolveInitializedBinding(node) {
    // ホットパス: リスト行では全 subscriber ノードがここを通るが、await する消費者
    // （boundComponent / shadowRoot host）はほぼ居ない。既存エントリが無ければ
    // Promise+closure を生成せず resolve 済みマークだけ残す（15 万個級の割り当て削減）。
    const existing = bindingPromiseByNode.get(node);
    if (typeof existing !== "undefined") {
        existing.resolve();
        return;
    }
    resolvedNodes.add(node);
}

const DELIMITER = '.';
const WILDCARD = '*';
const MAX_WILDCARD_DEPTH = 128;
const MAX_LOOP_DEPTH = 128;
// 因果伝播（Phase 3）の 1 transaction あたり hop 上限。超過分の未処理 record は
// quarantine し（適用済みの値は戻さない）、updater から例外は投げない。
const MAX_PROPAGATION_HOPS = 32;
// data-wcs バインディング構文 `[prop][#mod]: [path][@state][|filter...]` の区切り文字（単一正本）。
// これらは「死守の壁（構文契約）」であり値は不変。manifest.syntax.delimiters で公開される。
const BINDING_SEPARATOR = ';'; // 複数バインディングの区切り
const PROP_VALUE_SEPARATOR = ':'; // 左辺(prop)と右辺(path)の区切り
const MODIFIER_SEPARATOR = '#'; // prop と修飾子の区切り
const STATE_NAME_SEPARATOR = '@'; // path と @stateName の区切り
const FILTER_SEPARATOR = '|'; // フィルタパイプの区切り
/**
 * stackIndexByIndexName
 * インデックス名からスタックインデックスへのマッピング
 * $1 => 0
 * $2 => 1
 * :
 * ${i + 1} => i
 * i < MAX_WILDCARD_DEPTH
 */
const tmpIndexByIndexName = {};
for (let i = 0; i < MAX_WILDCARD_DEPTH; i++) {
    tmpIndexByIndexName[`$${i + 1}`] = i;
}
const INDEX_BY_INDEX_NAME = Object.freeze(tmpIndexByIndexName);
const NO_SET_TIMEOUT = 60 * 1000; // 1分
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const STATE_CONNECTED_CALLBACK_NAME = "$connectedCallback";
const STATE_DISCONNECTED_CALLBACK_NAME = "$disconnectedCallback";
const STATE_UPDATED_CALLBACK_NAME = "$updatedCallback";
const WEBCOMPONENT_STATE_READY_CALLBACK_NAME = "$stateReadyCallback";
const STATE_BINDABLES_NAME = "$bindables";
const STATE_COMMAND_TOKENS_NAME = "$commandTokens";
const STATE_COMMAND_NAMESPACE_NAME = "$command";
const STATE_EVENT_TOKENS_NAME = "$eventTokens";
const STATE_ON_NAME = "$on";
const STATE_STREAMS_NAME = "$streams";
const STATE_STREAM_STATUS_NAMESPACE_NAME = "$streamStatus";
const STATE_STREAM_ERROR_NAMESPACE_NAME = "$streamError";
const DCC_DEFINITION_ATTRIBUTE = "data-wc-definition";

const _cache$4 = new Map();
let id = 0;
function getPathInfo(path) {
    let pathInfo = _cache$4.get(path);
    if (typeof pathInfo !== "undefined") {
        return pathInfo;
    }
    pathInfo = Object.freeze(new PathInfo(path));
    _cache$4.set(path, pathInfo);
    return pathInfo;
}
class PathInfo {
    id = ++id;
    path;
    segments;
    lastSegment;
    cumulativePaths;
    cumulativePathSet;
    cumulativePathInfos;
    cumulativePathInfoSet;
    parentPath;
    wildcardPaths;
    wildcardPathSet;
    indexByWildcardPath;
    wildcardPathInfos;
    wildcardPathInfoSet;
    wildcardParentPaths;
    wildcardParentPathSet;
    wildcardParentPathInfos;
    wildcardParentPathInfoSet;
    wildcardPositions;
    lastWildcardPath;
    lastWildcardInfo;
    wildcardCount;
    parentPathInfo;
    constructor(path) {
        // Helper to get or create StructuredPathInfo instances, avoiding redundant creation for self-reference
        const getPattern = (_path) => {
            return (path === _path) ? this : getPathInfo(_path);
        };
        // Split the pattern into individual path segments (e.g., "items.*.name" → ["items", "*", "name"])
        const segments = path.split(".");
        // Arrays to track all cumulative paths from root to each segment
        const cumulativePaths = [];
        const cumulativePathInfos = [];
        // Arrays to track wildcard-specific information
        const wildcardPaths = [];
        const indexByWildcardPath = {}; // Maps wildcard path to its index position
        const wildcardPathInfos = [];
        const wildcardParentPaths = []; // Paths of parent segments for each wildcard
        const wildcardParentPathInfos = [];
        const wildcardPositions = [];
        let currentPatternPath = "", prevPatternPath = "";
        let wildcardCount = 0;
        // Iterate through each segment to build cumulative paths and identify wildcards
        for (let i = 0; i < segments.length; i++) {
            currentPatternPath += segments[i];
            // If this segment is a wildcard, track it with all wildcard-specific metadata
            if (segments[i] === WILDCARD) {
                wildcardPaths.push(currentPatternPath);
                indexByWildcardPath[currentPatternPath] = wildcardCount; // Store wildcard's ordinal position
                wildcardPathInfos.push(getPattern(currentPatternPath));
                wildcardParentPaths.push(prevPatternPath); // Parent path is the previous cumulative path
                wildcardParentPathInfos.push(getPattern(prevPatternPath));
                wildcardPositions.push(i);
                wildcardCount++;
            }
            // Track all cumulative paths for hierarchical navigation (e.g., "items", "items.*", "items.*.name")
            cumulativePaths.push(currentPatternPath);
            cumulativePathInfos.push(getPattern(currentPatternPath));
            // Save current path as previous for next iteration, then add separator
            prevPatternPath = currentPatternPath;
            currentPatternPath += ".";
        }
        // Determine the deepest (last) wildcard path and the parent path of the entire pattern
        const lastWildcardPath = wildcardPaths.length > 0 ? wildcardPaths[wildcardPaths.length - 1] : null;
        const parentPath = cumulativePaths.length > 1 ? cumulativePaths[cumulativePaths.length - 2] : null;
        // Assign all analyzed data to readonly properties
        this.path = path;
        this.segments = segments;
        this.lastSegment = segments[segments.length - 1];
        this.cumulativePaths = cumulativePaths;
        this.cumulativePathSet = new Set(cumulativePaths); // Set for fast lookup
        this.cumulativePathInfos = cumulativePathInfos;
        this.cumulativePathInfoSet = new Set(cumulativePathInfos);
        this.wildcardPaths = wildcardPaths;
        this.wildcardPathSet = new Set(wildcardPaths);
        this.indexByWildcardPath = indexByWildcardPath;
        this.wildcardPathInfos = wildcardPathInfos;
        this.wildcardPathInfoSet = new Set(wildcardPathInfos);
        this.wildcardParentPaths = wildcardParentPaths;
        this.wildcardParentPathSet = new Set(wildcardParentPaths);
        this.wildcardParentPathInfos = wildcardParentPathInfos;
        this.wildcardParentPathInfoSet = new Set(wildcardParentPathInfos);
        this.wildcardPositions = wildcardPositions;
        this.lastWildcardPath = lastWildcardPath;
        this.lastWildcardInfo = lastWildcardPath ? getPattern(lastWildcardPath) : null;
        this.parentPath = parentPath;
        this.parentPathInfo = parentPath ? getPattern(parentPath) : null;
        this.wildcardCount = wildcardCount;
    }
}

const cache = new WeakMap();
function getCustomElement(node) {
    const cached = cache.get(node);
    if (cached !== undefined) {
        return cached;
    }
    let value = null;
    try {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return value;
        }
        const element = node;
        const tagName = element.tagName.toLowerCase();
        if (tagName.includes("-")) {
            return value = tagName;
        }
        if (element.hasAttribute("is")) {
            const is = element.getAttribute("is");
            if (is.includes("-")) {
                return value = is;
            }
        }
        return value;
    }
    finally {
        cache.set(node, value);
    }
}

/**
 * Resolve the registry at operation time so importing the runtime remains safe
 * when browser globals are absent. The owner hook is reserved for scoped
 * registries; current callers fall back to the global registry.
 */
function getCustomElementRegistry(owner = null) {
    const globalRegistry = globalThis.customElements;
    const registry = owner?.customElements ?? globalRegistry;
    if (typeof registry !== "object" || registry === null)
        return null;
    const candidate = registry;
    if (typeof candidate.get !== "function" || typeof candidate.whenDefined !== "function") {
        return null;
    }
    return candidate;
}
function upgradeCustomElement(registry, root) {
    registry.upgrade?.(root);
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/wc-bindable-reader.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
const MIN_WC_BINDABLE_VERSION = 1;
/**
 * Repository-local conformance mirror of @wc-bindable/core's
 * getWcBindableDeclaration(). Discovery has one path only:
 * target.constructor.wcBindable.
 *
 * The declaration remains live. The maps are read-time indexes and are not a
 * clone, freeze, or normalized replacement for liveDeclaration.
 */
function readBindableDeclaration(target) {
    try {
        if (target === null || (typeof target !== "object" && typeof target !== "function")) {
            return null;
        }
        const candidate = target;
        const addEventListener = candidate.addEventListener;
        const removeEventListener = candidate.removeEventListener;
        const declaration = candidate.constructor?.wcBindable;
        if (typeof addEventListener !== "function" || typeof removeEventListener !== "function") {
            return null;
        }
        if (declaration?.protocol !== "wc-bindable")
            return null;
        if (!Number.isInteger(declaration.version) || declaration.version < MIN_WC_BINDABLE_VERSION) {
            return null;
        }
        const knownProperties = readNamedList(declaration.properties, isValidPropertyDescriptor);
        if (knownProperties === null)
            return null;
        const declaredInputs = declaration.inputs === undefined
            ? new Map()
            : readNamedList(declaration.inputs, isValidInputDescriptor);
        if (declaredInputs === null)
            return null;
        const declaredCommands = declaration.commands === undefined
            ? new Map()
            : readNamedList(declaration.commands, isValidCommandDescriptor);
        if (declaredCommands === null)
            return null;
        return {
            target: target,
            liveDeclaration: declaration,
            knownProperties,
            declaredInputs,
            declaredCommands,
        };
    }
    catch {
        return null;
    }
}
function isValidPropertyDescriptor(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const descriptor = value;
    if (typeof descriptor.name !== "string" || descriptor.name.length === 0)
        return false;
    if (typeof descriptor.event !== "string" || descriptor.event.length === 0)
        return false;
    return descriptor.getter === undefined || typeof descriptor.getter === "function";
}
function isValidInputDescriptor(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const descriptor = value;
    if (typeof descriptor.name !== "string" || descriptor.name.length === 0)
        return false;
    return descriptor.attribute === undefined || typeof descriptor.attribute === "string";
}
function isValidCommandDescriptor(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const descriptor = value;
    if (typeof descriptor.name !== "string" || descriptor.name.length === 0)
        return false;
    return descriptor.async === undefined || typeof descriptor.async === "boolean";
}
function readNamedList(value, isValidEntry) {
    if (!Array.isArray(value))
        return null;
    const entries = new Map();
    for (const entry of value) {
        if (!isValidEntry(entry) || entries.has(entry.name))
            return null;
        entries.set(entry.name, entry);
    }
    return entries;
}

function raiseError(message) {
    throw new Error(`[@wcstack/state] ${message}`);
}

function makeExpandedEntry(name, base, stateName) {
    // Dot-relative spread keeps the loop item root (`.`) without producing `..foo`.
    const expandedPath = base === "." ? `.${name}` : `${base}.${name}`;
    return {
        propName: name,
        propSegments: [name],
        propModifiers: [],
        statePathName: expandedPath,
        statePathInfo: getPathInfo(expandedPath),
        stateName,
        inFilters: [],
        outFilters: [],
        bindingType: 'prop',
    };
}
function dedupKey(r) {
    switch (r.bindingType) {
        case 'prop':
        case 'event':
        case 'radio':
        case 'checkbox':
            return `${r.bindingType}::${r.propName}`;
        case 'spread':
            return null;
        default:
            return null;
    }
}
/**
 * Expand spread bind-text entries (`...: target`) into per-prop entries
 * by enumerating wcBindable.properties + inputs of the element's class.
 *
 * Behavior:
 * - With `allowDeferred: true` (default): if class is not yet defined, the
 *   spread entry stays so the caller can wait via customElements.whenDefined.
 * - With `allowDeferred: false`: raises if class is not defined.
 * - Duplicate propName: last-wins (explicit binding overrides spread).
 * - When config.debug, console.debug logs each override.
 * - Mid-`*` in target path is allowed (e.g. `...: stores.*.fetch`).
 *
 * Composite Profile (COMPOSITE.md / SPEC-extensions § 4) support:
 * - A composite shell exposes its synthesized declaration via the standard
 *   `target.constructor.wcBindable` surface (§ 1 Discovery), so this function
 *   handles it without any composite-specific code path.
 * - Composed property names use the `<sourceId>.<sourceName>` pattern
 *   (e.g. "s3.progress"); we keep the dotted name as a single segment so
 *   element member access stays flat (element["s3.progress"], not nested).
 * - The expanded state path becomes `targetBase.s3.progress`, which resolves
 *   as nested state access — author state as `{ s3: { progress: 0 } }` to
 *   mirror the composed structure.
 * - Tier claim (Symbol.for("wc-bindable.composite.tiers")) is not read here;
 *   spread covers observation (T1) and writable inputs (T2) transparently
 *   through normal property assignment, and commands stay out of spread by
 *   design regardless of tier.
 */
function expandSpread(node, results, options = {}) {
    const allowDeferred = options.allowDeferred ?? true;
    if (!results.some(r => r.bindingType === 'spread')) {
        return results;
    }
    const expanded = [];
    const spreadOrigin = new WeakSet();
    for (const result of results) {
        if (result.bindingType !== 'spread') {
            expanded.push(result);
            continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            raiseError(`Spread binding requires an element node.`);
        }
        const element = node;
        const tagName = getCustomElement(element);
        if (tagName === null) {
            raiseError(`Spread binding "${result.statePathName}" requires a custom element with wcBindable, but <${element.tagName.toLowerCase()}> is not a custom element.`);
        }
        const registry = getCustomElementRegistry();
        if (registry === null) {
            raiseError(`CustomElementRegistry is unavailable for <${tagName}>.`);
        }
        const customClass = registry.get(tagName);
        if (typeof customClass === "undefined") {
            if (!allowDeferred) {
                raiseError(`Spread binding "${result.statePathName}" requires <${tagName}> to be registered. Define the custom element before initializing this binding.`);
            }
            // Deferred: keep spread entry intact; caller retries via whenDefined.
            expanded.push(result);
            continue;
        }
        upgradeCustomElement(registry, element);
        const bindable = readBindableDeclaration(element);
        if (bindable === null) {
            raiseError(`Spread binding "${result.statePathName}" requires <${tagName}> to expose a valid wcBindable declaration.`);
        }
        const targetBase = result.statePathName;
        const stateName = result.stateName;
        const seen = new Set();
        for (const name of bindable.knownProperties.keys()) {
            if (seen.has(name))
                continue;
            seen.add(name);
            const entry = makeExpandedEntry(name, targetBase, stateName);
            spreadOrigin.add(entry);
            expanded.push(entry);
        }
        // properties win over inputs when the name overlaps because they carry the
        // full property contract (for example change events).
        for (const name of bindable.declaredInputs.keys()) {
            if (seen.has(name))
                continue;
            seen.add(name);
            const entry = makeExpandedEntry(name, targetBase, stateName);
            spreadOrigin.add(entry);
            expanded.push(entry);
        }
    }
    // Last-wins de-duplication
    const lastIndexByKey = new Map();
    for (let i = 0; i < expanded.length; i++) {
        const key = dedupKey(expanded[i]);
        if (key !== null) {
            lastIndexByKey.set(key, i);
        }
    }
    const final = [];
    for (let i = 0; i < expanded.length; i++) {
        const key = dedupKey(expanded[i]);
        if (key === null) {
            final.push(expanded[i]);
            continue;
        }
        if (lastIndexByKey.get(key) === i) {
            final.push(expanded[i]);
        }
        else if (config.debug && spreadOrigin.has(expanded[i])) {
            const overrider = expanded[lastIndexByKey.get(key)];
            const tagText = node.nodeType === Node.ELEMENT_NODE
                ? `<${node.tagName.toLowerCase()}>`
                : 'node';
            console.debug(`[@wcstack/state] spread: prop "${expanded[i].propName}" of ${tagText} overridden by explicit binding (statePath: "${overrider.statePathName}").`);
        }
    }
    return final;
}
function hasUnresolvedSpread(results) {
    return results.some(r => r.bindingType === 'spread');
}

function resolveNodePath(root, path) {
    let currentNode = root;
    if (path.length === 0)
        return currentNode;
    // path.reduce()だと途中でnullになる可能性があるので、
    for (let i = 0; i < path.length; i++) {
        currentNode = currentNode?.childNodes[path[i]] ?? null;
        if (currentNode === null)
            break;
    }
    return currentNode;
}

function getBindingInfos(node, parseBindingTextResults) {
    const bindingInfos = [];
    for (const parseBindingTextResult of parseBindingTextResults) {
        if (parseBindingTextResult.bindingType !== 'text') {
            bindingInfos.push({
                ...parseBindingTextResult,
                node: node,
                replaceNode: node,
            });
        }
        else {
            // フラグメント登録時に事前正規化済みの Text ノードはそのまま replaceNode に
            // 使う（node === replaceNode なら replaceToReplaceNode は no-op）。
            // 実 DOM 上の wcs-text コメント（非フラグメント経路）は従来どおり
            // 空 Text を生成して実行時に差し替える。
            const replaceNode = node.nodeType === Node.TEXT_NODE
                ? node
                : document.createTextNode('');
            bindingInfos.push({
                ...parseBindingTextResult,
                node: node,
                replaceNode: replaceNode,
            });
        }
    }
    return bindingInfos;
}

const bindingsByNode = new WeakMap();
function getBindingsByNode(node) {
    return bindingsByNode.get(node) || null;
}
function setBindingsByNode(node, bindings) {
    bindingsByNode.set(node, bindings);
}
function addBindingByNode(node, binding) {
    const bindings = getBindingsByNode(node);
    if (bindings === null) {
        setBindingsByNode(node, [binding]);
    }
    else {
        bindings.push(binding);
    }
}

const STRUCTURAL_BINDING_TYPE_SET = new Set([
    "if",
    "elseif",
    "else",
    "for",
]);

/**
 * errorMessages.ts
 *
 * Error message generation utilities used by filter functions.
 *
 * Main responsibilities:
 * - Throws clear error messages when filter options or value type checks fail
 * - Takes function name as argument to specify which filter caused the error
 *
 * Design points:
 * - optionsRequired: Error when required option is not specified
 * - optionMustBeNumber: Error when option value is not a number
 * - valueMustBeNumber: Error when value is not a number
 * - valueMustBeBoolean: Error when value is not boolean
 * - valueMustBeDate: Error when value is not a Date
 */
/**
 * Throws error when filter requires at least one option but none provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function optionsRequired(fnName) {
    raiseError(`filter ${fnName} requires at least one option`);
}
/**
 * Throws error when filter option must be a number but invalid value provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function optionMustBeNumber(fnName) {
    raiseError(`filter ${fnName} requires a number as option`);
}
/**
 * Throws error when filter requires numeric value but non-number provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function valueMustBeNumber(fnName) {
    raiseError(`filter ${fnName} requires a number value`);
}
/**
 * Throws error when filter requires boolean value but non-boolean provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function valueMustBeBoolean(fnName) {
    raiseError(`filter ${fnName} requires a boolean value`);
}
/**
 * Throws error when filter requires Date value but non-Date provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function valueMustBeDate(fnName) {
    raiseError(`filter ${fnName} requires a date value`);
}

/**
 * builtinFilters.ts
 *
 * Implementation file for built-in filter functions available in Structive.
 *
 * Main responsibilities:
 * - Provides filters for conversion, comparison, formatting, and validation of numbers, strings, dates, booleans, etc.
 * - Defines functions with options for each filter name, enabling flexible use during binding
 * - Designed for common use as both input and output filters
 *
 * Design points:
 * - Comprehensive coverage of diverse filters: eq, ne, lt, gt, inc, fix, locale, uc, lc, cap, trim, slice, pad, int, float, round, date, time, ymd, falsy, truthy, defaults, boolean, number, string, null, etc.
 * - Rich type checking and error handling for option values
 * - Centralized management of filter functions with FilterWithOptions type, easy to extend
 * - Dynamic retrieval of filter functions from filter names and options via builtinFilterFn
 */
function validateNumberString(value) {
    if (!value || isNaN(Number(value))) {
        return false;
    }
    return true;
}
/**
 * Equality filter - compares value with option.
 *
 * @param options - Array with comparison value as first element
 * @returns Filter function that returns boolean
 */
const eq = (options) => {
    const opt = options?.[0] ?? optionsRequired('eq');
    return (value) => {
        // Align types for comparison
        if (typeof value === 'number') {
            if (!validateNumberString(opt)) {
                optionMustBeNumber('eq');
            }
            return value === Number(opt);
        }
        if (typeof value === 'string') {
            return value === opt;
        }
        // Strict equality for others
        return value === opt;
    };
};
/**
 * Inequality filter - compares value with option.
 *
 * @param options - Array with comparison value as first element
 * @returns Filter function that returns boolean
 */
const ne = (options) => {
    const opt = options?.[0] ?? optionsRequired('ne');
    return (value) => {
        // Align types for comparison
        if (typeof value === 'number') {
            if (!validateNumberString(opt)) {
                optionMustBeNumber('ne');
            }
            return value !== Number(opt);
        }
        if (typeof value === 'string') {
            return value !== opt;
        }
        // Strict equality for others
        return value !== opt;
    };
};
/**
 * Boolean NOT filter - inverts boolean value.
 *
 * @param options - Unused
 * @returns Filter function that returns inverted boolean
 */
const not = (_options) => {
    return (value) => {
        if (typeof value !== 'boolean') {
            valueMustBeBoolean('not');
        }
        return !value;
    };
};
/**
 * Less than filter - checks if value is less than option.
 *
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const lt = (options) => {
    const opt = options?.[0] ?? optionsRequired('lt');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('lt');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('lt');
        }
        return value < Number(opt);
    };
};
/**
 * Less than or equal filter - checks if value is less than or equal to option.
 *
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const le = (options) => {
    const opt = options?.[0] ?? optionsRequired('le');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('le');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('le');
        }
        return value <= Number(opt);
    };
};
/**
 * Greater than filter - checks if value is greater than option.
 *
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const gt = (options) => {
    const opt = options?.[0] ?? optionsRequired('gt');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('gt');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('gt');
        }
        return value > Number(opt);
    };
};
/**
 * Greater than or equal filter - checks if value is greater than or equal to option.
 *
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const ge = (options) => {
    const opt = options?.[0] ?? optionsRequired('ge');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('ge');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('ge');
        }
        return value >= Number(opt);
    };
};
/**
 * Increment filter - adds option value to input value.
 *
 * @param options - Array with increment number as first element
 * @returns Filter function that returns incremented number
 */
const inc = (options) => {
    const opt = options?.[0] ?? optionsRequired('inc');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('inc');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('inc');
        }
        return value + Number(opt);
    };
};
/**
 * Decrement filter - subtracts option value from input value.
 *
 * @param options - Array with decrement number as first element
 * @returns Filter function that returns decremented number
 */
const dec = (options) => {
    const opt = options?.[0] ?? optionsRequired('dec');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('dec');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('dec');
        }
        return value - Number(opt);
    };
};
/**
 * Multiply filter - multiplies value by option.
 *
 * @param options - Array with multiplier number as first element
 * @returns Filter function that returns multiplied number
 */
const mul = (options) => {
    const opt = options?.[0] ?? optionsRequired('mul');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('mul');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('mul');
        }
        return value * Number(opt);
    };
};
/**
 * Divide filter - divides value by option.
 *
 * @param options - Array with divisor number as first element
 * @returns Filter function that returns divided number
 */
const div = (options) => {
    const opt = options?.[0] ?? optionsRequired('div');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('div');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('div');
        }
        return value / Number(opt);
    };
};
/**
 * Modulo filter - returns remainder of division.
 *
 * @param options - Array with divisor number as first element
 * @returns Filter function that returns remainder
 */
const mod = (options) => {
    const opt = options?.[0] ?? optionsRequired('mod');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('mod');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('mod');
        }
        return value % Number(opt);
    };
};
/**
 * Fixed decimal filter - formats number to fixed decimal places.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns formatted string
 */
const fix = (options) => {
    const opt = options?.[0] ?? "0";
    if (!validateNumberString(opt)) {
        optionMustBeNumber('fix');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('fix');
        }
        return value.toFixed(Number(opt));
    };
};
/**
 * Locale number filter - formats number according to locale.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns localized number string
 */
const locale = (options) => {
    const opt = options?.[0] ?? config.locale;
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('locale');
        }
        return value.toLocaleString(opt);
    };
};
/**
 * Uppercase filter - converts string to uppercase.
 *
 * @param options - Unused
 * @returns Filter function that returns uppercase string
 */
const uc = (_options) => {
    return (value) => {
        return String(value).toUpperCase();
    };
};
/**
 * Lowercase filter - converts string to lowercase.
 *
 * @param options - Unused
 * @returns Filter function that returns lowercase string
 */
const lc = (_options) => {
    return (value) => {
        return String(value).toLowerCase();
    };
};
/**
 * Capitalize filter - capitalizes first character of string.
 *
 * @param options - Unused
 * @returns Filter function that returns capitalized string
 */
const cap = (_options) => {
    return (value) => {
        const v = String(value);
        if (v.length === 0) {
            return v;
        }
        if (v.length === 1) {
            return v.toUpperCase();
        }
        return v.charAt(0).toUpperCase() + v.slice(1);
    };
};
/**
 * Trim filter - removes whitespace from both ends of string.
 *
 * @param options - Unused
 * @returns Filter function that returns trimmed string
 */
const trim = (_options) => {
    return (value) => {
        return String(value).trim();
    };
};
/**
 * Slice filter - extracts portion of string from specified index.
 *
 * @param options - Array with start index and optional end index
 * @returns Filter function that returns sliced string
 */
const slice = (options) => {
    const numberedOpts = [];
    const opt1 = options?.[0] ?? optionsRequired('slice');
    if (!validateNumberString(opt1)) {
        optionMustBeNumber('slice');
    }
    numberedOpts.push(Number(opt1));
    const opt2 = options?.[1];
    if (typeof opt2 !== 'undefined') {
        if (!validateNumberString(opt2)) {
            optionMustBeNumber('slice');
        }
        numberedOpts.push(Number(opt2));
    }
    return (value) => {
        return String(value).slice(...numberedOpts);
    };
};
/**
 * Substring filter - extracts substring from specified position and length.
 *
 * @param options - Array with start index and length
 * @returns Filter function that returns substring
 */
const substr = (options) => {
    const opt1 = options?.[0] ?? optionsRequired('substr');
    if (!validateNumberString(opt1)) {
        optionMustBeNumber('substr');
    }
    const opt2 = options?.[1] ?? optionsRequired('substr');
    if (!validateNumberString(opt2)) {
        optionMustBeNumber('substr');
    }
    return (value) => {
        return String(value).substr(Number(opt1), Number(opt2));
    };
};
/**
 * Pad filter - pads string to specified length from start.
 *
 * @param options - Array with target length and pad string (default: '0')
 * @returns Filter function that returns padded string
 */
const pad = (options) => {
    const opt1 = options?.[0] ?? optionsRequired('pad');
    if (!validateNumberString(opt1)) {
        optionMustBeNumber('pad');
    }
    const opt2 = options?.[1] ?? '0';
    return (value) => {
        return String(value).padStart(Number(opt1), opt2);
    };
};
/**
 * Repeat filter - repeats string specified number of times.
 *
 * @param options - Array with repeat count as first element
 * @returns Filter function that returns repeated string
 */
const rep = (options) => {
    const opt = options?.[0] ?? optionsRequired('rep');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('rep');
    }
    return (value) => {
        return String(value).repeat(Number(opt));
    };
};
/**
 * Reverse filter - reverses character order in string.
 *
 * @param options - Unused
 * @returns Filter function that returns reversed string
 */
const rev = (_options) => {
    return (value) => {
        return String(value).split('').reverse().join('');
    };
};
/**
 * Integer filter - parses value to integer.
 *
 * @param options - Unused
 * @returns Filter function that returns integer
 */
const int = (_options) => {
    return (value) => {
        return parseInt(String(value), 10);
    };
};
/**
 * Float filter - parses value to floating point number.
 *
 * @param options - Unused
 * @returns Filter function that returns float
 */
const float = (_options) => {
    return (value) => {
        return parseFloat(String(value));
    };
};
/**
 * Round filter - rounds number to specified decimal places.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns rounded number
 */
const round = (options) => {
    const opt = options?.[0] ?? '0';
    if (!validateNumberString(opt)) {
        optionMustBeNumber('round');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('round');
        }
        const optValue = Math.pow(10, Number(opt));
        return Math.round(value * optValue) / optValue;
    };
};
/**
 * Floor filter - rounds number down to specified decimal places.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns floored number
 */
const floor = (options) => {
    const opt = options?.[0] ?? '0';
    if (!validateNumberString(opt)) {
        optionMustBeNumber('floor');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('floor');
        }
        const optValue = Math.pow(10, Number(opt));
        return Math.floor(value * optValue) / optValue;
    };
};
/**
 * Ceiling filter - rounds number up to specified decimal places.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns ceiled number
 */
const ceil = (options) => {
    const opt = options?.[0] ?? '0';
    if (!validateNumberString(opt)) {
        optionMustBeNumber('ceil');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('ceil');
        }
        const optValue = Math.pow(10, Number(opt));
        return Math.ceil(value * optValue) / optValue;
    };
};
/**
 * Percent filter - formats number as percentage string.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns percentage string with '%'
 */
const percent = (options) => {
    const opt = options?.[0] ?? '0';
    if (!validateNumberString(opt)) {
        optionMustBeNumber('percent');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('percent');
        }
        return `${(value * 100).toFixed(Number(opt))}%`;
    };
};
/**
 * Date filter - formats Date object as localized date string.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns date string
 */
const date = (options) => {
    const opt = options?.[0] ?? config.locale;
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('date');
        }
        return value.toLocaleDateString(opt);
    };
};
/**
 * Time filter - formats Date object as localized time string.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns time string
 */
const time = (options) => {
    const opt = options?.[0] ?? config.locale;
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('time');
        }
        return value.toLocaleTimeString(opt);
    };
};
/**
 * DateTime filter - formats Date object as localized date and time string.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns datetime string
 */
const datetime = (options) => {
    const opt = options?.[0] ?? config.locale;
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('datetime');
        }
        return value.toLocaleString(opt);
    };
};
/**
 * Year-Month-Day filter - formats Date object as YYYY-MM-DD string.
 *
 * @param options - Array with separator string as first element (default: '-')
 * @returns Filter function that returns formatted date string
 */
const ymd = (options) => {
    const opt = options?.[0] ?? '-';
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('ymd');
        }
        const year = value.getFullYear().toString();
        const month = (value.getMonth() + 1).toString().padStart(2, '0');
        const day = value.getDate().toString().padStart(2, '0');
        return `${year}${opt}${month}${opt}${day}`;
    };
};
/**
 * Falsy filter - checks if value is falsy.
 *
 * @param options - Unused
 * @returns Filter function that returns true for false/null/undefined/0/''/NaN
 */
const falsy = (_options) => {
    return (value) => value === false || value === null || value === undefined || value === 0 || value === '' || Number.isNaN(value);
};
/**
 * Truthy filter - checks if value is truthy.
 *
 * @param options - Unused
 * @returns Filter function that returns true for non-falsy values
 */
const truthy = (_options) => {
    return (value) => value !== false && value !== null && value !== undefined && value !== 0 && value !== '' && !Number.isNaN(value);
};
/**
 * Default filter - returns default value if input is falsy.
 *
 * @param options - Array with default value as first element
 * @returns Filter function that returns value or default
 */
const defaults = (options) => {
    const opt = options?.[0] ?? optionsRequired('defaults');
    return (value) => {
        if (value === false || value === null || value === undefined || value === 0 || value === '' || Number.isNaN(value)) {
            return opt;
        }
        return value;
    };
};
/**
 * Boolean filter - converts value to boolean.
 *
 * @param options - Unused
 * @returns Filter function that returns boolean
 */
const boolean = (_options) => {
    return (value) => {
        return Boolean(value);
    };
};
/**
 * Number filter - converts value to number.
 *
 * @param options - Unused
 * @returns Filter function that returns number
 */
const number = (_options) => {
    return (value) => {
        return Number(value);
    };
};
/**
 * String filter - converts value to string.
 *
 * @param options - Unused
 * @returns Filter function that returns string
 */
const string = (_options) => {
    return (value) => {
        return String(value);
    };
};
/**
 * Null filter - converts empty string to null.
 *
 * @param options - Unused
 * @returns Filter function that returns null for empty string, otherwise original value
 */
const _null = (_options) => {
    return (value) => {
        return (value === "") ? null : value;
    };
};
const builtinFilters = {
    "eq": eq,
    "ne": ne,
    "not": not,
    "lt": lt,
    "le": le,
    "gt": gt,
    "ge": ge,
    "inc": inc,
    "dec": dec,
    "mul": mul,
    "div": div,
    "mod": mod,
    "fix": fix,
    "locale": locale,
    "uc": uc,
    "lc": lc,
    "cap": cap,
    "trim": trim,
    "slice": slice,
    "substr": substr,
    "pad": pad,
    "rep": rep,
    "rev": rev,
    "int": int,
    "float": float,
    "round": round,
    "floor": floor,
    "ceil": ceil,
    "percent": percent,
    "date": date,
    "time": time,
    "datetime": datetime,
    "ymd": ymd,
    "falsy": falsy,
    "truthy": truthy,
    "defaults": defaults,
    "boolean": boolean,
    "number": number,
    "string": string,
    "null": _null,
};
const outputBuiltinFilters = builtinFilters;
const inputBuiltinFilters = builtinFilters;
const builtinFiltersByFilterIOType = {
    "input": inputBuiltinFilters,
    "output": outputBuiltinFilters,
};
/**
 * Retrieves built-in filter function by name and options.
 *
 * @param name - Filter name
 * @param options - Array of option strings
 * @returns Function that takes FilterWithOptions and returns filter function
 */
const builtinFilterFn = (name, options) => (filters) => {
    const filter = filters[name];
    if (!filter) {
        raiseError(`filter not found: ${name}`);
    }
    return filter(options);
};

function parseFilterArgs(argsText) {
    const args = [];
    let current = '';
    let inQuote = null;
    let hasQuote = false;
    for (let i = 0; i < argsText.length; i++) {
        const char = argsText[i];
        if (inQuote) {
            if (char === inQuote) {
                inQuote = null;
            }
            else {
                current += char;
            }
        }
        else if (char === '"' || char === "'") {
            inQuote = char;
            hasQuote = true;
        }
        else if (char === ',') {
            args.push(current.trim());
            current = '';
            hasQuote = false;
        }
        else {
            current += char;
        }
    }
    const last = current.trim();
    if (last || hasQuote) {
        args.push(last);
    }
    return args;
}

const filterFnByKey = new Map();
// format: filterName(arg1,arg2) or filterName
function parseFilters(filterTextList, filterIOType) {
    const builtinFilters = builtinFiltersByFilterIOType[filterIOType];
    const filters = filterTextList.map((filterText) => {
        const openParenIndex = filterText.indexOf('(');
        const closeParenIndex = filterText.lastIndexOf(')');
        // check parentheses
        if (openParenIndex !== -1 && closeParenIndex === -1) {
            raiseError(`Invalid filter format: missing closing parenthesis in "${filterText}"`);
        }
        if (closeParenIndex !== -1 && openParenIndex === -1) {
            raiseError(`Invalid filter format: missing opening parenthesis in "${filterText}"`);
        }
        if (openParenIndex === -1) {
            // no arguments
            const filterName = filterText.trim();
            const filterKey = `${filterName}():${filterIOType}`;
            let filterFn = filterFnByKey.get(filterKey);
            if (typeof filterFn === 'undefined') {
                filterFn = builtinFilterFn(filterName, [])(builtinFilters);
                filterFnByKey.set(filterKey, filterFn);
            }
            return {
                filterName: filterName,
                args: [],
                filterFn: filterFn,
            };
        }
        else {
            const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
            const filterName = filterText.substring(0, openParenIndex).trim();
            const args = parseFilterArgs(argsText);
            const filterKey = `${filterName}(${args.join(',')}):${filterIOType}`;
            let filterFn = filterFnByKey.get(filterKey);
            if (typeof filterFn === 'undefined') {
                filterFn = builtinFilterFn(filterName, args)(builtinFilters);
                filterFnByKey.set(filterKey, filterFn);
            }
            return {
                filterName,
                args,
                filterFn,
            };
        }
    });
    return filters;
}

const trimFn = (s) => s.trim();

const cacheFilterInfos$1 = new Map();
// format: propName#moodifier1,modifier2
// propName-format: path.to.property (e.g., textContent, style.color, not include :)
// special path: 
//   'attr.attributeName' for attributes (e.g., attr.href, attr.data-id)
//   'style.propertyName' for style properties (e.g., style.backgroundColor, style.fontSize)
//   'class.className' for class names (e.g., class.active, class.hidden)
//   'onclick', 'onchange' etc. for event listeners
function parsePropPart(propPart) {
    const pos = propPart.indexOf(FILTER_SEPARATOR);
    let propText = '';
    let filterTexts = [];
    let filtersText = '';
    let filters = [];
    if (pos !== -1) {
        propText = propPart.slice(0, pos).trim();
        filtersText = propPart.slice(pos + 1).trim();
        if (cacheFilterInfos$1.has(filtersText)) {
            filters = cacheFilterInfos$1.get(filtersText);
        }
        else {
            filterTexts = filtersText.split(FILTER_SEPARATOR).map(trimFn);
            filters = parseFilters(filterTexts, "input");
            cacheFilterInfos$1.set(filtersText, filters);
        }
    }
    else {
        propText = propPart.trim();
    }
    const [propName, propModifiersText] = propText.split(MODIFIER_SEPARATOR).map(trimFn);
    const propSegments = propName.split(DELIMITER).map(trimFn);
    const propModifiers = propModifiersText
        ? propModifiersText.split(',').map(trimFn)
        : [];
    return {
        propName,
        propSegments,
        propModifiers,
        inFilters: filters,
    };
}

const cacheFilterInfos = new Map();
// format: statePath@stateName|filter|filter
// statePath-format: path.to.property (e.g., user.name.first, users.*.name, users.0.name, not include @)
// stateName: optional, default is 'default'
// filters-format: filterName or filterName(arg1,arg2)
function parseStatePart(statePart) {
    const pos = statePart.indexOf(FILTER_SEPARATOR);
    let stateAndPath = '';
    let filterTexts = [];
    let filtersText = '';
    let filters = [];
    if (pos !== -1) {
        stateAndPath = statePart.slice(0, pos).trim();
        filtersText = statePart.slice(pos + 1).trim();
        if (cacheFilterInfos.has(filtersText)) {
            filters = cacheFilterInfos.get(filtersText);
        }
        else {
            filterTexts = filtersText.split(FILTER_SEPARATOR).map(trimFn);
            filters = parseFilters(filterTexts, "output");
            cacheFilterInfos.set(filtersText, filters);
        }
    }
    else {
        stateAndPath = statePart.trim();
    }
    const [statePathName, stateName = 'default'] = stateAndPath.split(STATE_NAME_SEPARATOR).map(trimFn);
    const pathInfo = getPathInfo(statePathName);
    return {
        stateName,
        statePathName,
        statePathInfo: pathInfo,
        outFilters: filters,
    };
}

// format: propPart:statePart; propPart:statePart; ...
// special-propPart:
//   if: statePart (single binding for conditional rendering)
//   else: (single binding for conditional rendering, and statePart is ignored)
//   elseif: statePart only (single binding for conditional rendering)
//   for: statePart only (single binding for loop rendering)
//   onclick: statePart, onchange: statePart etc. (event listeners)
//   ...: statePart (spread — expand wcBindable properties+inputs of target object)
function parseBindTextsForElement(bindText) {
    const [...bindTexts] = bindText.split(BINDING_SEPARATOR).map(trimFn).filter(s => s.length > 0);
    const results = bindTexts.map((bindText) => {
        const separatorIndex = bindText.indexOf(PROP_VALUE_SEPARATOR);
        if (separatorIndex === -1) {
            raiseError(`Invalid bindText: "${bindText}". Missing ':' separator between propPart and statePart.`);
        }
        const propPart = bindText.slice(0, separatorIndex).trim();
        const statePart = bindText.slice(separatorIndex + 1).trim();
        if (propPart === 'else') {
            const pathInfo = getPathInfo('#else');
            return {
                propName: 'else',
                propSegments: ['else'],
                propModifiers: [],
                statePathName: '#else',
                statePathInfo: pathInfo,
                stateName: '',
                inFilters: [],
                outFilters: [],
                bindingType: 'else',
            };
        }
        else if (propPart === '...') {
            const stateResult = parseStatePart(statePart);
            if (stateResult.outFilters.length > 0) {
                raiseError(`Invalid spread binding "${bindText}": filters are not allowed on spread targets.`);
            }
            if (stateResult.statePathName.length === 0) {
                raiseError(`Invalid spread binding "${bindText}": spread target path is required.`);
            }
            return {
                propName: '...',
                propSegments: ['...'],
                propModifiers: [],
                inFilters: [],
                ...stateResult,
                bindingType: 'spread',
            };
        }
        else if (propPart === 'if'
            || propPart === 'elseif'
            || propPart === 'for'
            || propPart === 'radio'
            || propPart === 'checkbox') {
            const stateResult = parseStatePart(statePart);
            return {
                propName: propPart,
                propSegments: [propPart],
                propModifiers: [],
                inFilters: [],
                ...stateResult,
                bindingType: propPart,
            };
        }
        else {
            const stateResult = parseStatePart(statePart);
            const propResult = parsePropPart(propPart);
            // eventToken.<prop>: <name> は要素 dispatch を state へ流す pub/sub 配線。
            // 値適用ではないため bindingType 'event' として listener attach 経路に乗せる。
            if (propResult.propSegments[0] === 'eventToken') {
                return {
                    ...propResult,
                    ...stateResult,
                    bindingType: 'event',
                };
            }
            if (propResult.propSegments[0].startsWith('on')) {
                return {
                    ...propResult,
                    ...stateResult,
                    bindingType: 'event',
                };
            }
            else {
                return {
                    ...propResult,
                    ...stateResult,
                    bindingType: 'prop',
                };
            }
        }
    });
    // check for sigle binding for 'if', 'elseif', 'else', 'for'
    if (results.length > 1) {
        const isIncludeSingleBinding = results.some(r => STRUCTURAL_BINDING_TYPE_SET.has(r.bindingType));
        if (isIncludeSingleBinding) {
            raiseError(`Invalid bindText: "${bindText}". 'if', 'elseif', 'else', and 'for' bindings must be single binding.`);
        }
    }
    return results;
}

const bindTextByNode = new WeakMap();
// format: <!--@@wcs-text:path-->
// bind-stateはconfig.commentTextPrefixで変更可能
// format: <!--@@wcs-for:UUID-->
// bind-stateはconfig.commentForPrefixで変更可能
// format: <!--@@wcs-if:UUID-->
// bind-stateはconfig.commentIfPrefixで変更可能
// format: <!--@@wcs-else:UUID-->
// bind-stateはconfig.commentElsePrefixで変更可能
// format: <!--@@wcs-elseif:UUID-->
// bind-stateはconfig.commentElseIfPrefixで変更可能
const bindingTypeKeywordSet = new Set([
    config.commentTextPrefix,
    config.commentForPrefix,
    config.commentIfPrefix,
    config.commentElseIfPrefix,
    config.commentElsePrefix,
]);
// format: <!--@@:path-->は<!--@@wcs-text:path-->と同義にする
const EMBEDDED_REGEX = new RegExp(`^\\s*@@\\s*(.*?)\\s*:\\s*(.+?)\\s*$`);
function parseCommentNode(node) {
    const savedText = bindTextByNode.get(node);
    if (typeof savedText === "string") {
        return savedText;
    }
    if (node.nodeType !== Node.COMMENT_NODE) {
        return null;
    }
    const commentNode = node;
    const text = commentNode.data.trim();
    const match = EMBEDDED_REGEX.exec(text);
    if (match === null) {
        return null;
    }
    // 空の場合は wcs-text として扱う
    const keyword = match[1] || config.commentTextPrefix;
    if (!bindingTypeKeywordSet.has(keyword)) {
        return null;
    }
    bindTextByNode.set(node, match[2]);
    return match[2];
}

function parseBindTextForEmbeddedNode(bindText) {
    const stateResult = parseStatePart(bindText);
    return {
        propName: 'textContent',
        propSegments: ['textContent'],
        propModifiers: [],
        inFilters: [],
        ...stateResult,
        bindingType: 'text',
    };
}

const fragmentInfoByUUID = new Map();
function setFragmentInfoByUUID(uuid, rootNode, fragmentInfo) {
    if (fragmentInfo === null) {
        fragmentInfoByUUID.delete(uuid);
    }
    else {
        fragmentInfoByUUID.set(uuid, fragmentInfo);
        const bindingPartial = fragmentInfo.parseBindTextResult;
        const stateElement = getStateElementByName(rootNode, bindingPartial.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${bindingPartial.stateName}" not found for fragment info.`);
        }
        stateElement.setPathInfo(bindingPartial.statePathName, bindingPartial.bindingType);
        for (const nodeInfo of fragmentInfo.nodeInfos) {
            for (const nodeBindingPartial of nodeInfo.parseBindTextResults) {
                const nodeStateElement = getStateElementByName(rootNode, nodeBindingPartial.stateName);
                if (nodeStateElement === null) {
                    raiseError(`State element with name "${nodeBindingPartial.stateName}" not found for fragment info node.`);
                }
                nodeStateElement.setPathInfo(nodeBindingPartial.statePathName, nodeBindingPartial.bindingType);
            }
        }
    }
}
function getFragmentInfoByUUID(uuid) {
    return fragmentInfoByUUID.get(uuid) || null;
}
function getAllFragmentUUIDs() {
    return Array.from(fragmentInfoByUUID.keys());
}

function getParseBindTextResults(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node;
        const bindText = element.getAttribute(config.bindAttributeName) || '';
        return parseBindTextsForElement(bindText);
    }
    else if (node.nodeType === Node.COMMENT_NODE) {
        const bindTextOrUUID = parseCommentNode(node);
        if (bindTextOrUUID === null) {
            raiseError(`Comment node binding text not found.`);
        }
        const fragmentInfo = getFragmentInfoByUUID(bindTextOrUUID);
        let parseBindingTextResult = fragmentInfo?.parseBindTextResult ?? null;
        let uuid = null;
        if (parseBindingTextResult === null) {
            // It is not a structural fragment UUID, so treat it as bindText
            parseBindingTextResult = parseBindTextForEmbeddedNode(bindTextOrUUID);
            uuid = null;
        }
        else {
            uuid = bindTextOrUUID;
        }
        return [{
                ...parseBindingTextResult,
                uuid: uuid,
            }];
    }
    return [];
}

/**
 * data-wcs 属性または埋め込みノード<!--{{}}-->を持つノードをすべて取得する
 * @param root
 * @returns
 */
function getSubscriberNodes(root) {
    const subscriberNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, {
        acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                const hasBinding = element.hasAttribute(config.bindAttributeName);
                return hasBinding
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
            else {
                // Comment node
                return parseCommentNode(node) !== null
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
        }
    });
    while (walker.nextNode()) {
        subscriberNodes.push(walker.currentNode);
    }
    return subscriberNodes;
}

const registeredNodeSet = new WeakSet();
function processParseResultsForNode(node, parseResults, options) {
    const expanded = expandSpread(node, parseResults, { allowDeferred: options.allowDeferred });
    if (hasUnresolvedSpread(expanded)) {
        const tagName = node.nodeType === Node.ELEMENT_NODE
            ? getCustomElement(node)
            : null;
        if (tagName === null) {
            raiseError(`Spread binding deferred but element is not a custom element.`);
        }
        return { bindings: [], deferred: { node, tagName, parseResults } };
    }
    registeredNodeSet.add(node);
    const bindings = getBindingInfos(node, expanded);
    setBindingsByNode(node, bindings);
    resolveInitializedBinding(node);
    return { bindings, deferred: null };
}
function collectNodesAndBindingInfos(root) {
    const subscriberNodes = getSubscriberNodes(root);
    const allBindings = [];
    const deferredSpreads = [];
    for (const node of subscriberNodes) {
        if (registeredNodeSet.has(node))
            continue;
        const parseResults = getParseBindTextResults(node);
        const result = processParseResultsForNode(node, parseResults, { allowDeferred: true });
        if (result.deferred !== null) {
            deferredSpreads.push(result.deferred);
            continue;
        }
        allBindings.push(...result.bindings);
    }
    return [subscriberNodes, allBindings, deferredSpreads];
}
function collectNodesAndBindingInfosByFragment(root, nodeInfos) {
    const nodes = [];
    const allBindings = [];
    for (const nodeInfo of nodeInfos) {
        const node = resolveNodePath(root, nodeInfo.nodePath);
        if (node === null) {
            raiseError(`Node not found by path [${nodeInfo.nodePath.join(', ')}] in fragment.`);
        }
        if (registeredNodeSet.has(node))
            continue;
        const result = processParseResultsForNode(node, nodeInfo.parseBindTextResults, { allowDeferred: false });
        // deferred is impossible when allowDeferred=false (expandSpread raises instead)
        allBindings.push(...result.bindings);
        nodes.push(node);
    }
    return [nodes, allBindings];
}
function unregisterNode(node) {
    registeredNodeSet.delete(node);
}
/**
 * RowPlan 経路（createContent のプラン実体化）用。パース・spread 展開を経ずに
 * binding を組み立てた subscriber ノードを二重処理防止台帳へ載せる
 * （後続の collectNodesAndBindingInfos による再スキャンから保護）。
 */
function markNodeRegistered(node) {
    registeredNodeSet.add(node);
}
/**
 * Re-process a deferred spread entry once the custom element class is
 * registered. Expands the captured parseResults, installs bindings, and
 * returns them so the caller can attach handlers and apply state values.
 */
function processDeferredNode(entry) {
    const { node, parseResults } = entry;
    unregisterNode(node);
    const result = processParseResultsForNode(node, parseResults, { allowDeferred: false });
    return result.bindings;
}

const loopContextByNode = new WeakMap();
function getLoopContextByNode(node) {
    let paramNode = node;
    while (paramNode) {
        const loopContext = loopContextByNode.get(paramNode);
        if (loopContext) {
            return loopContext;
        }
        paramNode = paramNode.parentNode;
    }
    return null;
}
function setLoopContextByNode(node, loopContext) {
    if (loopContext === null) {
        loopContextByNode.delete(node);
        return;
    }
    loopContextByNode.set(node, loopContext);
}

const lastListValueByAbsoluteStateAddress = new WeakMap();
function getLastListValueByAbsoluteStateAddress(address) {
    return lastListValueByAbsoluteStateAddress.get(address) ?? [];
}
function setLastListValueByAbsoluteStateAddress(address, value) {
    lastListValueByAbsoluteStateAddress.set(address, value);
}

const setLoopContextAsyncSymbol = Symbol("$$setLoopContextAsync");
const setLoopContextSymbol = Symbol("$$setLoopContext");
const getByAddressSymbol = Symbol("$$getByAddress");
const hasByAddressSymbol = Symbol("$$hasByAddress");
const setByAddressSymbol = Symbol("$$setByAddress");
const connectedCallbackSymbol = Symbol("$$connectedCallback");
const disconnectedCallbackSymbol = Symbol("$$disconnectedCallback");
const updatedCallbackSymbol = Symbol("$$updatedCallback");

const _cache$3 = new WeakMap();
function getAbsolutePathInfo(stateElement, pathInfo) {
    if (_cache$3.has(stateElement)) {
        const pathMap = _cache$3.get(stateElement);
        if (pathMap.has(pathInfo)) {
            return pathMap.get(pathInfo);
        }
    }
    else {
        _cache$3.set(stateElement, new WeakMap());
    }
    const absolutePathInfo = Object.freeze(new AbsolutePathInfo(stateElement, pathInfo));
    _cache$3.get(stateElement).set(pathInfo, absolutePathInfo);
    return absolutePathInfo;
}
class AbsolutePathInfo {
    pathInfo;
    stateName;
    stateElement;
    parentAbsolutePathInfo;
    constructor(stateElement, pathInfo) {
        this.pathInfo = pathInfo;
        this.stateName = stateElement.name;
        this.stateElement = stateElement;
        if (pathInfo.parentPathInfo === null) {
            this.parentAbsolutePathInfo = null;
        }
        else {
            this.parentAbsolutePathInfo = getAbsolutePathInfo(stateElement, pathInfo.parentPathInfo);
        }
    }
}

const _cache$2 = new WeakMap();
const _cacheNullListIndex$1 = new WeakMap();
class AbsoluteStateAddress {
    absolutePathInfo;
    listIndex;
    _parentAbsoluteAddress;
    constructor(absolutePathInfo, listIndex) {
        this.absolutePathInfo = absolutePathInfo;
        this.listIndex = listIndex;
    }
    get parentAbsoluteAddress() {
        if (typeof this._parentAbsoluteAddress !== 'undefined') {
            return this._parentAbsoluteAddress;
        }
        const parentAbsolutePathInfo = this.absolutePathInfo.parentAbsolutePathInfo;
        if (parentAbsolutePathInfo === null) {
            return null;
        }
        const lastSegment = this.absolutePathInfo.pathInfo.segments[this.absolutePathInfo.pathInfo.segments.length - 1];
        let parentListIndex = null;
        if (lastSegment === WILDCARD) {
            parentListIndex = this.listIndex?.parentListIndex ?? null;
        }
        else {
            parentListIndex = this.listIndex;
        }
        return this._parentAbsoluteAddress = createAbsoluteStateAddress(parentAbsolutePathInfo, parentListIndex);
    }
}
function createAbsoluteStateAddress(absolutePathInfo, listIndex) {
    if (listIndex === null) {
        let cached = _cacheNullListIndex$1.get(absolutePathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new AbsoluteStateAddress(absolutePathInfo, null);
        _cacheNullListIndex$1.set(absolutePathInfo, cached);
        return cached;
    }
    else {
        let cacheByAbsolutePathInfo = _cache$2.get(listIndex);
        if (typeof cacheByAbsolutePathInfo === "undefined") {
            cacheByAbsolutePathInfo = new WeakMap();
            _cache$2.set(listIndex, cacheByAbsolutePathInfo);
        }
        let cached = cacheByAbsolutePathInfo.get(absolutePathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new AbsoluteStateAddress(absolutePathInfo, listIndex);
        cacheByAbsolutePathInfo.set(absolutePathInfo, cached);
        return cached;
    }
}

const rootNodeByFragment = new WeakMap();
function setRootNodeByFragment(fragment, rootNode) {
    if (rootNode === null) {
        rootNodeByFragment.delete(fragment);
    }
    else {
        rootNodeByFragment.set(fragment, rootNode);
    }
}
function getRootNodeByFragment(fragment) {
    return rootNodeByFragment.get(fragment) || null;
}

const cacheCalcWildcardLen = new Map();
function calcWildcardLen(pathInfo, targetPathInfo) {
    let path1;
    let path2;
    if (pathInfo.wildcardCount === 0 || targetPathInfo.wildcardCount === 0) {
        return 0;
    }
    if (pathInfo.wildcardCount === 1
        && targetPathInfo.wildcardCount > 0
        && targetPathInfo.wildcardPathSet.has(pathInfo.path)) {
        return 1;
    }
    if (pathInfo.id < targetPathInfo.id) {
        path1 = pathInfo;
        path2 = targetPathInfo;
    }
    else {
        path1 = targetPathInfo;
        path2 = pathInfo;
    }
    const key = `${path1.path}\t${path2.path}`;
    let len = cacheCalcWildcardLen.get(key);
    if (typeof len !== "undefined") {
        return len;
    }
    const matchPath = path1.wildcardPathSet.intersection(path2.wildcardPathSet);
    len = matchPath.size;
    cacheCalcWildcardLen.set(key, len);
    return len;
}

const listIndexByBindingInfoByLoopContext = new WeakMap();
function getListIndexByBindingInfo(bindingInfo) {
    const loopContext = getLoopContextByNode(bindingInfo.node);
    if (loopContext === null) {
        return null;
    }
    let listIndexByBindingInfo = listIndexByBindingInfoByLoopContext.get(loopContext);
    if (typeof listIndexByBindingInfo === "undefined") {
        listIndexByBindingInfo = new WeakMap();
        listIndexByBindingInfoByLoopContext.set(loopContext, listIndexByBindingInfo);
    }
    else {
        const listIndex = listIndexByBindingInfo.get(bindingInfo);
        if (typeof listIndex !== "undefined") {
            return listIndex;
        }
    }
    let listIndex = null;
    try {
        const wildcardLen = calcWildcardLen(loopContext.pathInfo, bindingInfo.statePathInfo);
        if (wildcardLen > 0) {
            listIndex = loopContext.listIndex.at(wildcardLen - 1);
        }
        return listIndex;
    }
    finally {
        listIndexByBindingInfo.set(bindingInfo, listIndex);
    }
}

const absoluteStateAddressByBinding = new WeakMap();
/**
 * binding の解決済み root を返す。knownRootNode があれば getRootNode() と
 * fragment フォールバックを省略する（リスト行活性化のホットパス）。
 */
function resolveBindingRootNode(binding, knownRootNode) {
    if (knownRootNode != null) {
        return knownRootNode;
    }
    let rootNode = binding.replaceNode.getRootNode();
    // binding.replaceNodeはisConnected=trueになっていることが前提、切断されている場合はraiseErrorを返す
    if (binding.replaceNode.isConnected === false) {
        // DocumentFragmentでバッファリングされている場合は、ルートノードをDocumentFragmentから実際のルートノードに切り替える
        const rootNodeByFragment = getRootNodeByFragment(rootNode);
        if (rootNodeByFragment === null) {
            raiseError(`Cannot get absolute state address for disconnected binding: ${binding.bindingType} ${binding.statePathName} on ${binding.node.nodeName}`);
        }
        else {
            rootNode = rootNodeByFragment;
        }
    }
    return rootNode;
}
function getAbsoluteStateAddressByBinding(binding, knownRootNode) {
    // 切断されていても、キャッシュされていれば絶対状態アドレスを返す。
    let absoluteStateAddress = null;
    absoluteStateAddress = absoluteStateAddressByBinding.get(binding) || null;
    if (absoluteStateAddress !== null) {
        return absoluteStateAddress;
    }
    const rootNode = resolveBindingRootNode(binding, knownRootNode);
    const listIndex = getListIndexByBindingInfo(binding);
    const stateElement = getStateElementByName(rootNode, binding.stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${binding.stateName}" not found for binding.`);
    }
    const absolutePathInfo = getAbsolutePathInfo(stateElement, binding.statePathInfo);
    absoluteStateAddress =
        createAbsoluteStateAddress(absolutePathInfo, listIndex);
    absoluteStateAddressByBinding.set(binding, absoluteStateAddress);
    return absoluteStateAddress;
}
function clearAbsoluteStateAddressByBinding(binding) {
    absoluteStateAddressByBinding.delete(binding);
}

/**
 * devtools/sink.ts
 *
 * 計装点が参照するホットパス唯一の接点。依存ゼロの葉モジュールにすることで、
 * 計装される側（stateElementByName / setByAddress / binding / token）と
 * bridge の間の循環 import を避ける。
 *
 * コスト規範（protocol §1-1）: フック未接続時、計装点のコストは
 * `devtoolsSink !== null` の分岐 1 個。イベントオブジェクトの生成は
 * 必ずこのチェックの内側で行うこと。
 */
/** live binding としてエクスポート。計装点は `if (devtoolsSink !== null)` で参照する */
let devtoolsSink = null;
function setDevtoolsSink(sink) {
    devtoolsSink = sink;
}

/**
 * 絶対アドレス → 登録 binding の台帳。
 *
 * リスト行の絶対アドレスは (absolutePathInfo, listIndex) の組ごとに一意で、
 * 登録される binding は通常 1 本しかない。アドレスごとに Set を確保すると
 * 行×binding の数だけ Set アロケーションが積み上がるため、単一値で持ち
 * 2 本目から Set に昇格する（interestedSessionsByNode と同じ前例）。
 */
const bindingsByAbsoluteStateAddress = new WeakMap();
function addBindingByAbsoluteStateAddress(absoluteStateAddress, binding) {
    const current = bindingsByAbsoluteStateAddress.get(absoluteStateAddress);
    if (typeof current === "undefined") {
        bindingsByAbsoluteStateAddress.set(absoluteStateAddress, binding);
    }
    else if (current instanceof Set) {
        current.add(binding);
    }
    else if (current !== binding) {
        bindingsByAbsoluteStateAddress.set(absoluteStateAddress, new Set([current, binding]));
    }
    if (devtoolsSink !== null) {
        devtoolsSink({ type: "state:binding-added", absoluteAddress: absoluteStateAddress, binding });
    }
}
function removeBindingByAbsoluteStateAddress(absoluteStateAddress, binding) {
    const current = bindingsByAbsoluteStateAddress.get(absoluteStateAddress);
    if (typeof current === "undefined") {
        return;
    }
    if (current instanceof Set) {
        current.delete(binding);
    }
    else if (current === binding) {
        bindingsByAbsoluteStateAddress.delete(absoluteStateAddress);
    }
    if (devtoolsSink !== null) {
        devtoolsSink({ type: "state:binding-removed", absoluteAddress: absoluteStateAddress, binding });
    }
}
/**
 * パターン索引台帳（リスト行バインディング専用・docs/state-row-instantiation-redesign.md §3-3）。
 *
 * 行バインディングは (absolutePathInfo, listIndex) の 2 段キーで登録し、登録側では
 * AbsoluteStateAddress の intern（アドレスオブジェクト割当 + listIndex ごとの
 * intern 用 WeakMap）を一切行わない。書き込み側（setByAddress → enqueue）は従来
 * どおり intern 済みアドレスを使うため、drain はアドレスの構成要素
 * （absolutePathInfo / listIndex — どちらもオブジェクト同一性が保証済み）で
 * このパターン台帳を引ける。リオーダーは listIndex 同一性キーの帰結として
 * 従来同様ゼロタッチ。wholesale destroy は従来同様削除ゼロ（listIndex ごと GC 崩壊）。
 *
 * devtools 計装（state:binding-added/removed）はプロトコル契約なので、sink 接続時に
 * 限りアドレスを intern してイベントを流す（フック未接続時のコストは分岐 1 個の規範を維持）。
 */
const patternLedger = new WeakMap();
function addBindingByPattern(absolutePathInfo, listIndex, binding) {
    let rowMap = patternLedger.get(absolutePathInfo);
    if (typeof rowMap === "undefined") {
        rowMap = new WeakMap();
        patternLedger.set(absolutePathInfo, rowMap);
    }
    const current = rowMap.get(listIndex);
    if (typeof current === "undefined") {
        rowMap.set(listIndex, binding);
    }
    else if (current instanceof Set) {
        current.add(binding);
    }
    else if (current !== binding) {
        rowMap.set(listIndex, new Set([current, binding]));
    }
    if (devtoolsSink !== null) {
        devtoolsSink({ type: "state:binding-added", absoluteAddress: createAbsoluteStateAddress(absolutePathInfo, listIndex), binding });
    }
}
function removeBindingByPattern(absolutePathInfo, listIndex, binding) {
    const rowMap = patternLedger.get(absolutePathInfo);
    if (typeof rowMap === "undefined") {
        return;
    }
    const current = rowMap.get(listIndex);
    if (typeof current === "undefined") {
        return;
    }
    if (current instanceof Set) {
        current.delete(binding);
    }
    else if (current === binding) {
        rowMap.delete(listIndex);
    }
    if (devtoolsSink !== null) {
        devtoolsSink({ type: "state:binding-removed", absoluteAddress: createAbsoluteStateAddress(absolutePathInfo, listIndex), binding });
    }
}
/**
 * drain（updater）用の統合参照。従来台帳 → パターン台帳の順に引く。
 * 従来台帳を先に引くのは、listIndex 付きでも旧経路（SSR ハイドレーション等）で
 * アドレス台帳に登録される可能性を許容するため（取りこぼし防止）。
 */
function peekBindingsForAddress(absoluteStateAddress) {
    const entry = bindingsByAbsoluteStateAddress.get(absoluteStateAddress);
    if (typeof entry !== "undefined") {
        return entry;
    }
    if (absoluteStateAddress.listIndex === null) {
        return undefined;
    }
    return patternLedger.get(absoluteStateAddress.absolutePathInfo)?.get(absoluteStateAddress.listIndex);
}

const _cache$1 = new WeakMap();
const _cacheNullListIndex = new WeakMap();
class StateAddress {
    pathInfo;
    listIndex;
    _parentAddress;
    constructor(pathInfo, listIndex) {
        this.pathInfo = pathInfo;
        this.listIndex = listIndex;
    }
    get parentAddress() {
        if (typeof this._parentAddress !== 'undefined') {
            return this._parentAddress;
        }
        const parentPathInfo = this.pathInfo.parentPathInfo;
        if (parentPathInfo === null) {
            return null;
        }
        const lastSegment = this.pathInfo.segments[this.pathInfo.segments.length - 1];
        let parentListIndex = null;
        if (lastSegment === WILDCARD) {
            parentListIndex = this.listIndex?.parentListIndex ?? null;
        }
        else {
            parentListIndex = this.listIndex;
        }
        return this._parentAddress = createStateAddress(parentPathInfo, parentListIndex);
    }
}
function createStateAddress(pathInfo, listIndex) {
    if (listIndex === null) {
        let cached = _cacheNullListIndex.get(pathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new StateAddress(pathInfo, null);
        _cacheNullListIndex.set(pathInfo, cached);
        return cached;
    }
    else {
        let cacheByPathInfo = _cache$1.get(listIndex);
        if (typeof cacheByPathInfo === "undefined") {
            cacheByPathInfo = new WeakMap();
            _cache$1.set(listIndex, cacheByPathInfo);
        }
        let cached = cacheByPathInfo.get(pathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new StateAddress(pathInfo, listIndex);
        cacheByPathInfo.set(pathInfo, cached);
        return cached;
    }
}

const stateAddressByBindingInfo = new WeakMap();
function getStateAddressByBindingInfo(bindingInfo) {
    let stateAddress = null;
    stateAddress = stateAddressByBindingInfo.get(bindingInfo) || null;
    if (stateAddress !== null) {
        return stateAddress;
    }
    if (bindingInfo.statePathInfo.wildcardCount > 0) {
        const listIndex = getListIndexByBindingInfo(bindingInfo);
        if (listIndex === null) {
            raiseError(`Cannot resolve state address for binding with wildcard statePathName "${bindingInfo.statePathName}" because list index is null.`);
        }
        stateAddress = createStateAddress(bindingInfo.statePathInfo, listIndex);
    }
    else {
        stateAddress = createStateAddress(bindingInfo.statePathInfo, null);
    }
    stateAddressByBindingInfo.set(bindingInfo, stateAddress);
    return stateAddress;
}
// call for change loopContext
function clearStateAddressByBindingInfo(bindingInfo) {
    stateAddressByBindingInfo.delete(bindingInfo);
}

function createHandlerBindingRegistry() {
    const attachedByKey = new Map();
    const countByKey = new Map();
    return {
        add(key, binding) {
            let attached = attachedByKey.get(key);
            if (typeof attached === "undefined") {
                attached = new WeakSet();
                attachedByKey.set(key, attached);
            }
            if (attached.has(binding)) {
                return false;
            }
            attached.add(binding);
            countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
            return true;
        },
        remove(key, binding) {
            const attached = attachedByKey.get(key);
            if (typeof attached === "undefined" || !attached.has(binding)) {
                return false;
            }
            attached.delete(binding);
            const next = (countByKey.get(key) ?? 1) - 1;
            if (next <= 0) {
                attachedByKey.delete(key);
                countByKey.delete(key);
                return true;
            }
            countByKey.set(key, next);
            return false;
        },
        has(key, binding) {
            return attachedByKey.get(key)?.has(binding) ?? false;
        },
        countOf(key) {
            return countByKey.get(key) ?? 0;
        },
        get keyCount() {
            return countByKey.size;
        },
        clear() {
            attachedByKey.clear();
            countByKey.clear();
        },
    };
}

const handlerByHandlerKey$3 = new Map();
// binding を強参照しない台帳（handlerBindingRegistry.ts のリーク解説を参照）
const bindingRegistry$3 = createHandlerBindingRegistry();
function getHandlerKey$3(binding, eventName) {
    const filterKey = binding.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
    return `${binding.stateName}::${binding.statePathName}::${eventName}::${filterKey}`;
}
function getEventName$2(binding) {
    let eventName = 'input';
    for (const modifier of binding.propModifiers) {
        if (modifier.startsWith('on')) {
            eventName = modifier.slice(2);
        }
    }
    return eventName;
}
const checkboxEventHandlerFunction = (stateName, statePathName, inFilters) => (event) => {
    const node = event.target;
    if (node === null) {
        console.warn(`[@wcstack/state] event.target is null.`);
        return;
    }
    if (node.type !== 'checkbox') {
        console.warn(`[@wcstack/state] event.target is not a checkbox input element.`);
        return;
    }
    const checked = node.checked;
    const newValue = node.value;
    let filteredNewValue = newValue;
    for (const filter of inFilters) {
        filteredNewValue = filter.filterFn(filteredNewValue);
    }
    const rootNode = node.getRootNode();
    const stateElement = getStateElementByName(rootNode, stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for two-way binding.`);
    }
    const loopContext = getLoopContextByNode(node);
    stateElement.createState("writable", (state) => {
        state[setLoopContextSymbol](loopContext, () => {
            let currentValue = state[statePathName];
            if (Array.isArray(currentValue)) {
                if (checked) {
                    if (currentValue.indexOf(filteredNewValue) === -1) {
                        state[statePathName] = currentValue.concat(filteredNewValue);
                    }
                }
                else {
                    const index = currentValue.indexOf(filteredNewValue);
                    if (index !== -1) {
                        state[statePathName] = currentValue.toSpliced(index, 1);
                    }
                }
            }
            else {
                if (checked) {
                    state[statePathName] = [filteredNewValue];
                }
                else {
                    state[statePathName] = [];
                }
            }
        });
    });
};
function attachCheckboxEventHandler(binding) {
    if (binding.bindingType === "checkbox" && binding.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName$2(binding);
        const key = getHandlerKey$3(binding, eventName);
        let checkboxEventHandler = handlerByHandlerKey$3.get(key);
        if (typeof checkboxEventHandler === "undefined") {
            checkboxEventHandler = checkboxEventHandlerFunction(binding.stateName, binding.statePathName, binding.inFilters);
            handlerByHandlerKey$3.set(key, checkboxEventHandler);
        }
        binding.node.addEventListener(eventName, checkboxEventHandler);
        bindingRegistry$3.add(key, binding);
        return true;
    }
    return false;
}
function detachCheckboxEventHandler(binding) {
    if (binding.bindingType === "checkbox" && binding.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName$2(binding);
        const key = getHandlerKey$3(binding, eventName);
        const checkboxEventHandler = handlerByHandlerKey$3.get(key);
        if (typeof checkboxEventHandler === "undefined") {
            return false;
        }
        binding.node.removeEventListener(eventName, checkboxEventHandler);
        if (bindingRegistry$3.countOf(key) === 0) {
            return false;
        }
        if (bindingRegistry$3.remove(key, binding)) {
            handlerByHandlerKey$3.delete(key);
        }
        return true;
    }
    return false;
}

// command-token / event-token が共有する pub/sub プリミティブ。
// _subscribers は Set のため挿入順を保持する。
// emit() は subscribe() された順に呼び出され、戻り値配列も同じ順序で返る。
//
// 「誰が subscribe し誰が emit するか」だけが command / event の違い:
//   - command-token: element が subscribe / state が emit
//   - event-token:   state(`$on`) が subscribe / element(listener) が emit
class Token {
    _name;
    _subscribers = new Set();
    constructor(name) {
        this._name = name;
    }
    get name() {
        return this._name;
    }
    get size() {
        return this._subscribers.size;
    }
    subscribe(fn) {
        this._subscribers.add(fn);
        return () => {
            this._subscribers.delete(fn);
        };
    }
    unsubscribe(fn) {
        return this._subscribers.delete(fn);
    }
    emit(...args) {
        const results = [];
        for (const fn of this._subscribers) {
            results.push(fn(...args));
        }
        return results;
    }
}

// EventToken は共有 pub/sub プリミティブ Token の薄い特化（element→state 方向）。
// instanceof による型判別を成立させるため独立クラスとして維持する。
//
// ownerStateName は devtools 計装（protocol §4.5）のための内部 optional 引数。
// event-token-protocol の外部仕様は不変更。
class EventToken extends Token {
    _ownerStateName;
    constructor(name, ownerStateName) {
        super(name);
        this._ownerStateName = ownerStateName ?? null;
    }
    emit(...args) {
        if (devtoolsSink !== null) {
            devtoolsSink({
                type: "state:token-emit",
                kind: "event",
                stateName: this._ownerStateName,
                tokenName: this.name,
                args,
                subscriberCount: this.size,
            });
        }
        return super.emit(...args);
    }
}

const registryByStateElement$2 = new WeakMap();
function getOrCreateEventToken(stateElement, name) {
    let registry = registryByStateElement$2.get(stateElement);
    if (typeof registry === "undefined") {
        registry = new Map();
        registryByStateElement$2.set(stateElement, registry);
    }
    let token = registry.get(name);
    if (typeof token === "undefined") {
        token = new EventToken(name, stateElement.name);
        registry.set(name, token);
    }
    return token;
}
function clearEventTokenRegistry(stateElement) {
    registryByStateElement$2.delete(stateElement);
}

/**
 * eventToken.<propertyName>: <eventTokenName> バインディングの attach ハンドラ。
 *
 * command-token の双対（element→state）。要素が dispatch する CustomEvent を受けて
 * event-token を emit し、state 側の `$on` ハンドラ群へ pub/sub で配送する。
 *
 * 設計（MVP スコープ: wc-bindable カスタム要素のみ）:
 *   - キーは生イベント名ではなく **wcBindable property 名**。実 DOM イベント名は
 *     wcBindable.properties[].event から解決する（command-token が wcBindable.commands で
 *     検証するのと対称。コロンを含む namespaced event 名と binding 構文の `:` 衝突も回避）。
 *   - <prop> が wcBindable.properties に宣言されていることは attach 時に検証する
 *     （要素クラス参照のみで DOM 接続に非依存。fail-fast / typo 耐性）。
 *   - <eventTokenName> が $eventTokens に宣言されていることは **発火時** に検証する
 *     （state 解決が必要なため。詳細は下記の fire-time 解決の注記を参照）。
 *   - subscriber 引数規約は `(state, event, ...listIndexes)`。
 *   - modifier `#prevent` / `#stop` は既存イベント binding と同等にサポート。
 *
 * token はイベント発火ごとに registry から解決する（getOrCreateEventToken）。これにより
 * state の再 set で registry が作り直されても最新の subscriber 群へ配送できる。
 *
 * state element の解決と `$eventTokens` 検証は **発火時** に行う（attach 時ではない）。
 * 構造ブロック（for/if）や SSR hydration では、binding 初期化時にノードが detached な
 * DocumentFragment / wrapper 上にあり、その時点では element.getRootNode() から state を
 * 解決できないため。onclick / two-way ハンドラと同じく fire-time 解決に揃えている。
 */
const listenerByBinding = new WeakMap();
function getWcBindable$1(element) {
    const customTagName = getCustomElement(element);
    if (customTagName === null) {
        return null;
    }
    // attach 側で未定義要素は whenDefined 後に再試行するため、ここに来る時点で customClass は定義済み。
    return readBindableDeclaration(element);
}
function attachEventTokenHandler(binding) {
    if (binding.propSegments[0] !== "eventToken") {
        return false;
    }
    const element = binding.node;
    // カスタム要素が未定義なら定義後に再試行（wcBindable が必要なため）。
    const customTagName = getCustomElement(element);
    const registry = getCustomElementRegistry();
    if (customTagName !== null && registry?.get(customTagName) === undefined) {
        if (registry === null) {
            raiseError(`CustomElementRegistry is unavailable for <${customTagName}>.`);
        }
        return true;
    }
    // 再評価で二重 attach しない。
    if (listenerByBinding.has(binding)) {
        return true;
    }
    const propertyName = binding.propSegments[1];
    if (typeof propertyName !== "string" || propertyName.length === 0) {
        raiseError(`eventToken binding requires a property name (e.g., "eventToken.error").`);
    }
    const bindable = getWcBindable$1(element);
    if (bindable === null) {
        raiseError(`eventToken binding requires a wc-bindable custom element. <${element.tagName.toLowerCase()}> is not wc-bindable.`);
    }
    const propDesc = bindable.knownProperties.get(propertyName);
    if (typeof propDesc === "undefined") {
        raiseError(`Property "${propertyName}" is not declared in wcBindable.properties of <${element.tagName.toLowerCase()}>.`);
    }
    const eventName = propDesc.event;
    const tokenName = binding.statePathName;
    const stateName = binding.stateName;
    const modifiers = binding.propModifiers;
    const handler = (event) => {
        if (modifiers.includes("prevent"))
            event.preventDefault();
        if (modifiers.includes("stop"))
            event.stopPropagation();
        // state は発火時の live root から解決する（attach 時は detached の可能性があるため）。
        const rootNode = element.getRootNode();
        const stateElement = getStateElementByName(rootNode, stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${stateName}" not found for eventToken handler.`);
        }
        if (!stateElement.eventTokenNames.has(tokenName)) {
            raiseError(`eventToken "${tokenName}" is not declared in $eventTokens of state "${stateName}".`);
        }
        const loopContext = getLoopContextByNode(element);
        stateElement.createStateAsync("writable", async (state) => {
            state[setLoopContextSymbol](loopContext, () => {
                const indexes = loopContext?.listIndex.indexes ?? [];
                const token = getOrCreateEventToken(stateElement, tokenName);
                return token.emit(state, event, ...indexes);
            });
        });
    };
    element.addEventListener(eventName, handler);
    listenerByBinding.set(binding, { eventName, handler });
    return true;
}
function detachEventTokenHandler(binding) {
    if (binding.propSegments[0] !== "eventToken") {
        return false;
    }
    const listener = listenerByBinding.get(binding);
    if (typeof listener === "undefined") {
        return false;
    }
    binding.node.removeEventListener(listener.eventName, listener.handler);
    listenerByBinding.delete(binding);
    return true;
}

// CommandToken は共有 pub/sub プリミティブ Token の薄い特化。
// instanceof による型判別を成立させるため独立クラスとして維持する。
//
// ownerStateName は devtools 計装（protocol §4.5）のための内部 optional 引数。
// command-token-protocol の外部仕様は不変更（registry が渡すだけで、
// subscribe/emit の意味論には一切影響しない）。
class CommandToken extends Token {
    _ownerStateName;
    constructor(name, ownerStateName) {
        super(name);
        this._ownerStateName = ownerStateName ?? null;
    }
    emit(...args) {
        if (devtoolsSink !== null) {
            // subscriberCount 0 の emit（空撃ち）もそのまま流す — whenDefined 前の
            // command 空撃ちレース類をタイムラインで可視化するため
            devtoolsSink({
                type: "state:token-emit",
                kind: "command",
                stateName: this._ownerStateName,
                tokenName: this.name,
                args,
                subscriberCount: this.size,
            });
        }
        return super.emit(...args);
    }
}
function isCommandToken(value) {
    return value instanceof CommandToken;
}

// onclick: $command.<name> のように、DOM イベントから command token を直接 emit する形式かを判定する。
// 右辺が $command 名前空間配下のパス（$command.<token>）のときに true。
function isCommandTokenPath(statePathName) {
    return statePathName.startsWith(STATE_COMMAND_NAMESPACE_NAME + ".");
}
const handlerByHandlerKey$2 = new Map();
// binding を強参照しない台帳（handlerBindingRegistry.ts のリーク解説を参照）
const bindingRegistry$2 = createHandlerBindingRegistry();
function getHandlerKey$2(binding) {
    const modifierKey = binding.propModifiers.filter(m => m === 'prevent' || m === 'stop').sort().join(',');
    return `${binding.stateName}::${binding.statePathName}::${modifierKey}`;
}
const stateEventHandlerFunction = (stateName, handlerName, modifiers, statePathInfo) => (event) => {
    if (modifiers.includes('prevent'))
        event.preventDefault();
    if (modifiers.includes('stop'))
        event.stopPropagation();
    const node = event.target;
    const rootNode = node.getRootNode();
    const stateElement = getStateElementByName(rootNode, stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for event handler.`);
    }
    const loopContext = getLoopContextByNode(node);
    const isCommand = isCommandTokenPath(handlerName);
    stateElement.createStateAsync("writable", async (state) => {
        state[setLoopContextSymbol](loopContext, () => {
            const indexes = loopContext?.listIndex.indexes ?? [];
            if (isCommand) {
                // command token を解決して emit。引数はハンドラ呼び出しと同じく (event, ...listIndexes) を透過する。
                const token = state[getByAddressSymbol](createStateAddress(statePathInfo, null));
                if (!isCommandToken(token)) {
                    raiseError(`Event binding "${handlerName}" did not resolve to a CommandToken. Declare the name in $commandTokens and reference it as $command.<name>.`);
                }
                return token.emit(event, ...indexes);
            }
            const handler = state[handlerName];
            if (typeof handler !== "function") {
                raiseError(`Handler "${handlerName}" is not a function on state "${stateName}".`);
            }
            return Reflect.apply(handler, state, [event, ...indexes]);
        });
    });
};
function attachEventHandler(binding) {
    if (!binding.propName.startsWith("on")) {
        return false;
    }
    const key = getHandlerKey$2(binding);
    let stateEventHandler = handlerByHandlerKey$2.get(key);
    if (typeof stateEventHandler === "undefined") {
        stateEventHandler = stateEventHandlerFunction(binding.stateName, binding.statePathName, binding.propModifiers, binding.statePathInfo);
        handlerByHandlerKey$2.set(key, stateEventHandler);
    }
    const eventName = binding.propName.slice(2);
    binding.node.addEventListener(eventName, stateEventHandler);
    bindingRegistry$2.add(key, binding);
    return true;
}
function detachEventHandler(binding) {
    if (!binding.propName.startsWith("on")) {
        return false;
    }
    const key = getHandlerKey$2(binding);
    const stateEventHandler = handlerByHandlerKey$2.get(key);
    if (typeof stateEventHandler === "undefined") {
        return false;
    }
    const eventName = binding.propName.slice(2);
    binding.node.removeEventListener(eventName, stateEventHandler);
    if (bindingRegistry$2.countOf(key) === 0) {
        return false;
    }
    if (bindingRegistry$2.remove(key, binding)) {
        handlerByHandlerKey$2.delete(key);
    }
    return true;
}

const handlerByHandlerKey$1 = new Map();
// binding を強参照しない台帳（handlerBindingRegistry.ts のリーク解説を参照）
const bindingRegistry$1 = createHandlerBindingRegistry();
function getHandlerKey$1(binding, eventName) {
    const filterKey = binding.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
    return `${binding.stateName}::${binding.statePathName}::${eventName}::${filterKey}`;
}
function getEventName$1(binding) {
    let eventName = 'input';
    for (const modifier of binding.propModifiers) {
        if (modifier.startsWith('on')) {
            eventName = modifier.slice(2);
        }
    }
    return eventName;
}
const radioEventHandlerFunction = (stateName, statePathName, inFilters) => (event) => {
    const node = event.target;
    if (node === null) {
        console.warn(`[@wcstack/state] event.target is null.`);
        return;
    }
    if (node.type !== 'radio') {
        console.warn(`[@wcstack/state] event.target is not a radio input element.`);
        return;
    }
    if (node.checked === false) {
        return;
    }
    const newValue = node.value;
    let filteredNewValue = newValue;
    for (const filter of inFilters) {
        filteredNewValue = filter.filterFn(filteredNewValue);
    }
    const rootNode = node.getRootNode();
    const stateElement = getStateElementByName(rootNode, stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for two-way binding.`);
    }
    const loopContext = getLoopContextByNode(node);
    stateElement.createState("writable", (state) => {
        state[setLoopContextSymbol](loopContext, () => {
            state[statePathName] = filteredNewValue;
        });
    });
};
function attachRadioEventHandler(binding) {
    if (binding.bindingType === "radio" && binding.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName$1(binding);
        const key = getHandlerKey$1(binding, eventName);
        let radioEventHandler = handlerByHandlerKey$1.get(key);
        if (typeof radioEventHandler === "undefined") {
            radioEventHandler = radioEventHandlerFunction(binding.stateName, binding.statePathName, binding.inFilters);
            handlerByHandlerKey$1.set(key, radioEventHandler);
        }
        binding.node.addEventListener(eventName, radioEventHandler);
        bindingRegistry$1.add(key, binding);
        return true;
    }
    return false;
}
function detachRadioEventHandler(binding) {
    if (binding.bindingType === "radio" && binding.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName$1(binding);
        const key = getHandlerKey$1(binding, eventName);
        const radioEventHandler = handlerByHandlerKey$1.get(key);
        if (typeof radioEventHandler === "undefined") {
            return false;
        }
        binding.node.removeEventListener(eventName, radioEventHandler);
        if (bindingRegistry$1.countOf(key) === 0) {
            return false;
        }
        if (bindingRegistry$1.remove(key, binding)) {
            handlerByHandlerKey$1.delete(key);
        }
        return true;
    }
    return false;
}

const CHECK_TYPES = new Set(['radio', 'checkbox']);
const DEFAULT_VALUE_PROP_NAMES = new Set(['value', 'valueAsNumber', 'valueAsDate']);
function isPossibleTwoWay(node, propName) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    const element = node;
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'input') {
        const inputType = (element.getAttribute('type') || 'text').toLowerCase();
        if (inputType === 'button') {
            return false;
        }
        if (CHECK_TYPES.has(inputType) && propName === 'checked') {
            return true;
        }
        if (DEFAULT_VALUE_PROP_NAMES.has(propName)) {
            return true;
        }
    }
    if (tagName === 'select' && propName === 'value') {
        return true;
    }
    if (tagName === 'textarea' && propName === 'value') {
        return true;
    }
    const customTagName = getCustomElement(element);
    if (customTagName !== null) {
        const customClass = getCustomElementRegistry()?.get(customTagName);
        if (typeof customClass === "undefined") {
            raiseError(`Custom element <${customTagName}> is not defined. Cannot determine if property "${propName}" is suitable for two-way binding.`);
        }
        const bindable = readBindableDeclaration(element);
        if (bindable?.knownProperties.has(propName)) {
            return true;
        }
    }
    return false;
}

/**
 * propagation/propagation.ts
 *
 * Phase 3 の因果伝播コア（feature flag `enablePropagationContext` 下）。
 * 依存は types のみの葉モジュールとし、twowayHandler / applyChangeToProperty /
 * setByAddress / updater の計装点から循環 import なしで参照できるようにする。
 *
 * wire 識別は (node × member × stateName × statePathName) で行う。設計書の
 * WriteReceipt は bindingId + generation を持つが、twoway handler は共有
 * handler（handlerByHandlerKey）で binding インスタンスに到達できないため、
 * runtime の edge / receipt 照合キーは wire 単位とする。BindingSession
 * generation との統合（再 attach 後の edge ID 非再利用）は session 側の
 * 計装が揃う段階で bindingGeneration に反映する。
 */
let nextWireId = 1;
let nextTransactionId = 1;
let nextSynchronousScopeId = 1;
// node を強参照しない wire 台帳。inner key = `${stateName}::${statePathName}::${member}`
const wireIdsByNode = new WeakMap();
function wireKey(member, stateName, statePathName) {
    return `${stateName}::${statePathName}::${member}`;
}
/**
 * wire（配線）の安定 ID を返す。edge ID の基底と receipt の bindingId に使う。
 */
function getWireId(node, member, stateName, statePathName) {
    let byKey = wireIdsByNode.get(node);
    if (typeof byKey === "undefined") {
        byKey = new Map();
        wireIdsByNode.set(node, byKey);
    }
    const key = wireKey(member, stateName, statePathName);
    let wireId = byKey.get(key);
    if (typeof wireId === "undefined") {
        wireId = nextWireId++;
        byKey.set(key, wireId);
    }
    return wireId;
}
/** wire × 方向 → edge ID。方向を含めるため再利用されない */
function getEdgeId(wireId, direction) {
    return direction === "to-element" ? wireId * 2 : wireId * 2 + 1;
}
const EMPTY_EDGES = new Set();
/** 外部 event / API update ごとの transaction 開始。current context は変更しない */
function beginPropagationTransaction(originBindingId) {
    return {
        transactionId: nextTransactionId++,
        originBindingId,
        visitedEdges: EMPTY_EDGES,
        hop: 0,
    };
}
/** edge を 1 つ通過した新しい context を返す（visitedEdges 追加・hop+1） */
function extendPropagationContext(context, edgeId) {
    const visitedEdges = new Set(context.visitedEdges);
    visitedEdges.add(edgeId);
    return {
        transactionId: context.transactionId,
        originBindingId: context.originBindingId,
        visitedEdges,
        hop: context.hop + 1,
    };
}
// 同期 dynamic scope の current context（updater drain / element 書き込み中に設定）
let currentContext = null;
function getCurrentPropagationContext() {
    return currentContext;
}
function runWithPropagationContext(context, callback) {
    const previous = currentContext;
    currentContext = context;
    try {
        return callback();
    }
    finally {
        currentContext = previous;
    }
}
const receiptStack = [];
/**
 * state → element 書き込みを receipt scope で包んで実行する。
 * setter が同期 dispatch する event は matchWriteReceipt でこの receipt を観測できる。
 */
function runWithWriteReceipt(node, member, writtenValue, bindingId, transactionId, callback) {
    const receipt = {
        bindingId,
        bindingGeneration: 0,
        member,
        transactionId,
        synchronousScopeId: nextSynchronousScopeId++,
        writtenValue,
    };
    receiptStack.push({ receipt, node });
    try {
        return callback();
    }
    finally {
        receiptStack.pop();
    }
}
/**
 * (node, member) に対する最も内側の active receipt を返す。
 * confirmation / normalization の判定（writtenValue との Object.is 比較）は
 * 呼び出し側が行う。scope 外（非同期に届いた event）では null。
 */
function matchWriteReceipt(node, member) {
    for (let i = receiptStack.length - 1; i >= 0; i--) {
        const active = receiptStack[i];
        if (active.node === node && active.receipt.member === member) {
            return active.receipt;
        }
    }
    return null;
}

const handlerByHandlerKey = new Map();
// binding を強参照しない台帳（handlerBindingRegistry.ts のリーク解説を参照）
const bindingRegistry = createHandlerBindingRegistry();
const producerValueObserversByNode = new WeakMap();
const DEFAULT_GETTER = (e) => e.detail;
function getHandlerKey(binding, eventName, hasGetter) {
    const filterKey = binding.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
    return `${binding.stateName}::${binding.propName}::${binding.statePathName}::${eventName}::${filterKey}::${hasGetter ? 'g' : 'n'}`;
}
function getEventName(binding) {
    const tagName = binding.node.tagName.toLowerCase();
    // 1.default event name
    let eventName = (tagName === 'select') ? 'change' : 'input';
    // 2.wcBindable protocol
    const customTagName = getCustomElement(binding.node);
    if (customTagName !== null) {
        const customClass = getCustomElementRegistry()?.get(customTagName);
        if (typeof customClass === "undefined") {
            raiseError(`Custom element <${customTagName}> is not defined. Cannot determine event name for two-way binding.`);
        }
        const propDesc = readBindableDeclaration(binding.node)?.knownProperties.get(binding.propName);
        if (propDesc) {
            eventName = propDesc.event;
        }
    }
    // 3.modifier
    for (const modifier of binding.propModifiers) {
        if (modifier.startsWith('on')) {
            eventName = modifier.slice(2);
        }
    }
    return eventName;
}
function getValueGetter(binding) {
    const customTagName = getCustomElement(binding.node);
    if (customTagName !== null) {
        const propDesc = readBindableDeclaration(binding.node)?.knownProperties.get(binding.propName);
        if (propDesc) {
            return propDesc.getter ?? DEFAULT_GETTER;
        }
    }
    return null;
}
const twowayEventHandlerFunction = (stateName, propName, statePathName, inFilters, valueGetter) => (event) => {
    const node = event.target;
    if (node === null) {
        console.warn(`[@wcstack/state] event.target is null.`);
        return;
    }
    let newValue;
    if (valueGetter !== null) {
        newValue = valueGetter(event);
    }
    else {
        if (!(propName in node)) {
            console.warn(`[@wcstack/state] Property "${propName}" does not exist on target element.`);
            return;
        }
        newValue = node[propName];
    }
    let filteredNewValue = newValue;
    for (const filter of inFilters) {
        filteredNewValue = filter.filterFn(filteredNewValue);
    }
    const producerObservers = producerValueObserversByNode.get(node)?.get(propName);
    if (typeof producerObservers !== "undefined") {
        for (const observer of producerObservers)
            observer(filteredNewValue);
    }
    let propagationContext = null;
    if (config.enablePropagationContext) {
        // Phase 3: element → state edge の因果判定（設計書 §4）。
        const wireId = getWireId(node, propName, stateName, statePathName);
        const receipt = matchWriteReceipt(node, propName);
        if (receipt !== null && Object.is(receipt.writtenValue, newValue)) {
            // 規則 4: 同じ setter call stack 内で同じ member から Object.is 同値の
            // 通知が戻った場合だけ confirmation として再伝播を抑止する。
            // shadow diagnostic（§8）: primitive なら same-value guard も同じ結論に
            // なるため、provenance だけが守っている非 primitive の echo を可視化する。
            if (config.debug) {
                console.debug(`[@wcstack/state] propagation: write confirmation suppressed echo.`, {
                    node,
                    propName,
                    statePathName,
                    transactionId: receipt.transactionId,
                    coveredBySameValueGuard: config.sameValueGuard
                        && (filteredNewValue === null || typeof filteredNewValue !== "object"),
                });
            }
            if (devtoolsSink !== null) {
                devtoolsSink({
                    type: "propagation:suppressed",
                    reason: "confirmation",
                    transactionId: receipt.transactionId,
                    edgeId: getEdgeId(wireId, "to-state"),
                    node,
                    member: propName,
                });
            }
            return;
        }
        // receipt があるが値が異なる場合は正規化差分: element の確定値として受理し、
        // 新しい edge を通る変更として継続する（規則 5・decision gate）。
        const toStateEdgeId = getEdgeId(wireId, "to-state");
        const baseContext = getCurrentPropagationContext();
        if (baseContext !== null && baseContext.visitedEdges.has(toStateEdgeId)) {
            // 規則 2: 同じ transaction が同じ edge を再度通ろうとした場合だけ抑止
            if (devtoolsSink !== null) {
                devtoolsSink({
                    type: "propagation:suppressed",
                    reason: "visited-edge",
                    transactionId: baseContext.transactionId,
                    edgeId: toStateEdgeId,
                    node,
                    member: propName,
                });
            }
            return;
        }
        // 規則 1: 外部 event（受け皿の context が無い）なら新しい transaction を開始
        propagationContext = extendPropagationContext(baseContext ?? beginPropagationTransaction(wireId), toStateEdgeId);
    }
    const rootNode = node.getRootNode();
    const stateElement = getStateElementByName(rootNode, stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for two-way binding.`);
    }
    const loopContext = getLoopContextByNode(node);
    const commitToState = () => {
        stateElement.createState("writable", (state) => {
            state[setLoopContextSymbol](loopContext, () => {
                state[statePathName] = filteredNewValue;
            });
        });
    };
    if (propagationContext !== null) {
        runWithPropagationContext(propagationContext, commitToState);
    }
    else {
        commitToState();
    }
};
function addTwowayValueObserver(node, propName, observer) {
    let byProperty = producerValueObserversByNode.get(node);
    if (typeof byProperty === "undefined") {
        byProperty = new Map();
        producerValueObserversByNode.set(node, byProperty);
    }
    let observers = byProperty.get(propName);
    if (typeof observers === "undefined") {
        observers = new Set();
        byProperty.set(propName, observers);
    }
    observers.add(observer);
    return () => {
        observers?.delete(observer);
        if (observers?.size === 0)
            byProperty?.delete(propName);
        if (byProperty?.size === 0)
            producerValueObserversByNode.delete(node);
    };
}
function attachTwowayEventHandler(binding) {
    const customTagName = getCustomElement(binding.node);
    if (customTagName !== null) {
        const registry = getCustomElementRegistry();
        const customClass = registry?.get(customTagName);
        if (typeof customClass === "undefined") {
            if (registry === null) {
                raiseError(`CustomElementRegistry is unavailable for <${customTagName}>.`);
            }
            return;
        }
    }
    if (isPossibleTwoWay(binding.node, binding.propName) && binding.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName(binding);
        const valueGetter = getValueGetter(binding);
        const key = getHandlerKey(binding, eventName, valueGetter !== null);
        let twowayEventHandler = handlerByHandlerKey.get(key);
        if (typeof twowayEventHandler === "undefined") {
            twowayEventHandler = twowayEventHandlerFunction(binding.stateName, binding.propName, binding.statePathName, binding.inFilters, valueGetter);
            handlerByHandlerKey.set(key, twowayEventHandler);
        }
        binding.node.addEventListener(eventName, twowayEventHandler);
        bindingRegistry.add(key, binding);
    }
}
function detachTwowayEventHandler(binding) {
    const customTagName = getCustomElement(binding.node);
    if (customTagName !== null) {
        const registry = getCustomElementRegistry();
        const customClass = registry?.get(customTagName);
        if (typeof customClass === "undefined") {
            if (registry === null) {
                return;
            }
            return;
        }
    }
    if (isPossibleTwoWay(binding.node, binding.propName) && binding.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName(binding);
        const valueGetter = getValueGetter(binding);
        const key = getHandlerKey(binding, eventName, valueGetter !== null);
        const twowayEventHandler = handlerByHandlerKey.get(key);
        if (typeof twowayEventHandler === "undefined") {
            return;
        }
        binding.node.removeEventListener(eventName, twowayEventHandler);
        if (bindingRegistry.remove(key, binding)) {
            handlerByHandlerKey.delete(key);
        }
    }
}

// framework 自身が detach し明示的に解体（deactivate/unmount）したノード。
// BindingOwner の MutationObserver は削除サブツリー走査でこれらをスキップする。
//
// 根拠: 削除時の handleRemovedNode は binding を dispose するだけ（DOM 構造変更も
// connect-snapshot 依存も無い）で、framework が unmount 経路で既に dispose 済みの
// content に対しては純粋な冗長走査（forEachInclusive で削除サブツリー全体を歩く）に
// なる。create（追加）経路は two-way の connect-time snapshot を observer に依存する
// ため対象外だが、削除は依存が無いため安全に飛ばせる。
//
// マークは observer が削除を配送した時点で消費（削除）する。マーク〜配送の間隔は
// 単一 microtask であり、その間に外部 DOM 変異は割り込めない（framework の drain は
// 同期）ため、マークは framework 由来の削除にしか一致しない。
const observerSkipNodes = new WeakSet();
function markObserverSkipOnRemove(node) {
    observerSkipNodes.add(node);
}
// マーク済みなら true を返しつつマークを消費する。未マークなら false。
function consumeObserverSkipOnRemove(node) {
    if (!observerSkipNodes.has(node)) {
        return false;
    }
    observerSkipNodes.delete(node);
    return true;
}
// framework 自身がマウント（Content.appendTo / mountAfter）したノード。
// 追加サブツリー走査の実質の仕事は connect-snapshot 待ち（observationPending）の
// record への配送だけで、record 自体は同期マウント（activateContent → start）で
// observer flush より先に active 済み。よって待ちがグローバルに 1 つも無ければ
// 追加側走査も冗長であり丸ごとスキップできる（削除側スキップの対称形）。
// マーク〜配送が単一 microtask で外部変異が割り込めない前提も削除側と同じ。
const observerSkipAddedNodes = new WeakSet();
function markObserverSkipOnAdd(node) {
    observerSkipAddedNodes.add(node);
}
// マーク済みなら true を返しつつマークを消費する（削除側と同じ one-shot 契約）。
function consumeObserverSkipOnAdd(node) {
    if (!observerSkipAddedNodes.has(node)) {
        return false;
    }
    observerSkipAddedNodes.delete(node);
    return true;
}
// connect-snapshot 待ち（two-way sync=connect で未接続のまま activate された record）の
// グローバル件数。> 0 の間は追加側スキップを無効化して従来走査に戻す。
// increment は settleInitialRecord、decrement は readProducerSnapshot（消化時）と
// runTeardowns（未消化のまま終端した record のリーク防止）が担う。
let pendingObservationCount = 0;
function incrementPendingObservation() {
    pendingObservationCount++;
}
function decrementPendingObservation() {
    pendingObservationCount--;
}
function hasPendingObservation() {
    return pendingObservationCount > 0;
}

/**
 * Shares one CustomElementRegistry.whenDefined() continuation per registry/tag.
 * Waiters can be removed independently, so a never-defined tag does not retain
 * binding records or their DOM nodes after teardown.
 */
class DefinitionCoordinator {
    registry;
    entries = new Map();
    constructor(registry) {
        this.registry = registry;
    }
    wait(tagName, resolve, reject = () => undefined) {
        const normalizedTagName = tagName.toLowerCase();
        let entry = this.entries.get(normalizedTagName);
        if (typeof entry === "undefined") {
            entry = { waiters: new Set() };
            this.entries.set(normalizedTagName, entry);
            this.registry.whenDefined(normalizedTagName).then(() => this.settle(normalizedTagName, null), (error) => this.settle(normalizedTagName, error));
        }
        const waiter = { active: true, resolve, reject };
        entry.waiters.add(waiter);
        return () => {
            if (!waiter.active)
                return;
            waiter.active = false;
            entry?.waiters.delete(waiter);
        };
    }
    pendingCount(tagName) {
        return this.entries.get(tagName.toLowerCase())?.waiters.size ?? 0;
    }
    settle(tagName, error) {
        const entry = this.entries.get(tagName);
        if (typeof entry === "undefined")
            return;
        this.entries.delete(tagName);
        const waiters = Array.from(entry.waiters);
        entry.waiters.clear();
        for (const waiter of waiters) {
            if (!waiter.active)
                continue;
            waiter.active = false;
            if (error === null)
                waiter.resolve();
            else
                waiter.reject(error);
        }
    }
}
const coordinatorByRegistry = new WeakMap();
function getDefinitionCoordinator(registry) {
    let coordinator = coordinatorByRegistry.get(registry);
    if (typeof coordinator === "undefined") {
        coordinator = new DefinitionCoordinator(registry);
        coordinatorByRegistry.set(registry, coordinator);
    }
    return coordinator;
}

function readOption(binding, key) {
    let result = null;
    for (const modifier of binding.propModifiers) {
        const separator = modifier.indexOf("=");
        if (separator < 0)
            continue;
        const modifierKey = modifier.slice(0, separator).trim();
        const value = modifier.slice(separator + 1).trim();
        if (modifierKey !== "init" && modifierKey !== "sync") {
            raiseError(`Unknown binding modifier "${modifierKey}" in "${modifier}".`);
        }
        if (modifierKey !== key)
            continue;
        if (result !== null) {
            raiseError(`Binding modifier "${key}" may only be specified once.`);
        }
        result = value;
    }
    return result;
}
function parseAuthority(value) {
    if (value === null)
        return null;
    if (value === "state" || value === "element" || value === "auto" || value === "none") {
        return value;
    }
    return raiseError(`Invalid init modifier value "${value}".`);
}
function parseSyncOn(value) {
    if (value === null || value === "call")
        return "call";
    if (value === "connect")
        return "connect";
    return raiseError(`Invalid sync modifier value "${value}".`);
}
function hasInitialSyncModifier(binding) {
    return binding.propModifiers.some((modifier) => modifier.includes("="));
}
// 頻出ポリシー（修飾子なしの通常バインディング）の凍結シングルトン。リスト行では
// binding ごとに resolveInitialSyncPolicy が走るため、毎回のオブジェクト割り当てを
// 避ける（record.initialPolicy は読み取り専用でしか使われない）。
const STATE_CALL_POLICY = Object.freeze({ authority: "state", syncOn: "call", observable: false });
const NONE_CALL_POLICY = Object.freeze({ authority: "none", syncOn: "call", observable: false });
function statePolicy(authority, syncOn) {
    if (authority === "state" && syncOn === "call")
        return STATE_CALL_POLICY;
    return { authority, syncOn, observable: false };
}
function resolveInitialSyncPolicy(binding) {
    if (!config.enableDirectionalInitialSync) {
        if (hasInitialSyncModifier(binding)) {
            raiseError("init=/sync= modifiers require enableDirectionalInitialSync.");
        }
        return STATE_CALL_POLICY;
    }
    const explicitAuthority = parseAuthority(readOption(binding, "init"));
    const syncOn = parseSyncOn(readOption(binding, "sync"));
    if (binding.bindingType === "event") {
        if (explicitAuthority !== null && explicitAuthority !== "none") {
            raiseError("Event bindings only allow init=none.");
        }
        return syncOn === "call" ? NONE_CALL_POLICY : { authority: "none", syncOn, observable: false };
    }
    // command.<name>: $command.<method> は命令的な command-token 配線。bindingType は
    // "prop" だが propName ("command.<name>") は wcBindable property ではないため、下の
    // property authority 検証(未宣言なら raiseError)に掛けてはならない。値の初期同期を
    // 持たない配線なので、現行互換の "state" authority を返す(command token は従来通り
    // 初期 apply で配線される)。
    if (binding.propSegments[0] === "command") {
        return statePolicy("state", syncOn);
    }
    if (binding.bindingType !== "prop") {
        if (explicitAuthority !== null && explicitAuthority !== "state" && explicitAuthority !== "none") {
            raiseError(`Binding type "${binding.bindingType}" does not support init=${explicitAuthority}.`);
        }
        return statePolicy(explicitAuthority ?? "state", syncOn);
    }
    const declaration = readBindableDeclaration(binding.node);
    if (declaration === null) {
        return statePolicy(explicitAuthority ?? "state", syncOn);
    }
    const hasOutput = declaration.knownProperties.has(binding.propName);
    const hasInput = declaration.declaredInputs.has(binding.propName);
    if (!hasOutput && !hasInput) {
        raiseError(`Property "${binding.propName}" is not declared by wcBindable.`);
    }
    const allowed = hasOutput && hasInput
        ? new Set(["state", "element", "auto", "none"])
        : hasOutput
            ? new Set(["element", "none"])
            : new Set(["state", "none"]);
    const defaultAuthority = hasOutput && !hasInput ? "element" : "state";
    const authority = explicitAuthority ?? defaultAuthority;
    if (!allowed.has(authority)) {
        raiseError(`init=${authority} is incompatible with wcBindable member "${binding.propName}".`);
    }
    if (syncOn === "connect" && !hasOutput) {
        raiseError(`sync=connect requires observable property "${binding.propName}".`);
    }
    return { authority, syncOn, observable: hasOutput };
}
function isBindingStateInitialized(binding) {
    const rootNode = binding.replaceNode.getRootNode();
    const stateElement = getStateElementByName(rootNode, binding.stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${binding.stateName}" not found for binding.`);
    }
    const address = getStateAddressByBindingInfo(binding);
    let initialized = false;
    stateElement.createState("readonly", (state) => {
        initialized = state[hasByAddressSymbol](address);
    });
    return initialized;
}
function resolveInitialAuthority(binding, authority) {
    if (authority !== "auto")
        return authority;
    return isBindingStateInitialized(binding) ? "state" : "element";
}
function commitProducerValue(binding, value) {
    let filteredValue = value;
    for (const filter of binding.inFilters) {
        filteredValue = filter.filterFn(filteredValue);
    }
    const rootNode = binding.node.getRootNode();
    const stateElement = getStateElementByName(rootNode, binding.stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${binding.stateName}" not found for initial binding sync.`);
    }
    const loopContext = getLoopContextByNode(binding.node);
    stateElement.createState("writable", (state) => {
        state[setLoopContextSymbol](loopContext, () => {
            state[binding.statePathName] = filteredValue;
        });
    });
}

function replaceToReplaceNode(bindingInfo) {
    const node = bindingInfo.node;
    const replaceNode = bindingInfo.replaceNode;
    if (node === replaceNode) {
        return;
    }
    if (node.parentNode === null) {
        // already replaced
        return;
    }
    node.parentNode.replaceChild(replaceNode, node);
}

let nextRecordId = 0;
let nextGeneration = 0;
const recordByBinding = new WeakMap();
const sessionByRoot = new WeakMap();
// binding の構造キーは不変フィールドのみから決まる。リスト行の初期化では同一 binding に
// 対し remember() が2回呼ばれる（createContent 内 initializeBindingsByFragment と
// activateContent の registerAddress 目的の initialize）ため、2度目の文字列生成を避けるべく
// binding 単位でメモ化する。プロファイル上 bindingKey は create-10k の JS 自己時間で上位。
const bindingKeyByBinding = new WeakMap();
// node → その node に関心を持つ session（anchor として binding を覚えている、
// または定義待ちタスクを抱えている）。BindingOwner は mutation で増減した
// サブツリーを1回だけ走査し、ここに登録された session だけへ per-node 配送する。
// 全 session ブロードキャストだと、リスト行の逐次 append などで
// 「session 数 × 変異ノード数」の O(n²) ファンアウトになるため、その正本台帳。
// 大多数の node は関心 session が1つなので単一値で持ち、2つ目から Set に昇格する。
const interestedSessionsByNode = new WeakMap();
function addInterestedSession(node, session) {
    const current = interestedSessionsByNode.get(node);
    if (typeof current === "undefined") {
        interestedSessionsByNode.set(node, session);
        return;
    }
    if (current === session)
        return;
    if (current instanceof Set) {
        current.add(session);
        return;
    }
    interestedSessionsByNode.set(node, new Set([current, session]));
}
function forEachInterestedSession(node, callback) {
    const current = interestedSessionsByNode.get(node);
    if (typeof current === "undefined")
        return;
    if (current instanceof Set) {
        for (const session of Array.from(current))
            callback(session);
        return;
    }
    callback(current);
}
function forEachInclusive(root, callback) {
    callback(root);
    // 葉ノード（fragment 一括挿入時のテキスト・空セル等が大多数）では
    // Array.from(childNodes) の空配列アロケーションを避ける。callback が子を
    // 追加しうるため firstChild は callback 後に判定する（従来と同一意味論）。
    if (root.firstChild === null)
        return;
    for (const child of Array.from(root.childNodes)) {
        forEachInclusive(child, callback);
    }
}
function isObservableRoot(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const node = value;
    return node.nodeType === 9 || (node.nodeType === 11 && "host" in node);
}
function observableRootFor(node) {
    const root = node.getRootNode();
    return isObservableRoot(root) ? root : null;
}
class BindingOwner {
    root;
    observer;
    constructor(root) {
        this.root = root;
        const Observer = globalThis.MutationObserver;
        this.observer = typeof Observer === "function"
            ? new Observer((mutations) => this.handleMutations(mutations))
            : null;
        this.observer?.observe(root, { childList: true, subtree: true });
    }
    handleMutations(mutations) {
        const removed = [];
        const added = [];
        for (const mutation of mutations) {
            removed.push(...Array.from(mutation.removedNodes));
            added.push(...Array.from(mutation.addedNodes));
        }
        // 走査は owner が1回だけ行い、関心 session が居る node だけを配送・contains
        // 検査へ進める。contains は O(木の深さ) なので、関心の無い node で呼ばない。
        const reconnected = [];
        for (const subtree of removed) {
            // framework が unmount した削除サブツリーは binding を明示 dispose 済みなので
            // observer 側の冗長走査（forEachInclusive で全 node を歩き handleRemovedNode を
            // 呼ぶ）を丸ごとスキップする。clear/大量 delete のホットスポット短縮。
            if (consumeObserverSkipOnRemove(subtree))
                continue;
            forEachInclusive(subtree, (node) => {
                forEachInterestedSession(node, (session) => {
                    if (this.root.contains(node))
                        return;
                    session.handleRemovedNode(node);
                });
            });
        }
        for (const subtree of added) {
            // framework がマウントしたサブツリーは record が同期 activate 済みで、追加側
            // 走査の実質の仕事は connect-snapshot 待ちへの配送だけ。待ちがグローバルに
            // 無ければ丸ごとスキップする（待ちがあればマークだけ消費して従来走査に戻す）。
            if (consumeObserverSkipOnAdd(subtree) && !hasPendingObservation())
                continue;
            forEachInclusive(subtree, (node) => {
                forEachInterestedSession(node, (session) => {
                    if (!this.root.contains(node))
                        return;
                    session.handleAddedNode(node, reconnected);
                });
            });
        }
        if (reconnected.length > 0)
            applyChangeFromBindings(reconnected);
    }
}
const ownerByRoot = new WeakMap();
function getBindingOwner(root) {
    let owner = ownerByRoot.get(root);
    if (typeof owner === "undefined") {
        owner = new BindingOwner(root);
        ownerByRoot.set(root, owner);
    }
    return owner;
}
function bindingKey(binding) {
    const inFilters = binding.inFilters.map((filter) => `${filter.filterName}(${filter.args.join(",")})`).join("|");
    const outFilters = binding.outFilters.map((filter) => `${filter.filterName}(${filter.args.join(",")})`).join("|");
    return [
        binding.bindingType,
        binding.propName,
        binding.propModifiers.join(","),
        binding.stateName,
        binding.statePathName,
        inFilters,
        outFilters,
        binding.uuid ?? "",
    ].join("\u0000");
}
function addRecordTeardown(record, teardown) {
    if (record.teardowns === null) {
        record.teardowns = new Set();
    }
    record.teardowns.add(teardown);
}
class BindingSession {
    records = new Set();
    /**
     * initializeRow で設定される行プラン。非 null のとき activate は
     * スロット整列の高速経路（activatePlanRows）を使う。
     */
    rowPlan = null;
    // anchor ノードが持つ binding は大多数が 1 本なので単一値で持ち、2 本目から
    // Map（remember 経路のキー照合用）に昇格する（台帳・興味 session と同じ前例）
    knownBindingsByNode = new WeakMap();
    optionsByBinding = new WeakMap();
    deferredByNode = new WeakMap();
    deferred = new Set();
    constructor(root = null) {
        if (root !== null)
            this.observe(root);
    }
    /**
     * knownRoot: 呼び出し側が root を確定済みのときの per-binding observe 省略。
     *  - undefined: 従来どおり binding ごとに anchor から root を導出して observe
     *  - null: detached fragment 上（createContent）の初期化。observableRootFor が
     *    必ず null を返す状況なので observe（= getRootNode）を丸ごと省略する
     *  - Node: 呼び出し側で owner 保証済み（activate 経由のみ。initialize へは未使用）
     */
    initialize(bindings, options = {}, knownRoot) {
        const registerAddress = options.registerAddress ?? true;
        const resolvedOptions = {
            registerAddress,
            registerPathInfo: options.registerPathInfo ?? registerAddress,
            applyOnReconnect: options.applyOnReconnect ?? true,
        };
        const initialized = [];
        for (const candidate of bindings) {
            const binding = this.remember(candidate, resolvedOptions);
            const existing = recordByBinding.get(binding);
            if (typeof existing !== "undefined" && existing.phase !== "disposed" && existing.phase !== "failed") {
                this.observe(existing.anchor);
                if (resolvedOptions.registerAddress && existing.address === null && existing.patternListIndex === null) {
                    existing.options.registerAddress = true;
                    this.registerAddress(existing);
                }
                if (existing.phase === "active")
                    this.settleInitialRecord(existing);
                this.settleConnectedSnapshot(existing);
                continue;
            }
            this.start(binding, resolvedOptions, knownRoot);
            initialized.push(binding);
        }
        return initialized.filter((binding) => this.shouldApplyState(binding));
    }
    /**
     * activateContent 専用の再活性化パス。createContent 側の initialize で
     * remember 済みの binding 配列（bindingsByContent がそのまま保持する同一オブジェクト）
     * にだけ使える前提で、remember の再実行（キー照合・options マージ・興味登録）を省き、
     * 必要な仕事だけ行う: 初回活性化はアドレス登録+初期同期、pool 再利用（disposed）は
     * start による再構築、未知の binding は防御的に従来 initialize へ倒す。
     *
     * knownRoot は呼び出し側（applyChangeToFor / applyChangeToIf の apply context）が
     * 確定済みの root。owner（root ごとの MutationObserver）の保証を呼び出しあたり
     * 1 回に集約し、binding ごとの observe（= getRootNode）とアドレス解決の
     * getRootNode を丸ごと省略する。
     */
    activate(bindings, knownRoot) {
        if (isObservableRoot(knownRoot))
            getBindingOwner(knownRoot);
        if (this.rowPlan !== null) {
            this.activatePlanRows(this.rowPlan, bindings, knownRoot);
            return;
        }
        for (const binding of bindings) {
            const record = recordByBinding.get(binding);
            if (typeof record !== "undefined" && record.session === this
                && record.phase !== "disposed" && record.phase !== "failed") {
                if (record.address === null && record.patternListIndex === null) {
                    // 初回活性化（owner は冒頭で保証済み）
                    record.options.registerAddress = true;
                    this.registerAddress(record, knownRoot);
                }
                if (record.phase === "active")
                    this.settleInitialRecord(record);
                this.settleConnectedSnapshot(record);
                continue;
            }
            const options = this.optionsByBinding.get(binding);
            if (typeof options === "undefined") {
                // この session で remember されていない binding（防御）: 従来経路
                this.initialize([binding], { registerAddress: true, registerPathInfo: false, applyOnReconnect: false });
                continue;
            }
            // pool 再利用: record は disposed。活性化要件（アドレス登録）を昇格して再構築
            options.registerAddress = true;
            this.start(binding, options, knownRoot);
        }
    }
    shouldApplyState(binding) {
        if (!config.enableDirectionalInitialSync) {
            if (hasInitialSyncModifier(binding))
                resolveInitialSyncPolicy(binding);
            return true;
        }
        const record = recordByBinding.get(binding);
        if (typeof record === "undefined" || record.session !== this)
            return true;
        if (!record.options.registerAddress || record.phase === "waiting-definition")
            return true;
        if (record.phase === "active")
            this.settleInitialRecord(record);
        return record.resolvedAuthority === "state";
    }
    getRecord(binding) {
        const record = recordByBinding.get(binding);
        return record?.session === this ? record : null;
    }
    addTeardown(binding, teardown) {
        const record = recordByBinding.get(binding);
        if (typeof record === "undefined" || !this.isAlive(record, record.generation)) {
            return false;
        }
        addRecordTeardown(record, teardown);
        return true;
    }
    deferUntilDefined(node, tagName, callback, reject = () => undefined) {
        const registry = getCustomElementRegistry();
        if (registry === null) {
            raiseError(`CustomElementRegistry is unavailable for <${tagName}>.`);
        }
        this.observe(node);
        addInterestedSession(node, this);
        const task = { node, active: true, cancel: null };
        let tasks = this.deferredByNode.get(node);
        if (typeof tasks === "undefined") {
            tasks = new Set();
            this.deferredByNode.set(node, tasks);
        }
        tasks.add(task);
        this.deferred.add(task);
        const finish = () => {
            if (!task.active)
                return false;
            task.active = false;
            tasks?.delete(task);
            this.deferred.delete(task);
            return true;
        };
        task.cancel = getDefinitionCoordinator(registry).wait(tagName, () => {
            if (!finish())
                return;
            try {
                upgradeCustomElement(registry, node);
                callback();
            }
            catch (error) {
                reject(error);
            }
        }, (error) => {
            if (!finish())
                return;
            reject(error);
        });
        return () => {
            if (!finish())
                return;
            task.cancel?.();
        };
    }
    disposeBinding(binding) {
        const record = recordByBinding.get(binding);
        if (typeof record === "undefined" || record.session !== this)
            return;
        this.disposeRecord(record);
    }
    dispose() {
        for (const record of Array.from(this.records))
            this.disposeRecord(record);
        for (const task of Array.from(this.deferred)) {
            task.active = false;
            task.cancel?.();
            this.deferred.delete(task);
            this.deferredByNode.get(task.node)?.delete(task);
        }
    }
    /**
     * wholesale destroy（全行クリアで teardown を GC に任せる高速経路）を適用して
     * よいか。定義待ち（DefinitionCoordinator の waiter / deferred spread タスク）は
     * 強参照 Map に閉包が残り、connect-snapshot 待ちは pending カウンタが戻らなく
     * なるため、1 つでもあれば従来経路（teardown 実行）に倒す。
     */
    canWholesaleDestroy() {
        if (this.deferred.size > 0)
            return false;
        for (const record of this.records) {
            if (record.pendingDefinitions > 0 || record.observationPending)
                return false;
        }
        return true;
    }
    /**
     * 全 record を teardown を走らせずに終端化する（canWholesaleDestroy が true の
     * content 専用）。イベント listener・アドレス台帳・loopContext はノード/binding
     * もろとも GC で崩壊する（recordByBinding 以下は全て弱参照）。
     * handlerBindingRegistry のカウンタは減らないが、残るのはキー文字列と数値のみで
     * 実害はない設計（handlerBindingRegistry.ts の弱参照化コメント参照）。
     */
    destroyRecords() {
        for (const record of this.records) {
            record.phase = "disposed";
            record.teardowns = null;
        }
        this.records.clear();
    }
    observe(node) {
        const root = observableRootFor(node);
        if (root === null)
            return;
        // owner（root ごとの MutationObserver）の存在だけ保証する。session の配送先
        // 登録は node 単位（interestedSessionsByNode）で行い、owner は session を
        // 直接は保持しない。
        getBindingOwner(root);
    }
    handleMutations(root, removed, added) {
        for (const subtree of removed) {
            forEachInclusive(subtree, (node) => {
                if (root.contains(node))
                    return;
                this.handleRemovedNode(node);
            });
        }
        const reconnected = [];
        for (const subtree of added) {
            forEachInclusive(subtree, (node) => {
                if (!root.contains(node))
                    return;
                this.handleAddedNode(node, reconnected);
            });
        }
        if (reconnected.length > 0)
            applyChangeFromBindings(reconnected);
    }
    handleRemovedNode(node) {
        const known = this.knownBindingsByNode.get(node);
        if (typeof known !== "undefined") {
            if (known instanceof Map) {
                for (const binding of known.values())
                    this.disposeBinding(binding);
            }
            else {
                this.disposeBinding(known);
            }
        }
        const tasks = this.deferredByNode.get(node);
        if (typeof tasks !== "undefined") {
            for (const task of Array.from(tasks)) {
                task.active = false;
                task.cancel?.();
                tasks.delete(task);
                this.deferred.delete(task);
            }
        }
    }
    handleAddedNode(node, reconnected) {
        const known = this.knownBindingsByNode.get(node);
        if (typeof known === "undefined")
            return;
        const bindings = known instanceof Map ? known.values() : [known];
        for (const binding of bindings) {
            const record = recordByBinding.get(binding);
            if (record?.phase === "active") {
                this.settleConnectedSnapshot(record);
                continue;
            }
            if (record?.phase !== "disposed")
                continue;
            const options = this.optionsByBinding.get(binding);
            if (typeof options === "undefined")
                continue;
            try {
                this.start(binding, options);
                if (options.applyOnReconnect && this.shouldApplyState(binding))
                    reconnected.push(binding);
            }
            catch {
                // Mutation delivery cannot surface initialization errors to a caller.
            }
        }
    }
    /**
     * anchor の known 台帳を Map 形へ正規化して返す（remember のキー照合用）。
     * 単一値（プラン行 or 既存単独 binding）は実キーを引いて昇格する。
     */
    knownMapFor(anchor) {
        const current = this.knownBindingsByNode.get(anchor);
        if (current instanceof Map) {
            return current;
        }
        const map = new Map();
        if (typeof current !== "undefined") {
            let key = bindingKeyByBinding.get(current);
            if (typeof key === "undefined") {
                key = bindingKey(current);
                bindingKeyByBinding.set(current, key);
            }
            map.set(key, current);
        }
        this.knownBindingsByNode.set(anchor, map);
        return map;
    }
    remember(binding, options) {
        const anchor = binding.replaceNode;
        // detached fragment 上でも登録しておく（node 単位の台帳なので root 非依存）。
        // fragment 一括マウントで後から接続された行にも mutation 配送が届くようにする。
        addInterestedSession(anchor, this);
        const known = this.knownMapFor(anchor);
        let key = bindingKeyByBinding.get(binding);
        if (typeof key === "undefined") {
            key = bindingKey(binding);
            bindingKeyByBinding.set(binding, key);
        }
        const remembered = known.get(key);
        if (typeof remembered !== "undefined") {
            const rememberedOptions = this.optionsByBinding.get(remembered);
            if (typeof rememberedOptions !== "undefined") {
                rememberedOptions.registerAddress ||= options.registerAddress;
                rememberedOptions.registerPathInfo ||= options.registerPathInfo;
                rememberedOptions.applyOnReconnect ||= options.applyOnReconnect;
            }
            return remembered;
        }
        known.set(key, binding);
        this.optionsByBinding.set(binding, { ...options });
        return binding;
    }
    /**
     * RowPlan 経路の一括初期化（createContent 専用・docs/state-row-instantiation-redesign.md §3-2）。
     * プラン行の binding はこの呼び出しでのみ生成されるため remember（キー照合・
     * options マージ）を丸ごと省略し、policy/authority はテンプレート時に解決済みの
     * 値を焼き込む。options は行内共有の 1 オブジェクト（activate が
     * registerAddress を昇格するとき行内全 binding が同時に昇格する — 従来も
     * activate は全 binding を同順で昇格するため観測可能な差はない）。
     */
    initializeRow(plan, bindings) {
        this.rowPlan = plan;
        const rowOptions = { registerAddress: false, registerPathInfo: false, applyOnReconnect: false };
        const slots = plan.slots;
        for (let i = 0; i < bindings.length; i++) {
            const binding = bindings[i];
            const slot = slots[i];
            const anchor = binding.replaceNode;
            addInterestedSession(anchor, this);
            this.addKnownRowBinding(anchor, binding, i);
            this.optionsByBinding.set(binding, rowOptions);
            const record = {
                id: ++nextRecordId,
                info: binding,
                generation: ++nextGeneration,
                phase: "active",
                teardowns: null,
                session: this,
                anchor,
                options: rowOptions,
                address: null,
                patternPathInfo: null,
                patternListIndex: null,
                pendingDefinitions: 0,
                initialPolicy: slot.policy,
                resolvedAuthority: slot.authority,
                initialSettled: true,
                observationPending: false,
                eventSequence: 0,
                hasProducerValue: false,
                producerValue: undefined,
                eventAttached: false,
                twowayAttached: false,
            };
            recordByBinding.set(binding, record);
            this.records.add(record);
            if (slot.isEvent) {
                try {
                    attachEventHandler(binding);
                }
                catch (error) {
                    record.phase = "failed";
                    this.runTeardowns(record);
                    this.records.delete(record);
                    throw error;
                }
                record.eventAttached = true;
            }
            // 非 event スロットはプラン適格性により双方向不能・radio/checkbox 不能・
            // token 配線不能が確定しているため attach 系を一切呼ばない
        }
    }
    /**
     * プラン行の活性化（activate の高速経路）。bindings は initializeRow と同一の
     * スロット整列配列（bindingsByContent がそのまま保持）である前提。
     * プラン行の record は policy/authority 解決済み・observable なし・
     * connect-snapshot なしが構造的に保証されているため、settleInitialRecord /
     * settleConnectedSnapshot の呼び出し自体を省略できる。
     * プール再利用（disposed/failed）では record オブジェクトを再利用し、
     * 世代だけ進めて listener attach とアドレス登録をやり直す（record 再割当なし）。
     */
    activatePlanRows(plan, bindings, knownRoot) {
        const slots = plan.slots;
        for (let i = 0; i < bindings.length; i++) {
            const binding = bindings[i];
            const record = recordByBinding.get(binding);
            if (typeof record === "undefined" || record.session !== this) {
                // この session の record を持たない binding（防御）: 従来経路
                this.initialize([binding], { registerAddress: true, registerPathInfo: false, applyOnReconnect: false });
                continue;
            }
            record.options.registerAddress = true;
            if (record.phase === "disposed" || record.phase === "failed") {
                // pool 再利用: dispose 済み record を initializeRow と同じ内容で再充填
                const slot = slots[i];
                record.generation = ++nextGeneration;
                record.phase = "active";
                record.initialPolicy = slot.policy;
                record.resolvedAuthority = slot.authority;
                record.initialSettled = true;
                this.records.add(record);
                if (slot.isEvent) {
                    try {
                        attachEventHandler(binding);
                    }
                    catch (error) {
                        record.phase = "failed";
                        this.runTeardowns(record);
                        this.records.delete(record);
                        throw error;
                    }
                    record.eventAttached = true;
                }
                this.registerAddress(record, knownRoot);
                continue;
            }
            if (record.address === null && record.patternListIndex === null) {
                // 初回活性化
                this.registerAddress(record, knownRoot);
            }
        }
    }
    addKnownRowBinding(anchor, binding, slotIndex) {
        const current = this.knownBindingsByNode.get(anchor);
        if (typeof current === "undefined") {
            this.knownBindingsByNode.set(anchor, binding);
            return;
        }
        // 同一 anchor に複数スロット（複数エントリの data-wcs）: Map へ昇格。
        // プラン行はキー照合されないため添字ベースの合成キーで一意性だけ担保する
        if (current instanceof Map) {
            current.set("@plan:" + slotIndex, binding);
            return;
        }
        const map = new Map();
        map.set("@plan:first", current);
        map.set("@plan:" + slotIndex, binding);
        this.knownBindingsByNode.set(anchor, map);
    }
    start(binding, options, knownRoot) {
        replaceToReplaceNode(binding);
        const recordOptions = this.optionsByBinding.get(binding) ?? { ...options };
        const record = {
            id: ++nextRecordId,
            info: binding,
            generation: ++nextGeneration,
            phase: "discovered",
            teardowns: null,
            session: this,
            anchor: binding.replaceNode,
            options: recordOptions,
            address: null,
            patternPathInfo: null,
            patternListIndex: null,
            pendingDefinitions: 0,
            initialPolicy: null,
            resolvedAuthority: null,
            initialSettled: false,
            observationPending: false,
            eventSequence: 0,
            hasProducerValue: false,
            producerValue: undefined,
            eventAttached: false,
            twowayAttached: false,
        };
        recordByBinding.set(binding, record);
        this.records.add(record);
        // knownRoot が渡されたときは observe を省略する（null = detached fragment 上で
        // observableRootFor が必ず null、Node = activate 冒頭で owner 保証済み）
        if (typeof knownRoot === "undefined")
            this.observe(record.anchor);
        try {
            record.phase = "attaching";
            this.attachListeners(record);
            if (record.options.registerAddress)
                this.registerAddress(record, knownRoot);
            if (record.pendingDefinitions === 0)
                record.phase = "active";
        }
        catch (error) {
            record.phase = "failed";
            this.runTeardowns(record);
            this.records.delete(record);
            throw error;
        }
    }
    attachListeners(record) {
        const binding = record.info;
        if (attachEventHandler(binding)) {
            record.eventAttached = true;
            return;
        }
        if (binding.propSegments[0] === "eventToken") {
            this.attachAfterDefinition(record, () => {
                if (attachEventTokenHandler(binding)) {
                    addRecordTeardown(record, () => detachEventTokenHandler(binding));
                }
            });
            return;
        }
        if (attachRadioEventHandler(binding)) {
            addRecordTeardown(record, () => detachRadioEventHandler(binding));
        }
        if (attachCheckboxEventHandler(binding)) {
            addRecordTeardown(record, () => detachCheckboxEventHandler(binding));
        }
        this.attachAfterDefinition(record, () => {
            // directional initial sync の producer-value observer は twowayEventHandlerFunction
            // からのみ呼ばれる（唯一の consumer）。その handler が attach されるのは
            // isPossibleTwoWay かつ非 ro の binding だけ（attachTwowayEventHandler と同条件）
            // なので、one-way / event / eventToken / radio(非value) 等では observer は決して
            // fire しない。以前は attachListeners 冒頭で全 binding に無条件登録していたが、
            // fire しえない大多数の binding に対する setup 死荷重だった。ここへ移すことで
            // 「twoway handler が付く binding のみ observer 登録」を構造的に保証する
            // （undefined custom element は attachAfterDefinition が定義後まで遅延するので
            // isPossibleTwoWay の未定義 CE raiseError も踏まない）。
            if (config.enableDirectionalInitialSync
                && isPossibleTwoWay(binding.node, binding.propName)
                && binding.propModifiers.indexOf("ro") === -1) {
                const removeObserver = addTwowayValueObserver(binding.node, binding.propName, (value) => {
                    if (!this.isAlive(record, record.generation))
                        return;
                    record.eventSequence += 1;
                    record.hasProducerValue = true;
                    record.producerValue = value;
                });
                addRecordTeardown(record, removeObserver);
            }
            attachTwowayEventHandler(binding);
            record.twowayAttached = true;
        });
    }
    attachAfterDefinition(record, attach) {
        const tagName = getCustomElement(record.info.node);
        if (tagName === null) {
            attach();
            return;
        }
        const registry = getCustomElementRegistry();
        if (registry === null) {
            raiseError(`CustomElementRegistry is unavailable for <${tagName}>.`);
        }
        if (typeof registry.get(tagName) !== "undefined") {
            attach();
            return;
        }
        record.phase = "waiting-definition";
        record.pendingDefinitions += 1;
        const generation = record.generation;
        const coordinator = getDefinitionCoordinator(registry);
        const cancel = coordinator.wait(tagName, () => {
            if (!this.isAlive(record, generation))
                return;
            try {
                upgradeCustomElement(registry, record.info.node);
                attach();
                record.pendingDefinitions -= 1;
                if (record.pendingDefinitions === 0) {
                    record.phase = "active";
                    this.settleInitialRecord(record);
                }
            }
            catch {
                record.phase = "failed";
                this.runTeardowns(record);
                this.records.delete(record);
            }
        }, () => {
            if (!this.isAlive(record, generation))
                return;
            record.phase = "failed";
            this.runTeardowns(record);
            this.records.delete(record);
        });
        addRecordTeardown(record, cancel);
    }
    settleInitialRecord(record) {
        if (!config.enableDirectionalInitialSync || record.initialSettled || !record.options.registerAddress)
            return;
        record.phase = "synchronizing";
        try {
            const policy = resolveInitialSyncPolicy(record.info);
            const authority = resolveInitialAuthority(record.info, policy.authority);
            record.initialPolicy = policy;
            record.resolvedAuthority = authority;
            record.initialSettled = true;
            record.phase = "active";
            if (!policy.observable)
                return;
            if (policy.syncOn === "connect"
                && record.info.node instanceof HTMLElement
                && !record.info.node.isConnected) {
                record.observationPending = true;
                // 待ちが 1 件でもある間は追加側 observer スキップを無効化する
                incrementPendingObservation();
                return;
            }
            this.readProducerSnapshot(record, policy.syncOn === "call");
        }
        catch (error) {
            record.phase = "failed";
            this.runTeardowns(record);
            this.records.delete(record);
            throw error;
        }
    }
    readProducerSnapshot(record, eventWins) {
        if (!this.isAlive(record, record.generation))
            return;
        const target = record.info.node;
        const name = record.info.propName;
        if (!(name in target))
            return;
        const sequence = record.eventSequence;
        const value = target[name];
        if (record.observationPending) {
            record.observationPending = false;
            decrementPendingObservation();
        }
        if (eventWins && record.eventSequence !== sequence)
            return;
        record.hasProducerValue = true;
        record.producerValue = value;
        if (record.resolvedAuthority === "element") {
            commitProducerValue(record.info, value);
        }
    }
    settleConnectedSnapshot(record) {
        if (!config.enableDirectionalInitialSync
            || !record.observationPending
            || !(record.info.node instanceof HTMLElement)
            || !record.info.node.isConnected)
            return;
        try {
            this.readProducerSnapshot(record, false);
        }
        catch {
            record.phase = "failed";
            this.runTeardowns(record);
            this.records.delete(record);
        }
    }
    registerAddress(record, knownRoot) {
        if (record.address !== null || record.patternListIndex !== null)
            return;
        const binding = record.info;
        const listIndex = getListIndexByBindingInfo(binding);
        if (listIndex !== null) {
            // リスト行: (absolutePathInfo, listIndex) のパターン台帳に登録し、
            // AbsoluteStateAddress の intern（アドレス割当 + intern 用 WeakMap）を省略する
            const rootNode = resolveBindingRootNode(binding, knownRoot);
            const stateElement = getStateElementByName(rootNode, binding.stateName);
            if (stateElement === null) {
                raiseError(`State element with name "${binding.stateName}" not found for binding.`);
            }
            const absolutePathInfo = getAbsolutePathInfo(stateElement, binding.statePathInfo);
            addBindingByPattern(absolutePathInfo, listIndex, binding);
            record.patternPathInfo = absolutePathInfo;
            record.patternListIndex = listIndex;
        }
        else {
            const address = getAbsoluteStateAddressByBinding(binding, knownRoot);
            addBindingByAbsoluteStateAddress(address, binding);
            record.address = address;
        }
        // 台帳解除は runTeardowns が record.address / pattern フィールドから
        // データ駆動で行う（クロージャ不要）
        if (!record.options.registerPathInfo)
            return;
        const rootNode = binding.replaceNode.getRootNode();
        const stateElement = getStateElementByName(rootNode, binding.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${binding.stateName}" not found for binding.`);
        }
        if (binding.bindingType !== "event") {
            stateElement.setPathInfo(binding.statePathName, binding.bindingType);
        }
    }
    isAlive(record, generation) {
        return record.generation === generation
            && recordByBinding.get(record.info) === record
            && record.phase !== "disposed"
            && record.phase !== "failed";
    }
    disposeRecord(record) {
        if (record.phase === "disposed")
            return;
        record.phase = "disposed";
        this.runTeardowns(record);
        this.records.delete(record);
    }
    runTeardowns(record) {
        // runTeardowns は record の終端（disposed / failed）でのみ呼ばれる。未消化の
        // connect-snapshot 待ちが残っていれば必ずカウンタを戻す（スキップ再有効化）。
        if (record.observationPending) {
            record.observationPending = false;
            decrementPendingObservation();
        }
        const binding = record.info;
        // データ駆動の後始末（従来はクロージャで積んでいた頻出3種）。実行順は従来の
        // 逆順実行と同じ: アドレス台帳解除（最後に積まれていた）→ 双方向 detach →
        // 希少クロージャ群（逆順）→ イベント detach。各 detach は互いに独立した資源を
        // 対象とするため、この順序で意味論は変わらない。
        if (record.address !== null) {
            try {
                removeBindingByAbsoluteStateAddress(record.address, binding);
                record.address = null;
                clearStateAddressByBindingInfo(binding);
                clearAbsoluteStateAddressByBinding(binding);
            }
            catch {
                // Cleanup is best-effort; one faulty resource must not retain the rest.
            }
        }
        else if (record.patternListIndex !== null) {
            try {
                removeBindingByPattern(record.patternPathInfo, record.patternListIndex, binding);
                record.patternPathInfo = null;
                record.patternListIndex = null;
                // 相対アドレス（getValue）と絶対アドレス（applyChangeToFor / updatedCallback 経由の
                // 遅延 intern）のメモは pattern 登録でも作られうるため対称にクリアする
                clearStateAddressByBindingInfo(binding);
                clearAbsoluteStateAddressByBinding(binding);
            }
            catch {
                // Cleanup is best-effort.
            }
        }
        if (record.twowayAttached) {
            record.twowayAttached = false;
            try {
                detachTwowayEventHandler(binding);
            }
            catch {
                // Cleanup is best-effort.
            }
        }
        if (record.teardowns !== null) {
            const teardowns = Array.from(record.teardowns).reverse();
            record.teardowns = null;
            for (const teardown of teardowns) {
                try {
                    teardown();
                }
                catch {
                    // Cleanup is best-effort; one faulty resource must not retain the rest.
                }
            }
        }
        if (record.eventAttached) {
            record.eventAttached = false;
            try {
                detachEventHandler(binding);
            }
            catch {
                // Cleanup is best-effort.
            }
        }
    }
}
function getOrCreateBindingSession(root) {
    let session = sessionByRoot.get(root);
    if (typeof session === "undefined") {
        session = new BindingSession(root);
        sessionByRoot.set(root, session);
    }
    return session;
}
function getBindingSession(binding) {
    return recordByBinding.get(binding)?.session ?? null;
}

const completeByStateElementByWebComponent = new WeakMap();
function markWebComponentAsComplete(webComponent, stateElement) {
    let completeByStateElement = completeByStateElementByWebComponent.get(webComponent);
    if (!completeByStateElement) {
        completeByStateElement = new WeakMap();
        completeByStateElementByWebComponent.set(webComponent, completeByStateElement);
    }
    completeByStateElement.set(stateElement, true);
}
function isWebComponentComplete(webComponent, stateElement) {
    const completeByStateElement = completeByStateElementByWebComponent.get(webComponent);
    if (!completeByStateElement) {
        return false;
    }
    return completeByStateElement.get(stateElement) === true;
}

function applyChangeToAttribute(binding, _context, newValue) {
    const element = binding.node;
    const attrName = binding.propSegments[1];
    if (element.getAttribute(attrName) !== newValue) {
        element.setAttribute(attrName, newValue);
    }
}

function createEmptyArray() {
    return Object.freeze([]);
}

function getFilteredValue(value, filters) {
    let filteredValue = value;
    for (const filter of filters) {
        filteredValue = filter.filterFn(filteredValue);
    }
    return filteredValue;
}

const EMPTY_ARRAY = createEmptyArray();
function applyChangeToCheckbox(binding, _context, newValue) {
    const element = binding.node;
    const elementValue = element.value;
    const elementFilteredValue = getFilteredValue(elementValue, binding.inFilters);
    const normalizedNewValue = Array.isArray(newValue) ? newValue : EMPTY_ARRAY;
    element.checked = normalizedNewValue.includes(elementFilteredValue);
}

function applyChangeToClass(binding, _context, newValue) {
    const element = binding.node;
    const className = binding.propSegments[1];
    if (typeof newValue !== 'boolean') {
        raiseError(`Invalid value for class application: expected boolean, got ${typeof newValue}`);
    }
    element.classList.toggle(className, newValue);
}

/**
 * command.<methodName>: <commandToken-path> バインディングの適用ハンドラ。
 *
 * subscribe lifecycle:
 *   - 同一 binding に同じ token が再評価された場合は no-op。
 *   - 異なる token が来た場合は古い subscription を解除し、新しい token に subscribe し直す。
 *     旧解除は新しい binding 妥当性検証（methodName・wcBindable.commands チェック）を
 *     通過した後に行うため、再評価が validation で失敗しても旧購読は温存される（fail-fast）。
 *   - element は WeakRef で保持し、subscriber 経由で element を強参照しないようにする。
 *     これにより、element が DOM から消えた後に subscriber が token._subscribers に
 *     残っていても element 本体は GC 可能。
 *   - emit 時に下記いずれかなら自動で subscription を破棄する（lazy purge）:
 *     - WeakRef.deref() が undefined（element が既に GC 済み）
 *     - element.isConnected が false（DOM から取り外されている）
 *
 * 既知の制約:
 *   - emit が来なければ stale subscriber は token に残り続ける（要素が GC されても subscriber 関数自体は残る）。
 *     state インスタンスが disconnect されたタイミングで registry ごとクリアされるため、最終的には解放される。
 *     element ライフサイクルに直接フックする手段が現状の binding 機構に無いため、能動的な purge は将来課題。
 */
const subscribedBindings = new WeakMap();
function getWcBindable(element) {
    const customTagName = getCustomElement(element);
    if (customTagName === null) {
        return null;
    }
    const customClass = getCustomElementRegistry()?.get(customTagName);
    if (typeof customClass === "undefined") {
        raiseError(`Custom element <${customTagName}> is not defined for command binding.`);
    }
    return readBindableDeclaration(element);
}
function applyChangeToCommand(binding, _context, newValue) {
    if (!isCommandToken(newValue)) {
        raiseError(`command binding requires a CommandToken value (use $command.<tokenName> with a name declared in $commandTokens).`);
    }
    const token = newValue;
    const existing = subscribedBindings.get(binding);
    if (existing && existing.token === token) {
        return;
    }
    // 新しい binding 妥当性検証は、旧 subscription を解除する前に通す（fail-fast）。
    const element = binding.node;
    const methodName = binding.propSegments[1];
    if (typeof methodName !== "string" || methodName.length === 0) {
        raiseError(`command binding requires a method name (e.g., "command.fetch").`);
    }
    const bindable = getWcBindable(element);
    if (bindable === null) {
        raiseError(`command binding requires a wc-bindable custom element. <${element.tagName.toLowerCase()}> is not wc-bindable.`);
    }
    if (!bindable.declaredCommands.has(methodName)) {
        raiseError(`Command "${methodName}" is not declared in wcBindable.commands of <${element.tagName.toLowerCase()}>.`);
    }
    // ここまで来たら旧解除して新 subscribe に切り替える。
    if (existing) {
        existing.unsubscribe();
        subscribedBindings.delete(binding);
    }
    const elementRef = new WeakRef(element);
    let unsubscribe = null;
    const subscriber = (...args) => {
        const el = elementRef.deref();
        if (!el || !el.isConnected) {
            unsubscribe?.();
            subscribedBindings.delete(binding);
            return undefined;
        }
        const method = el[methodName];
        if (typeof method !== "function") {
            raiseError(`Method "${methodName}" is not a function on <${el.tagName.toLowerCase()}>.`);
        }
        return Reflect.apply(method, el, args);
    };
    unsubscribe = token.subscribe(subscriber);
    subscribedBindings.set(binding, { token, unsubscribe, elementRef });
}

const indexBindingsByContent = new WeakMap();
function getIndexBindingsByContent(content) {
    return indexBindingsByContent.get(content) ?? [];
}
function setIndexBindingsByContent(content, bindings) {
    indexBindingsByContent.set(content, bindings);
}

if (!Set.prototype.difference) {
    Set.prototype.difference = function (other) {
        const result = new Set(this);
        for (const elem of other) {
            result.delete(elem);
        }
        return result;
    };
}
if (!Set.prototype.intersection) {
    Set.prototype.intersection = function (other) {
        const result = new Set();
        for (const elem of other) {
            if (this.has(elem)) {
                result.add(elem);
            }
        }
        return result;
    };
}

let count = 0;
function getUUID() {
    return `u${(count++).toString(36)}`;
}

let version$1 = 0;
class ListIndex {
    uuid = getUUID();
    parentListIndex;
    position;
    length;
    _index;
    _version;
    _indexes;
    _listIndexes;
    /**
     * Creates a new ListIndex instance.
     *
     * @param parentListIndex - Parent list index for nested loops, or null for top-level
     * @param index - Current index value in the loop
     */
    constructor(parentListIndex, index) {
        this.parentListIndex = parentListIndex;
        this.position = parentListIndex ? parentListIndex.position + 1 : 0;
        this.length = this.position + 1;
        this._index = index;
        this._version = version$1;
    }
    /**
     * Gets current index value.
     *
     * @returns Current index number
     */
    get index() {
        return this._index;
    }
    /**
     * Sets index value and updates version.
     *
     * @param value - New index value
     */
    set index(value) {
        this._index = value;
        this._version = ++version$1;
        this.indexes[this.position] = value;
    }
    /**
     * Gets current version number for change detection.
     *
     * @returns Version number
     */
    get version() {
        return this._version;
    }
    /**
     * Checks if parent indexes have changed since last access.
     *
     * @returns true if parent has newer version, false otherwise
     */
    get dirty() {
        if (this.parentListIndex === null) {
            return false;
        }
        else {
            return this.parentListIndex.dirty || this.parentListIndex.version > this._version;
        }
    }
    /**
     * Gets array of all index values from root to current level.
     * Rebuilds array if parent indexes have changed (dirty).
     *
     * @returns Array of index values
     */
    get indexes() {
        if (this.parentListIndex === null) {
            if (typeof this._indexes === "undefined") {
                this._indexes = [this._index];
            }
        }
        else {
            if (typeof this._indexes === "undefined" || this.dirty) {
                this._indexes = [...this.parentListIndex.indexes, this._index];
                this._version = version$1;
            }
        }
        return this._indexes;
    }
    /**
     * Gets array of WeakRef to all ListIndex instances from root to current level.
     *
     * @returns Array of WeakRef<IListIndex>
     */
    get listIndexes() {
        if (this.parentListIndex === null) {
            if (typeof this._listIndexes === "undefined") {
                this._listIndexes = [new WeakRef(this)];
            }
        }
        else {
            if (typeof this._listIndexes === "undefined") {
                this._listIndexes = [...this.parentListIndex.listIndexes, new WeakRef(this)];
            }
        }
        return this._listIndexes;
    }
    /**
     * Gets variable name for this loop index ($1, $2, etc.).
     *
     * @returns Variable name string
     */
    get varName() {
        return `$${this.position + 1}`;
    }
    /**
     * Gets ListIndex at specified position in hierarchy.
     * Supports negative indexing from end.
     *
     * @param pos - Position index (0-based, negative for from end)
     * @returns ListIndex at position or null if not found/garbage collected
     */
    at(pos) {
        if (pos >= 0) {
            return this.listIndexes[pos]?.deref() || null;
        }
        else {
            return this.listIndexes[this.listIndexes.length + pos]?.deref() || null;
        }
    }
}
/**
 * Factory function to create ListIndex instance.
 *
 * @param parentListIndex - Parent list index for nested loops, or null for top-level
 * @param index - Current index value in the loop
 * @returns New IListIndex instance
 */
function createListIndex(parentListIndex, index) {
    return new ListIndex(parentListIndex, index);
}

const listIndexesByList = new WeakMap();
function getListIndexesByList(list) {
    return listIndexesByList.get(list) || null;
}
function setListIndexesByList(list, listIndexes) {
    if (listIndexes === null) {
        listIndexesByList.delete(list);
        return;
    }
    listIndexesByList.set(list, listIndexes);
}

const listDiffByOldListByNewList = new WeakMap();
const EMPTY_LIST = Object.freeze([]);
const EMPTY_SET$1 = new Set();
function getListDiff(rawOldList, rawNewList) {
    const oldList = (Array.isArray(rawOldList) && rawOldList.length > 0) ? rawOldList : EMPTY_LIST;
    const newList = (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST;
    let diffByNewList = listDiffByOldListByNewList.get(oldList);
    if (!diffByNewList) {
        return null;
    }
    return diffByNewList.get(newList) || null;
}
function setListDiff(oldList, newList, diff) {
    let diffByNewList = listDiffByOldListByNewList.get(oldList);
    if (!diffByNewList) {
        diffByNewList = new WeakMap();
        listDiffByOldListByNewList.set(oldList, diffByNewList);
    }
    diffByNewList.set(newList, diff);
}
/**
 * Checks if two lists are identical by comparing length and each element.
 * @param oldList - Previous list to compare
 * @param newList - New list to compare
 * @returns True if lists are identical, false otherwise
 */
function isSameList(oldList, newList) {
    if (oldList.length !== newList.length) {
        return false;
    }
    for (let i = 0; i < oldList.length; i++) {
        if (oldList[i] !== newList[i]) {
            return false;
        }
    }
    return true;
}
/**
 * Aligns each list index's .index with its position in the new list.
 * A diff only becomes the rendered state once the updater applies it: an
 * earlier diff in the same batch (two replacements in one microtask) may have
 * moved shared indexes toward a list that never got applied, and a cache hit
 * skips recomputation entirely — so every createListDiff return re-aligns.
 */
function syncListIndexes(newIndexes) {
    for (let i = 0; i < newIndexes.length; i++) {
        if (newIndexes[i].index !== i) {
            newIndexes[i].index = i;
        }
    }
}
/**
 * Creates or updates list indexes by comparing old and new lists.
 * Optimizes by reusing existing list indexes when values match.
 * @param parentListIndex - Parent list index for nested lists, or null for top-level
 * @param oldList - Previous list (will be normalized to array)
 * @param newList - New list (will be normalized to array)
 * @param oldIndexes - Array of existing list indexes to potentially reuse
 * @returns Array of list indexes for the new list
 */
function createListDiff(parentListIndex, rawOldList, rawNewList) {
    const diff = computeListDiff(parentListIndex, rawOldList, rawNewList);
    syncListIndexes(diff.newIndexes);
    return diff;
}
function computeListDiff(parentListIndex, rawOldList, rawNewList) {
    // Normalize inputs to arrays (handles null/undefined)
    const oldList = (Array.isArray(rawOldList) && rawOldList.length > 0) ? rawOldList : EMPTY_LIST;
    const newList = (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST;
    const cachedDiff = getListDiff(oldList, newList);
    if (cachedDiff) {
        return cachedDiff;
    }
    const oldIndexes = getListIndexesByList(oldList) || [];
    let retValue;
    try {
        // Early return for empty list
        if (newList.length === 0) {
            return retValue = {
                oldIndexes: oldIndexes,
                newIndexes: [],
                changeIndexSet: EMPTY_SET$1,
                deleteIndexSet: new Set(oldIndexes),
                addIndexSet: EMPTY_SET$1,
            };
        }
        // If old list was empty, create all new indexes
        let newIndexes = getListIndexesByList(newList);
        if (oldList.length === 0) {
            if (newIndexes === null) {
                newIndexes = [];
                for (let i = 0; i < newList.length; i++) {
                    const newListIndex = createListIndex(parentListIndex, i);
                    newIndexes.push(newListIndex);
                }
            }
            return retValue = {
                oldIndexes: oldIndexes,
                newIndexes: newIndexes,
                changeIndexSet: EMPTY_SET$1,
                deleteIndexSet: EMPTY_SET$1,
                addIndexSet: new Set(newIndexes),
            };
        }
        // If lists are identical, return existing indexes unchanged (optimization)
        if (isSameList(oldList, newList)) {
            return retValue = {
                oldIndexes: oldIndexes,
                newIndexes: oldIndexes,
                changeIndexSet: EMPTY_SET$1,
                deleteIndexSet: EMPTY_SET$1,
                addIndexSet: EMPTY_SET$1,
            };
        }
        if (newIndexes !== null) {
            return calcDiffIndexes(oldIndexes, newIndexes);
        }
        newIndexes = [];
        // Use index-based map for efficiency
        // Supports duplicate values by storing array of indexes
        const indexByValue = new Map();
        for (let i = 0; i < oldList.length; i++) {
            const val = oldList[i];
            let indexes = indexByValue.get(val);
            if (!indexes) {
                indexes = [];
                indexByValue.set(val, indexes);
            }
            indexes.push(i);
        }
        // Build new indexes array by matching values with old list
        const changeIndexSet = new Set();
        const addIndexSet = new Set();
        for (let i = 0; i < newList.length; i++) {
            const newValue = newList[i];
            const existingIndexes = indexByValue.get(newValue);
            const oldIndex = existingIndexes && existingIndexes.length > 0 ? existingIndexes.shift() : undefined;
            if (typeof oldIndex === "undefined") {
                // New element
                const newListIndex = createListIndex(parentListIndex, i);
                newIndexes.push(newListIndex);
                addIndexSet.add(newListIndex);
            }
            else {
                // Reuse existing element
                const existingListIndex = oldIndexes[oldIndex];
                // Judge position change against the old list's order (oldIndexes array
                // order), not the mutable .index — an earlier diff in the same batch
                // may have already moved .index toward a list that was never applied.
                // The .index itself is re-aligned by syncListIndexes on return.
                if (oldIndex !== i) {
                    changeIndexSet.add(existingListIndex);
                }
                newIndexes.push(existingListIndex);
            }
        }
        const deleteIndexSet = (new Set(oldIndexes)).difference(new Set(newIndexes));
        return retValue = {
            oldIndexes: oldIndexes,
            newIndexes: newIndexes,
            changeIndexSet: changeIndexSet,
            deleteIndexSet: deleteIndexSet,
            addIndexSet: addIndexSet,
        };
    }
    finally {
        if (typeof retValue !== "undefined") {
            setListDiff(oldList, newList, retValue);
            setListIndexesByList(newList, retValue.newIndexes);
        }
    }
}
/**
 * Diff between two lists whose listIndex ledgers both already exist.
 * Rows are joined by listIndex identity — the same key applyChangeToFor and
 * walkDependency consume the result sets with. A value-based join could mark
 * oldIndexes-side objects that are absent from newIndexes (ledgers built along
 * unconnected diff chains hold different objects for the same value); such
 * orphan markers never match the consumers' has() lookups and only pollute
 * the dirty set. Rows without shared identity are represented as add+delete.
 */
function calcDiffIndexes(oldIndexes, newIndexes) {
    const newIndexSet = new Set(newIndexes);
    const oldIndexSet = new Set(oldIndexes);
    const changeIndexSet = new Set();
    const addIndexSet = newIndexSet.difference(oldIndexSet);
    const deleteIndexSet = oldIndexSet.difference(newIndexSet);
    // Old positions come from the oldIndexes array order (.index may have been
    // mutated by an unapplied diff in the same batch).
    const oldPosByIndex = new Map();
    for (let i = 0; i < oldIndexes.length; i++) {
        oldPosByIndex.set(oldIndexes[i], i);
    }
    for (let i = 0; i < newIndexes.length; i++) {
        const index = newIndexes[i];
        if (addIndexSet.has(index)) {
            continue;
        }
        if (oldPosByIndex.get(index) !== i) {
            // 位置が違うことだけを記録
            changeIndexSet.add(index);
        }
    }
    return {
        oldIndexes: oldIndexes,
        newIndexes: newIndexes,
        changeIndexSet: changeIndexSet,
        deleteIndexSet: deleteIndexSet,
        addIndexSet: addIndexSet,
    };
}

/**
 * Indices into `seq` whose values form a longest strictly-increasing
 * subsequence, returned in ascending order. Classic patience-sorting
 * LIS in O(n log n). `seq` values are assumed distinct (old list
 * positions are unique).
 */
function longestIncreasingSubsequence(seq) {
    const n = seq.length;
    // tails[k] = index into seq of the smallest tail of an increasing
    // subsequence of length k+1; prev[i] = predecessor index to rebuild the chain.
    const tails = [];
    const prev = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
        const value = seq[i];
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (seq[tails[mid]] < value) {
                lo = mid + 1;
            }
            else {
                hi = mid;
            }
        }
        if (lo > 0) {
            prev[i] = tails[lo - 1];
        }
        tails[lo] = i;
    }
    const result = [];
    let k = tails.length > 0 ? tails[tails.length - 1] : -1;
    while (k >= 0) {
        result.push(k);
        k = prev[k];
    }
    result.reverse();
    return result;
}
/**
 * Determines which reused list indexes can stay where they are when the DOM
 * is brought into the new list order.
 *
 * Returns null when the reused indexes already appear in their old relative
 * order (no inversions) — the caller's existing position guard then performs
 * no moves, so nothing extra is needed. When inversions exist, returns the
 * set of indexes forming a longest increasing subsequence of old positions:
 * leaving exactly those in place and moving every other content yields the
 * correct final order with the fewest content moves (the naive forward walk
 * otherwise cascades: a single swap of rows 2/999 in 1000 rows moves ~997
 * contents instead of 2).
 *
 * Note: IListIndex.index is already mutated to the NEW position by
 * createListDiff, so old positions must come from the oldIndexes array order.
 */
function computeStableIndexSet(diff) {
    // No reused index changed position, or nothing was reused: relative order
    // is already correct and the walk performs no moves.
    if (diff.changeIndexSet.size === 0 || diff.addIndexSet.size === diff.newIndexes.length) {
        return null;
    }
    const oldPosByIndex = new Map();
    for (let i = 0; i < diff.oldIndexes.length; i++) {
        oldPosByIndex.set(diff.oldIndexes[i], i);
    }
    const reused = [];
    const seq = [];
    let prevPos = -1;
    let sorted = true;
    for (const index of diff.newIndexes) {
        if (diff.addIndexSet.has(index)) {
            continue;
        }
        const pos = oldPosByIndex.get(index);
        if (pos === undefined) {
            // Invariant break (a reused index missing from oldIndexes): fall back
            // to the settle walk rather than compute a stable set from bad data.
            return null;
        }
        if (pos < prevPos) {
            sorted = false;
        }
        prevPos = pos;
        reused.push(index);
        seq.push(pos);
    }
    if (sorted) {
        return null;
    }
    const lis = longestIncreasingSubsequence(seq);
    const stable = new Set();
    for (const seqIndex of lis) {
        stable.add(reused[seqIndex]);
    }
    return stable;
}

const bindingsByContent = new WeakMap();
function getBindingsByContent(content) {
    return bindingsByContent.get(content) ?? [];
}
function setBindingsByContent(content, bindings) {
    bindingsByContent.set(content, bindings);
}

const bindingSessionByContent = new WeakMap();
function getBindingSessionByContent(content) {
    return bindingSessionByContent.get(content) ?? null;
}
function setBindingSessionByContent(content, session) {
    bindingSessionByContent.set(content, session);
}

const nodesByContent = new WeakMap();
function getNodesByContent(content) {
    return nodesByContent.get(content) ?? [];
}
function setNodesByContent(content, nodes) {
    nodesByContent.set(content, nodes);
}

function bindLoopContextToContent(content, loopContext) {
    const nodes = getNodesByContent(content);
    for (const node of nodes) {
        setLoopContextByNode(node, loopContext);
    }
}
function unbindLoopContextToContent(content) {
    const nodes = getNodesByContent(content);
    for (const node of nodes) {
        setLoopContextByNode(node, null);
    }
}

function activateContent(content, loopContext, context) {
    bindLoopContextToContent(content, loopContext);
    const bindings = getBindingsByContent(content);
    const session = getBindingSessionByContent(content);
    if (session !== null) {
        // createContent 側の initialize で remember 済みの同一 binding 配列なので、
        // remember を再実行しない専用パスで活性化する（リスト行生成のホットパス）。
        // context.rootNode は applyChangeFromBindings が確定済みの root（fragment
        // バッファ中は setRootNodeByFragment の対応先と同一）で、binding ごとの
        // getRootNode を省略できる
        session.activate(bindings, context.rootNode);
    }
    for (const binding of bindings) {
        if (session === null) {
            const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
            addBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
        }
        if (session !== null && !session.shouldApplyState(binding)) {
            continue;
        }
        applyChange(binding, context);
    }
}
function deactivateContent(content) {
    if (!content.mounted) {
        return;
    }
    const bindings = getBindingsByContent(content);
    const session = getBindingSessionByContent(content);
    for (const binding of bindings) {
        if (session !== null) {
            session.disposeBinding(binding);
        }
        else {
            const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
            removeBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
        }
    }
    unbindLoopContextToContent(content);
}

function createEmptySet() {
    return Object.freeze(new Set());
}

const contentSetByNode = new WeakMap();
const EMPTY_SET = createEmptySet();
function setContentByNode(node, content) {
    const contents = contentSetByNode.get(node);
    if (contents) {
        contents.add(content);
    }
    else {
        contentSetByNode.set(node, new Set([content]));
    }
}
function getContentSetByNode(node) {
    const contents = contentSetByNode.get(node);
    if (typeof contents !== "undefined") {
        return contents;
    }
    return EMPTY_SET;
}
function deleteContentByNode(node, content) {
    const contents = contentSetByNode.get(node);
    if (contents) {
        contents.delete(content);
        if (contents.size === 0) {
            contentSetByNode.delete(node);
        }
    }
}

/**
 * rowPlan.ts — 行実体化プランのコンパイル（docs/state-row-instantiation-redesign.md §3-1）。
 *
 * テンプレート（fragmentInfo）を初回行生成時に一度だけ検査し、全スロットが
 * 「行不変の判定をテンプレート時に確定できる」種別のときだけプランを返す。
 * 1 スロットでも確定できなければ null（テンプレート丸ごと従来経路 = 部分適用しない。
 * 経路混在のデバッグ困難を避ける設計判断・同 §5）。
 *
 * プラン適格の条件（すべて満たすこと）:
 *  - bindingType が text / prop / event のみ（構造 for/if・radio/checkbox・spread は不適格）
 *  - バインディング先ノードがカスタム要素でない（定義待ち・wcBindable 検証が不要）
 *  - prop が command / eventToken 名前空間でない（token 配線 teardown が要るため）
 *  - prop が双方向可能（isPossibleTwoWay）でない（connect-snapshot / observer 配線が要るため）
 *  - initial-sync policy が観測不要（observable=false）かつ authority が "auto" でない
 *  - text スロットは事前正規化済みの Text ノードである
 */
function compileRowPlan(fragmentInfo) {
    const directional = config.enableDirectionalInitialSync;
    const slots = [];
    const nodeInfos = fragmentInfo.nodeInfos;
    for (let nodeIndex = 0; nodeIndex < nodeInfos.length; nodeIndex++) {
        const nodeInfo = nodeInfos[nodeIndex];
        const node = resolveNodePath(fragmentInfo.fragment, nodeInfo.nodePath);
        if (node === null) {
            return null;
        }
        for (const template of nodeInfo.parseBindTextResults) {
            const bindingType = template.bindingType;
            if (bindingType !== "text" && bindingType !== "prop" && bindingType !== "event") {
                return null;
            }
            // command.<name>（prop 扱い）と eventToken.<prop>（event 扱い）は token 配線の
            // teardown / attach 分岐が要るため不適格
            const namespace = template.propSegments[0];
            if (namespace === "command" || namespace === "eventToken") {
                return null;
            }
            if (bindingType === "text") {
                if (node.nodeType !== Node.TEXT_NODE) {
                    return null;
                }
            }
            else if (getCustomElement(node) !== null) {
                return null;
            }
            if (bindingType === "prop" && isPossibleTwoWay(node, template.propName)) {
                return null;
            }
            let policy;
            try {
                // 判定はテンプレートのノードで行う（policy は node の宣言と行不変フィールドの
                // 純関数）。修飾子エラー等の throw は不適格として従来経路に倒し、従来経路が
                // 同じエラーを同じタイミング（初回行生成）で報告する。
                const probe = { ...template, node, replaceNode: node };
                policy = resolveInitialSyncPolicy(probe);
            }
            catch {
                return null;
            }
            if (policy.observable || policy.authority === "auto") {
                return null;
            }
            slots.push({
                nodeIndex,
                template,
                isEvent: bindingType === "event",
                isIndexBinding: template.statePathName in INDEX_BY_INDEX_NAME,
                policy,
                authority: policy.authority,
            });
        }
    }
    return { directional, slots };
}

const recursiveBindingTypes = new Set(['if', 'elseif', 'else', 'for']);
class Content {
    _content;
    _childNodeArray = [];
    _firstNode = null;
    _lastNode = null;
    _mounted = false;
    constructor(content) {
        this._content = content;
        this._childNodeArray = Array.from(this._content.childNodes);
        this._firstNode = this._childNodeArray.length > 0 ? this._childNodeArray[0] : null;
        this._lastNode = this._childNodeArray.length > 0 ? this._childNodeArray[this._childNodeArray.length - 1] : null;
    }
    get firstNode() {
        return this._firstNode;
    }
    get lastNode() {
        return this._lastNode;
    }
    get mounted() {
        return this._mounted;
    }
    appendTo(targetNode) {
        for (const node of this._childNodeArray) {
            // framework 起点のマウントを observer に伝える。中間 fragment へ append する
            // 経路でも、後続の一括 insertBefore(fragment) の mutation record には
            // この top-level node が addedNodes として現れるため、ここでのマークが届く。
            markObserverSkipOnAdd(node);
            targetNode.appendChild(node);
        }
        this._mounted = true;
    }
    mountAfter(targetNode) {
        const parentNode = targetNode.parentNode;
        const nextSibling = targetNode.nextSibling;
        if (parentNode) {
            for (const node of this._childNodeArray) {
                markObserverSkipOnAdd(node);
                parentNode.insertBefore(node, nextSibling);
            }
        }
        this._mounted = true;
    }
    tryDestroy() {
        const session = getBindingSessionByContent(this);
        // session 無し（SSR ハイドレーション産）や、定義待ち・connect-snapshot 待ちを
        // 抱える content は teardown 省略でリークするため従来経路に倒す。
        if (session === null || !session.canWholesaleDestroy()) {
            return false;
        }
        session.destroyRecords();
        for (const node of this._childNodeArray) {
            // unmount と同じ理由の observer 向け削除マーク（clear の一括削除でも
            // top-level node が mutation record の root に現れる）
            markObserverSkipOnRemove(node);
            if (node.parentNode !== null) {
                node.parentNode.removeChild(node);
            }
        }
        const bindings = getBindingsByContent(this);
        for (const binding of bindings) {
            if (recursiveBindingTypes.has(binding.bindingType)) {
                const contents = getContentSetByNode(binding.node);
                for (const content of contents) {
                    if (!content.tryDestroy()) {
                        content.unmount();
                    }
                }
            }
        }
        this._mounted = false;
        return true;
    }
    unmount() {
        getBindingSessionByContent(this)?.dispose();
        for (const node of this._childNodeArray) {
            // framework 起点の削除であることを observer に伝える。clear の
            // parentNode.textContent='' 一括削除でも、この top-level node が
            // 削除サブツリーの root として mutation record に現れるため、ここで
            // マークしておけば observer の冗長走査をスキップできる。マークは
            // 同期実行中に立ち、observer は次 microtask で読むので順序は保証される。
            markObserverSkipOnRemove(node);
            if (node.parentNode !== null) {
                node.parentNode.removeChild(node);
            }
        }
        const bindings = getBindingsByContent(this);
        for (const binding of bindings) {
            if (recursiveBindingTypes.has(binding.bindingType)) {
                const contents = getContentSetByNode(binding.node);
                for (const content of contents) {
                    content.unmount();
                }
            }
            clearStateAddressByBindingInfo(binding);
            clearAbsoluteStateAddressByBinding(binding);
        }
        this._mounted = false;
    }
}
/**
 * SSR ハイドレーション用: 既存の DOM ノード配列から Content を生成する。
 * テンプレートからの clone ではなく、SSR で描画済みのノードをそのまま使う。
 */
function createContentFromNodes(nodes) {
    const fragment = document.createDocumentFragment();
    // ノードを fragment に移動せず、参照だけ持つ Content を作る
    const content = new Content(fragment);
    // Content の内部状態を直接設定
    content._childNodeArray = nodes;
    content._firstNode = nodes.length > 0 ? nodes[0] : null;
    content._lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
    content._mounted = true; // SSR で既にマウント済み
    return content;
}
/**
 * RowPlan 経路の実体化: clone → nodePath 解決 → スロットから薄い binding を複製 →
 * initializeRowBindings。パース再生（spread 展開・remember・キー文字列・options
 * オブジェクト・policy 再解決）を行ごとに繰り返さない
 * （docs/state-row-instantiation-redesign.md §3-1/§3-2）。
 */
function createPlanContent(bindingInfo, fragmentInfo, plan) {
    const cloneFragment = document.importNode(fragmentInfo.fragment, true);
    const nodeInfos = fragmentInfo.nodeInfos;
    const nodes = new Array(nodeInfos.length);
    for (let i = 0; i < nodeInfos.length; i++) {
        const node = resolveNodePath(cloneFragment, nodeInfos[i].nodePath);
        if (node === null) {
            raiseError(`Node not found by path [${nodeInfos[i].nodePath.join(', ')}] in fragment.`);
        }
        // 再スキャン防止と初期化完了マークは従来経路と同じ台帳に載せる
        markNodeRegistered(node);
        resolveInitializedBinding(node);
        nodes[i] = node;
    }
    const slots = plan.slots;
    const bindings = new Array(slots.length);
    const indexBindings = [];
    for (let k = 0; k < slots.length; k++) {
        const slot = slots[k];
        const node = nodes[slot.nodeIndex];
        // text スロットは事前正規化済みの Text がそのまま replaceNode（従来経路の
        // getBindingInfos と同じ帰結）。prop/event は node === replaceNode
        const binding = { ...slot.template, node, replaceNode: node };
        bindings[k] = binding;
        if (slot.isIndexBinding) {
            indexBindings.push(binding);
        }
    }
    const session = initializeRowBindings(plan, bindings);
    const content = new Content(cloneFragment);
    setBindingSessionByContent(content, session);
    setBindingsByContent(content, bindings);
    setIndexBindingsByContent(content, indexBindings);
    setNodesByContent(content, nodes);
    setContentByNode(bindingInfo.node, content);
    return content;
}
function createContent(bindingInfo) {
    if (typeof bindingInfo.uuid === 'undefined' || bindingInfo.uuid === null) {
        raiseError(`BindingInfo.uuid is null.`);
    }
    const fragmentInfo = getFragmentInfoByUUID(bindingInfo.uuid);
    if (!fragmentInfo) {
        raiseError(`Fragment with UUID "${bindingInfo.uuid}" not found.`);
    }
    let plan = fragmentInfo.rowPlan;
    if (typeof plan === 'undefined' || (plan !== null && plan.directional !== config.enableDirectionalInitialSync)) {
        // 初回 or config（directional）が変わったときだけコンパイル。不適格は null を
        // キャッシュして以後は従来経路へ直行する
        plan = fragmentInfo.rowPlan = compileRowPlan(fragmentInfo);
    }
    if (plan !== null) {
        return createPlanContent(bindingInfo, fragmentInfo, plan);
    }
    const cloneFragment = document.importNode(fragmentInfo.fragment, true);
    const initialInfo = initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos);
    const content = new Content(cloneFragment);
    setBindingSessionByContent(content, initialInfo.bindingSession);
    setBindingsByContent(content, initialInfo.bindingInfos);
    const indexBindings = [];
    for (const binding of initialInfo.bindingInfos) {
        if (binding.statePathName in INDEX_BY_INDEX_NAME) {
            indexBindings.push(binding);
        }
    }
    setIndexBindingsByContent(content, indexBindings);
    setNodesByContent(content, initialInfo.nodes);
    setContentByNode(bindingInfo.node, content);
    return content;
}

const lastNodeByNode = new WeakMap();
const contentByListIndexByNode = new WeakMap();
const pooledContentsByNode = new WeakMap();
const isOnlyNodeInParentContentByNode = new WeakMap();
// SSR ハイドレーション用: Content を ListIndex に登録する
function hydrateSetContent(node, index, content) {
    setContent(node, index, content);
}
function hydrateSetLastNode(node, lastNode) {
    lastNodeByNode.set(node, lastNode);
}
function getPooledContents(bindingInfo) {
    return pooledContentsByNode.get(bindingInfo.node) || [];
}
// プールの上限（アンカーごと）。プールはアンカー（文書に永続するコメントノード）
// から content とその DOM サブツリー・バインディング群を強参照するため、無制限だと
// 大きなリストのクリア後もメモリが解放されない（10k 行で 10MB 級）。上限超過分は
// contentSetByNode の台帳からも外して GC 可能にする。再追加時は createContent で
// 作り直すコストと引き換えになる。
const MAX_POOLED_CONTENTS = 1000;
let maxPooledContents = MAX_POOLED_CONTENTS;
function setPooledContent(bindingInfo, content) {
    let contents = pooledContentsByNode.get(bindingInfo.node);
    if (typeof contents === 'undefined') {
        contents = [];
        pooledContentsByNode.set(bindingInfo.node, contents);
    }
    if (contents.length < maxPooledContents) {
        contents.push(content);
    }
    else {
        // 上限超過: content を完全に手放す。contentSetByNode は createContent 時に
        // 追加されたきり解放経路が無いため、ここで外さないと GC できない。
        deleteContentByNode(bindingInfo.node, content);
    }
}
function isOnlyNodeInParentContent(firstNode, lastNode) {
    let prevCheckNode = firstNode.previousSibling;
    let nextCheckNode = lastNode.nextSibling;
    let onlyNode = true;
    while (prevCheckNode !== null) {
        if (prevCheckNode.nodeType === Node.ELEMENT_NODE
            || (prevCheckNode.nodeType === Node.TEXT_NODE && (prevCheckNode.textContent?.trim() ?? '') !== '')) {
            onlyNode = false;
            break;
        }
        prevCheckNode = prevCheckNode.previousSibling;
    }
    while (nextCheckNode !== null) {
        if (nextCheckNode.nodeType === Node.ELEMENT_NODE
            || (nextCheckNode.nodeType === Node.TEXT_NODE && (nextCheckNode.textContent?.trim() ?? '') !== '')) {
            onlyNode = false;
            break;
        }
        nextCheckNode = nextCheckNode.nextSibling;
    }
    return onlyNode;
}
// A stable content may be left in place only when its first node verifiably
// follows the settled walk position in the same tree: the listIndexes ledger
// can lag the physical DOM (element-write swaps reorder listIndexes without
// moving nodes; hidden regions unmount contents that stay registered). Empty
// contents (null firstNode) always take the settle walk so their mount
// bookkeeping matches the pre-LIS behavior.
function isPhysicallyAfter(lastNode, firstNode) {
    if (firstNode === null) {
        return false;
    }
    if (lastNode.nextSibling === firstNode) {
        return true;
    }
    const position = lastNode.compareDocumentPosition(firstNode);
    return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        && (position & Node.DOCUMENT_POSITION_DISCONNECTED) === 0;
}
function setContent(node, listIndex, content) {
    let contentByListIndex = contentByListIndexByNode.get(node);
    if (typeof contentByListIndex === 'undefined') {
        if (content === null) {
            return;
        }
        contentByListIndex = new WeakMap();
        contentByListIndexByNode.set(node, contentByListIndex);
    }
    if (content === null) {
        contentByListIndex.delete(listIndex);
    }
    else {
        contentByListIndex.set(listIndex, content);
    }
}
function applyChangeToFor(bindingInfo, context, newValue) {
    const listPathInfo = bindingInfo.statePathInfo;
    const listIndex = getListIndexByBindingInfo(bindingInfo);
    const absAddress = getAbsoluteStateAddressByBinding(bindingInfo);
    const lastValue = getLastListValueByAbsoluteStateAddress(absAddress);
    const diff = createListDiff(listIndex, lastValue, newValue);
    context.newListValueByAbsAddress.set(absAddress, Array.isArray(newValue) ? newValue : []);
    const fullDelete = Array.isArray(lastValue)
        && lastValue.length === diff.deleteIndexSet.size
        && diff.deleteIndexSet.size > 0;
    if (fullDelete && bindingInfo.node.parentNode !== null) {
        let isOnlyNode = isOnlyNodeInParentContentByNode.get(bindingInfo.node);
        if (typeof isOnlyNode === 'undefined') {
            const lastNode = lastNodeByNode.get(bindingInfo.node) || bindingInfo.node;
            isOnlyNode = isOnlyNodeInParentContent(bindingInfo.node, lastNode);
            isOnlyNodeInParentContentByNode.set(bindingInfo.node, isOnlyNode);
        }
        if (isOnlyNode) {
            const parentNode = bindingInfo.node.parentNode;
            parentNode.textContent = '';
            parentNode.appendChild(bindingInfo.node);
        }
    }
    // 全削除時、プールに収まらない content は再利用されないため、per-binding の
    // teardown（listener 解除・アドレス台帳・loopContext 掃除）を丸ごと省略して
    // ノードごと GC に任せる（tryDestroy）。プール行きの分だけ従来どおり解体する
    // （プール行は binding が生存し続けるため address キャッシュのクリアが必須）。
    // content 台帳の WeakMap ビルトインは V8 プロファイルで本関数の self に計上される
    // ホットスポット: 外側の node→map 解決はループ外に持ち上げ、fullDelete（旧全行が
    // deleteIndexSet に載る＝台帳の全エントリが消える）では per-index delete を廃して
    // 台帳ごと 1 回で手放す。
    let contentMap = contentByListIndexByNode.get(bindingInfo.node);
    let poolBudget = fullDelete
        ? maxPooledContents - getPooledContents(bindingInfo).length
        : Number.POSITIVE_INFINITY;
    if (typeof contentMap !== 'undefined') {
        for (const deleteIndex of diff.deleteIndexSet) {
            const content = contentMap.get(deleteIndex);
            if (typeof content !== 'undefined') {
                if (poolBudget <= 0 && content.tryDestroy()) {
                    deleteContentByNode(bindingInfo.node, content);
                }
                else {
                    deactivateContent(content);
                    content.unmount();
                    setPooledContent(bindingInfo, content);
                    poolBudget -= 1;
                }
                if (!fullDelete) {
                    contentMap.delete(deleteIndex);
                }
            }
        }
        if (fullDelete) {
            contentByListIndexByNode.delete(bindingInfo.node);
            contentMap = undefined;
        }
    }
    let lastNode = bindingInfo.node;
    const elementPathInfo = getPathInfo(listPathInfo.path + '.' + WILDCARD);
    const loopContextStack = context.stateElement.loopContextStack;
    // When the new order contains inversions, contents in the stable set (an LIS
    // of old positions) keep their relative order and must not be moved; moving
    // only the rest avoids the cascade where one swap relocates every row in
    // between. null = no inversions; the position guard below then does no moves.
    const stableIndexSet = computeStableIndexSet(diff);
    let fragment = null;
    if (diff.newIndexes.length == diff.addIndexSet.size
        && diff.newIndexes.length > 0
        && lastNode.isConnected) {
        // 全部追加の場合はまとめて処理
        fragment = document.createDocumentFragment();
        setRootNodeByFragment(fragment, context.rootNode);
    }
    const ssrMode = inSsr();
    const uuid = bindingInfo.uuid ?? '';
    // 追加行ごとの WeakMap 解決を避けるためプール配列も 1 回だけ引く（プールの配列
    // 実体は setPooledContent が一度作ったら不変なので、delete ループ後の参照で安定）
    const pooledContents = pooledContentsByNode.get(bindingInfo.node);
    for (const index of diff.newIndexes) {
        let content;
        // add
        if (diff.addIndexSet.has(index)) {
            const stateAddress = createStateAddress(elementPathInfo, index);
            loopContextStack.createLoopContext(stateAddress, (loopContext) => {
                content = typeof pooledContents !== 'undefined' ? pooledContents.pop() : undefined;
                if (typeof content === 'undefined') {
                    content = createContent(bindingInfo);
                }
                // コンテント活性化の前にDOMツリーに追加しておく必要がある
                if (fragment !== null) {
                    if (ssrMode) {
                        fragment.appendChild(document.createComment(`@@wcs-for-start:${uuid}:${listPathInfo.path}:${index.index}`));
                    }
                    content.appendTo(fragment);
                    if (ssrMode) {
                        fragment.appendChild(document.createComment(`@@wcs-for-end:${uuid}:${listPathInfo.path}:${index.index}`));
                    }
                }
                else {
                    // Update lastNode for next iteration to ensure correct order
                    // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
                    if (lastNode.nextSibling !== content.firstNode) {
                        if (ssrMode) {
                            const startComment = document.createComment(`@@wcs-for-start:${uuid}:${listPathInfo.path}:${index.index}`);
                            lastNode.parentNode.insertBefore(startComment, lastNode.nextSibling);
                            lastNode = startComment;
                        }
                        content.mountAfter(lastNode);
                    }
                    if (ssrMode) {
                        const endComment = document.createComment(`@@wcs-for-end:${uuid}:${listPathInfo.path}:${index.index}`);
                        const afterNode = content.lastNode ?? lastNode;
                        afterNode.parentNode.insertBefore(endComment, afterNode.nextSibling);
                    }
                }
                // コンテントを活性化
                activateContent(content, loopContext, context);
            });
            if (typeof content === 'undefined') {
                raiseError(`Content not found for ListIndex: ${index.index} at path "${listPathInfo.path}"`);
            }
        }
        else {
            // getContent 相当（undefined→null 正規化は後段の raiseError 判定が null 比較のため維持）
            content = (typeof contentMap !== 'undefined' ? contentMap.get(index) ?? null : null);
            if (diff.changeIndexSet.has(index)) {
                // change
                const indexBindings = getIndexBindingsByContent(content);
                for (const indexBinding of indexBindings) {
                    applyChange(indexBinding, context);
                }
            }
            // Update lastNode for next iteration to ensure correct order
            // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
            if (content === null) {
                raiseError(`Content not found for ListIndex: ${index.index} at path "${listPathInfo.path}"`);
            }
            // Stable contents are already in correct relative order — but only
            // trust that after physical verification (see isPhysicallyAfter).
            // Contents out of order (and everything unverifiable) settle via the
            // self-healing mountAfter walk below.
            const stable = stableIndexSet !== null && stableIndexSet.has(index)
                && isPhysicallyAfter(lastNode, content.firstNode);
            if (!stable && lastNode.nextSibling !== content.firstNode) {
                content.mountAfter(lastNode);
            }
        }
        lastNode = content.lastNode || lastNode;
        if (typeof contentMap === 'undefined') {
            contentMap = new WeakMap();
            contentByListIndexByNode.set(bindingInfo.node, contentMap);
        }
        contentMap.set(index, content);
    }
    lastNodeByNode.set(bindingInfo.node, lastNode);
    if (fragment !== null) {
        // Mount all at once
        bindingInfo.node.parentNode.insertBefore(fragment, bindingInfo.node.nextSibling);
        setRootNodeByFragment(fragment, null);
    }
}

const lastConnectedByNode = new WeakMap();
function bindingInfoText(bindingInfo) {
    return `${bindingInfo.bindingType} ${bindingInfo.statePathName} ${bindingInfo.outFilters.map(f => f.filterName).join('|')} ${bindingInfo.node.isConnected ? '(connected)' : '(disconnected)'}`;
}
function applyChangeToIf(bindingInfo, context, rawNewValue) {
    const currentConnected = bindingInfo.node.isConnected;
    const newValue = Boolean(rawNewValue);
    let content;
    const contents = getContentSetByNode(bindingInfo.node);
    if (contents.size === 0) {
        content = createContent(bindingInfo);
    }
    else {
        content = contents.values().next().value;
    }
    const ssrMode = inSsr();
    const uuid = bindingInfo.uuid ?? '';
    const keyword = bindingInfo.bindingType; // if, elseif, else
    try {
        if (!newValue) {
            if (config.debug) {
                console.log(`unmount if content : ${bindingInfoText(bindingInfo)}`);
            }
            deactivateContent(content);
            content.unmount();
        }
        if (newValue) {
            if (config.debug) {
                console.log(`mount if content : ${bindingInfoText(bindingInfo)}`);
            }
            if (ssrMode) {
                const startComment = document.createComment(`@@wcs-${keyword}-start:${uuid}:${bindingInfo.statePathName}`);
                bindingInfo.node.parentNode.insertBefore(startComment, bindingInfo.node.nextSibling);
                content.mountAfter(startComment);
                const endComment = document.createComment(`@@wcs-${keyword}-end:${uuid}:${bindingInfo.statePathName}`);
                const afterNode = content.lastNode ?? startComment;
                afterNode.parentNode.insertBefore(endComment, afterNode.nextSibling);
            }
            else {
                content.mountAfter(bindingInfo.node);
            }
            const loopContext = getLoopContextByNode(bindingInfo.node);
            activateContent(content, loopContext, context);
        }
    }
    finally {
        lastConnectedByNode.set(bindingInfo.node, currentConnected);
    }
}

/**
 * 要素 `element` の `propName` プロパティ書き込みに対して、
 * wc-bindable inputs の `attribute` ミラー先属性名を返す。
 *
 * - wc-bindable でないネイティブ要素や、inputs 未宣言、attribute フィールド無しは null
 * - inputs に同名宣言があっても `attribute` を持たないものはミラー対象外
 *
 * 戻り値の string がそのまま `setAttribute(name, value)` の name となる。
 */
function getInputAttributeMirror(element, propName) {
    const customTagName = getCustomElement(element);
    if (customTagName === null) {
        return null;
    }
    const customClass = getCustomElementRegistry()?.get(customTagName);
    if (typeof customClass === "undefined") {
        return null;
    }
    const input = readBindableDeclaration(element)?.declaredInputs.get(propName);
    if (typeof input?.attribute === "string" && input.attribute.length > 0) {
        return input.attribute;
    }
    return null;
}
/**
 * mirror 属性値の表現を決める。
 * - null / undefined → 属性削除
 * - object / array → JSON.stringify (失敗時は String(value))
 * - その他 (string / number / boolean / bigint) → String(value)
 */
function applyMirrorAttribute(element, attributeName, value) {
    if (value === null || typeof value === "undefined") {
        element.removeAttribute(attributeName);
        return;
    }
    let formatted;
    if (typeof value === "object") {
        try {
            formatted = JSON.stringify(value);
        }
        catch {
            formatted = String(value);
        }
    }
    else {
        formatted = String(value);
    }
    element.setAttribute(attributeName, formatted);
}

/**
 * SSR 時に HTML 属性で表現できないプロパティバインディングを蓄積するストア。
 * ハイドレーション時にクライアント側で復元する。
 */
// node → プロパティエントリのリスト
const store = new WeakMap();
function addSsrProperty(node, propName, value) {
    let entries = store.get(node);
    if (!entries) {
        entries = [];
        store.set(node, entries);
    }
    // 同じプロパティの既存エントリは上書き
    const existing = entries.find(e => e.propName === propName);
    if (existing) {
        existing.value = value;
    }
    else {
        entries.push({ propName, value });
    }
}
function getSsrProperties(node) {
    return store.get(node) ?? [];
}
function getAllSsrPropertyNodes() {
    // WeakMap は列挙不可なので、別途トラッキングが必要
    return Array.from(trackedNodes);
}
const trackedNodes = new Set();
function trackSsrPropertyNode(node) {
    trackedNodes.add(node);
}
function clearSsrPropertyStore() {
    trackedNodes.clear();
}

// SSR 時に HTML 属性で代替可能なプロパティ
// これら以外のプロパティは ssrPropertyStore に蓄積してハイドレーション時に復元
const SSR_ATTR_PROPS = {
    value(element, value) {
        if (element.tagName === 'TEXTAREA') {
            element.textContent = String(value ?? '');
        }
        else {
            element.setAttribute('value', String(value ?? ''));
        }
    },
    checked(element, value) {
        if (value)
            element.setAttribute('checked', '');
        else
            element.removeAttribute('checked');
    },
    selected(element, value) {
        if (value)
            element.setAttribute('selected', '');
        else
            element.removeAttribute('selected');
    },
    disabled(element, value) {
        if (value)
            element.setAttribute('disabled', '');
        else
            element.removeAttribute('disabled');
    },
    selectedIndex(element, value) {
        const options = element.querySelectorAll('option');
        const idx = Number(value);
        for (let i = 0; i < options.length; i++) {
            if (i === idx)
                options[i].setAttribute('selected', '');
            else
                options[i].removeAttribute('selected');
        }
    },
};
function applyChangeToProperty(binding, _context, newValue) {
    // undefined は「状態が値を持たない＝無意見」であり、書き込み自体をスキップして
    // 要素側の既定値を生かす。書き込んでしまうと setter の文字列化で
    // "undefined" 属性や removeAttribute が走り要素が壊れる (spread で未初期化
    // slot を配線したときに顕在化)。明示的なクリアは null で表現する。
    // mirror 属性 (applyMirrorAttribute) の「undefined → 属性削除」と同じ語彙。
    if (typeof newValue === "undefined") {
        if (config.debug) {
            console.debug(`Skipped property write: state value is undefined.`, {
                element: binding.node,
                propSegments: binding.propSegments,
                statePathName: binding.statePathName,
            });
        }
        return;
    }
    const element = binding.node;
    const propSegments = binding.propSegments;
    if (propSegments.length === 1) {
        const firstSegment = propSegments[0];
        if (element[firstSegment] !== newValue) {
            const performWrite = () => {
                let propertyWriteSucceeded = false;
                try {
                    element[firstSegment] = newValue;
                    propertyWriteSucceeded = true;
                }
                catch (error) {
                    if (config.debug) {
                        console.warn(`Failed to set property '${firstSegment}' on element.`, {
                            element,
                            newValue,
                            error
                        });
                    }
                }
                // wc-bindable inputs[].attribute ミラー。プロパティ書き込みが成功したときだけ
                // 属性へ反映する。setter が値を拒否した場合に属性だけ進んでしまうと
                // property と attribute が乖離し、attributeChangedCallback や CSS セレクタが
                // 実際のプロパティ値と矛盾した状態で発火するため、ここでガードする。
                if (propertyWriteSucceeded) {
                    const mirrorAttr = getInputAttributeMirror(element, firstSegment);
                    if (mirrorAttr !== null) {
                        try {
                            applyMirrorAttribute(element, mirrorAttr, newValue);
                        }
                        catch (error) {
                            if (config.debug) {
                                console.warn(`Failed to mirror attribute '${mirrorAttr}' on element.`, {
                                    element,
                                    newValue,
                                    error
                                });
                            }
                        }
                    }
                }
            };
            // Zero-cost fast path (§4 最適化): the propagation edge / WriteReceipt
            // machinery only matters when the element write can *echo* — i.e. the setter
            // may synchronously dispatch an event a two-way wire feeds back to state.
            // `isPossibleTwoWay` is the same conservative check the two-way listener
            // registration uses, and it is cheap for the common one-way case (textContent
            // / class / style on plain elements return false fast). One-way bindings can
            // never re-traverse an edge, so skipping the context/receipt is safe and
            // avoids a per-apply Set copy + receipt allocation. Diamond / coalescing are
            // unaffected — those ride the write-transaction context threaded through the
            // updater, not the element edge.
            if (config.enablePropagationContext && isPossibleTwoWay(element, firstSegment)) {
                // Phase 3: state → element edge の通過を記録し、同じ transaction が
                // 同じ edge を再度通ろうとした場合だけ抑止する（設計書 §4 規則 2）。
                // 書き込みは WriteReceipt scope で包み、setter が同期 dispatch する
                // event が confirmation / 正規化を判定できるようにする（規則 3）。
                const wireId = getWireId(element, firstSegment, binding.stateName, binding.statePathName);
                const edgeId = getEdgeId(wireId, "to-element");
                const baseContext = _context?.propagationContextByBinding?.get(binding)
                    ?? getCurrentPropagationContext()
                    ?? beginPropagationTransaction(wireId);
                if (baseContext.visitedEdges.has(edgeId)) {
                    if (devtoolsSink !== null) {
                        devtoolsSink({
                            type: "propagation:suppressed",
                            reason: "visited-edge",
                            transactionId: baseContext.transactionId,
                            edgeId,
                            node: element,
                            member: firstSegment,
                        });
                    }
                }
                else {
                    const extendedContext = extendPropagationContext(baseContext, edgeId);
                    runWithPropagationContext(extendedContext, () => runWithWriteReceipt(element, firstSegment, newValue, wireId, extendedContext.transactionId, performWrite));
                }
            }
            else {
                performWrite();
            }
        }
        if (inSsr()) {
            const attrHandler = SSR_ATTR_PROPS[firstSegment];
            if (attrHandler) {
                // 属性で代替可能 → HTML 属性に反映
                attrHandler(element, newValue);
            }
            else {
                // 属性で代替不可 → ハイドレーション用ストアに蓄積
                addSsrProperty(element, firstSegment, newValue);
                trackSsrPropertyNode(element);
            }
        }
        return;
    }
    const firstSegment = propSegments[0];
    let subObject = element[firstSegment];
    for (let i = 1; i < propSegments.length - 1; i++) {
        const segment = propSegments[i];
        if (subObject == null) {
            return;
        }
        subObject = subObject[segment];
    }
    const oldValue = subObject[propSegments[propSegments.length - 1]];
    if (oldValue !== newValue) {
        if (Object.isFrozen(subObject)) {
            if (config.debug) {
                console.warn(`Attempting to set property on frozen object.`, {
                    element,
                    propSegments,
                    oldValue,
                    newValue
                });
            }
            return;
        }
        try {
            subObject[propSegments[propSegments.length - 1]] = newValue;
        }
        catch (error) {
            if (config.debug) {
                console.warn(`Failed to set property on sub-object.`, {
                    element,
                    propSegments,
                    oldValue,
                    newValue,
                    error
                });
            }
        }
    }
    // サブオブジェクトプロパティ (e.g. style.xxx) は属性に反映済みなのでストア不要
}

function applyChangeToRadio(binding, _context, newValue) {
    const element = binding.node;
    const elementValue = element.value;
    const elementFilteredValue = getFilteredValue(elementValue, binding.inFilters);
    element.checked = newValue === elementFilteredValue;
}

function applyChangeToStyle(binding, _context, newValue) {
    const styleName = binding.propSegments[1];
    const style = binding.node.style;
    const currentValue = style[styleName];
    if (currentValue !== newValue) {
        style[styleName] = newValue;
    }
}

const ssrWrappedNodes = new WeakSet();
function applyChangeToText(binding, _context, newValue) {
    // nodeValue は nullable DOMString（実ブラウザでは null / undefined とも空文字に
    // 正規化される）ため、比較前に同じ規則で文字列化する。生値のまま比較すると
    // 数値など非文字列値は常に不一致になり、同値でも毎回 DOM 書き込みが走る。
    // 注: happy-dom は undefined を "undefined" にする非準拠実装なので String() に
    // 頼らず明示的に "" へ正規化する。
    const text = newValue === null || newValue === undefined ? "" : String(newValue);
    if (binding.replaceNode.nodeValue !== text) {
        binding.replaceNode.nodeValue = text;
    }
    // SSR モード時: テキストノードの前後にコメントを挿入して境界を明示
    if (inSsr() && !ssrWrappedNodes.has(binding.replaceNode)) {
        ssrWrappedNodes.add(binding.replaceNode);
        const parentNode = binding.replaceNode.parentNode;
        if (parentNode) {
            const path = binding.statePathName;
            const startComment = document.createComment(`@@wcs-text-start:${path}`);
            const endComment = document.createComment(`@@wcs-text-end:${path}`);
            parentNode.insertBefore(startComment, binding.replaceNode);
            parentNode.insertBefore(endComment, binding.replaceNode.nextSibling);
        }
    }
}

function applyChangeToWebComponent(binding, _context, newValue) {
    const element = binding.node;
    const propSegments = binding.propSegments;
    if (propSegments.length <= 1) {
        raiseError(`Invalid propSegments for web component binding: ${propSegments.join(".")}`);
    }
    const [firstSegment, ...restSegments] = propSegments;
    const subObject = element[firstSegment];
    if (typeof subObject === "undefined") {
        raiseError(`Property "${firstSegment}" not found on web component.`);
    }
    subObject[restSegments.join(".")] = newValue;
}

// indexName ... $1, $2, ...
function getIndexValueByLoopContext(loopContext, indexName) {
    if (loopContext.listIndex === null) {
        raiseError(`ListIndex not found for loopContext:`);
    }
    const indexPos = INDEX_BY_INDEX_NAME[indexName];
    if (typeof indexPos === "undefined") {
        raiseError(`Invalid index name: ${indexName}`);
    }
    const listIndex = loopContext.listIndex.at(indexPos);
    if (listIndex === null) {
        raiseError(`Index not found at position ${indexPos} for loopContext:`);
    }
    return listIndex.index;
}

function getValue(state, binding) {
    const stateAddress = getStateAddressByBindingInfo(binding);
    if (stateAddress.pathInfo.path in INDEX_BY_INDEX_NAME) {
        const loopContext = getLoopContextByNode(binding.node);
        if (loopContext === null) {
            raiseError(`ListIndex not found for binding: ${binding.statePathName}`);
        }
        return getIndexValueByLoopContext(loopContext, stateAddress.pathInfo.path);
    }
    else {
        return state[getByAddressSymbol](stateAddress);
    }
}

const scheduledBindings = new WeakSet();
function reportFailure(tagName, error) {
    console.error(`[@wcstack/state] deferred apply failed for <${tagName}>.`, error);
}
function scheduleDeferredApply(binding, tagName) {
    if (scheduledBindings.has(binding))
        return;
    scheduledBindings.add(binding);
    const applyLatest = () => {
        scheduledBindings.delete(binding);
        const currentSession = getBindingSession(binding);
        if (currentSession !== null && !currentSession.shouldApplyState(binding)) {
            return;
        }
        applyChangeFromBindings([binding]);
    };
    const reject = (error) => {
        scheduledBindings.delete(binding);
        reportFailure(tagName, error);
    };
    const session = getBindingSession(binding);
    if (session !== null) {
        const cancel = session.deferUntilDefined(binding.replaceNode, tagName, applyLatest, reject);
        if (!session.addTeardown(binding, () => {
            scheduledBindings.delete(binding);
            cancel();
        })) {
            scheduledBindings.delete(binding);
            cancel();
        }
        return;
    }
    // Compatibility fallback for direct applyChange() callers outside a session.
    const registry = getCustomElementRegistry();
    if (registry === null) {
        scheduledBindings.delete(binding);
        reportFailure(tagName, new Error("CustomElementRegistry is unavailable."));
        return;
    }
    getDefinitionCoordinator(registry).wait(tagName, () => {
        if (!binding.replaceNode.isConnected) {
            scheduledBindings.delete(binding);
            return;
        }
        applyLatest();
    }, reject);
}

const applyChangeByFirstSegment = {
    "class": applyChangeToClass,
    "attr": applyChangeToAttribute,
    "style": applyChangeToStyle,
    "command": applyChangeToCommand,
};
const applyChangeByBindingType = {
    "text": applyChangeToText,
    "for": applyChangeToFor,
    "if": applyChangeToIf,
    "else": applyChangeToIf,
    "elseif": applyChangeToIf,
    "radio": applyChangeToRadio,
    "checkbox": applyChangeToCheckbox,
};
const fnByBinding = new WeakMap();
const deferredSelectBindingByBinding = new WeakMap();
// 未 define カスタム要素チェックの確定メモ。customTag が無い、または define 済みを
// 一度確認したら以後は不変（define は不可逆）なので apply 毎の getCustomElement /
// registry 照会を省略できる。scoped registry を導入する場合はこの不可逆前提を再検討。
const definedApplyVerifiedByBinding = new WeakMap();
function _applyChange(binding, context) {
    const value = getValue(context.state, binding);
    const filteredValue = getFilteredValue(value, binding.outFilters);
    if (deferredSelectBindingByBinding.get(binding) === true) {
        context.deferredSelectBindings.push({ binding, value: filteredValue });
        return;
    }
    let fn = fnByBinding.get(binding);
    if (typeof fn !== 'undefined') {
        fn(binding, context, filteredValue);
        return;
    }
    if (fnByBinding.has(binding)) {
        if (isWebComponentComplete(binding.replaceNode, context.stateElement)) {
            fn = applyChangeToWebComponent;
            fnByBinding.set(binding, fn); // 確定したのでキャッシュ
        }
        else {
            fn = applyChangeToProperty;
        }
        fn(binding, context, filteredValue);
        return;
    }
    fn = applyChangeByBindingType[binding.bindingType];
    if (typeof fn === 'undefined') {
        const firstSegment = binding.propSegments[0];
        fn = applyChangeByFirstSegment[firstSegment];
        fnByBinding.set(binding, fn);
        if (typeof fn === 'undefined') {
            const customTag = getCustomElement(binding.replaceNode);
            if (customTag) {
                if (isWebComponentComplete(binding.replaceNode, context.stateElement)) {
                    fn = applyChangeToWebComponent;
                    fnByBinding.set(binding, fn); // 確定したのでキャッシュ
                }
                else {
                    fn = applyChangeToProperty;
                }
            }
            else {
                fn = applyChangeToProperty;
                fnByBinding.set(binding, fn);
            }
        }
    }
    if (fn === applyChangeToProperty) {
        const element = binding.node;
        if (element.tagName === 'SELECT') {
            const propName = binding.propSegments[0];
            if (propName === 'value' || propName === 'selectedIndex') {
                context.deferredSelectBindings.push({ binding, value: filteredValue });
                deferredSelectBindingByBinding.set(binding, true);
                return;
            }
        }
    }
    fn(binding, context, filteredValue);
}
function applyChange(binding, context) {
    if (context.appliedBindingSet.has(binding)) {
        return;
    }
    context.appliedBindingSet.add(binding);
    // $updatedCallback が定義されていない state では、更新アドレスの集計自体が
    // 不要（drain 終端の呼び出しごと省略される）。大量バインディング適用時の
    // Set 蓄積を避ける。undefined（テスト用モック等）は従来通り集計する。
    if (context.stateElement.hasUpdatedCallback !== false) {
        const absAddress = getAbsoluteStateAddressByBinding(binding);
        if (context.updatedAbsAddressSetByStateElement.has(context.stateElement)) {
            const addressSet = context.updatedAbsAddressSetByStateElement.get(context.stateElement);
            addressSet.add(absAddress);
        }
        else {
            context.updatedAbsAddressSetByStateElement.set(context.stateElement, new Set([
                absAddress
            ]));
        }
    }
    const bindingSession = getBindingSession(binding);
    if (bindingSession !== null && !bindingSession.shouldApplyState(binding)) {
        return;
    }
    if (binding.bindingType === "event") {
        return;
    }
    if (definedApplyVerifiedByBinding.get(binding) !== true) {
        const customTag = getCustomElement(binding.replaceNode);
        if (customTag) {
            if (getCustomElementRegistry()?.get(customTag) === undefined) {
                // 未 define のカスタム要素へは今は適用できない（accessor 未確立の要素に
                // 素の own property を書くと upgrade 後に class accessor を隠してしまう）。
                // whenDefined 後に最新 state 値で再適用する（two-way attach / deferred
                // spread と対称。docs/state-binding-init-races.md §2）。
                scheduleDeferredApply(binding, customTag);
                return;
            }
        }
        // customTag 無し or define 済み確定 → 以後この検査を省略（不可逆）
        definedApplyVerifiedByBinding.set(binding, true);
    }
    // applyChangeFromBindings のグループ化ループが解決済みルートの一致を検証済みの
    // 場合、stateName さえ一致すれば getRootNode の再解決（native 呼び出し）を省略
    // できる。activateContent 経由（フラグメント内の新規 content）も、フラグメントは
    // setRootNodeByFragment で context.rootNode に解決されるため同じ不変条件が成り立つ。
    if (context.sameRootVerified === true && binding.stateName === context.stateName) {
        _applyChange(binding, context);
        return;
    }
    let rootNode = binding.replaceNode.getRootNode();
    if (rootNode instanceof DocumentFragment && !(rootNode instanceof ShadowRoot)) {
        rootNode = getRootNodeByFragment(rootNode);
        if (rootNode === null) {
            raiseError(`Root node for fragment not found for binding.`);
        }
    }
    if (binding.stateName !== context.stateName || rootNode !== context.rootNode) {
        const stateElement = getStateElementByName(rootNode, binding.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${binding.stateName}" not found for binding.`);
        }
        stateElement.createState("readonly", (targetState) => {
            const newContext = {
                stateName: binding.stateName,
                rootNode: rootNode,
                stateElement: stateElement,
                state: targetState,
                appliedBindingSet: context.appliedBindingSet,
                newListValueByAbsAddress: context.newListValueByAbsAddress,
                updatedAbsAddressSetByStateElement: context.updatedAbsAddressSetByStateElement,
                deferredSelectBindings: context.deferredSelectBindings,
            };
            _applyChange(binding, newContext);
        });
    }
    else {
        _applyChange(binding, context);
    }
}

/**
 * バインディング情報の配列を処理し、各バインディングに対して状態の変更を適用する。
 *
 * 2フェーズで処理:
 * Phase 1: 構造的更新(for/if) + 値更新(select以外) — select.value/selectedIndex は遅延収集
 * Phase 2: 遅延されたselect.value/selectedIndex を適用（option要素の生成後）
 *
 * 最適化のため、以下のグループ化を行う:
 * 同じ stateNameとrootNode を持つバインディングをグループ化 → createState の呼び出しを削減
 */
function applyChangeFromBindings(bindings, propagationContextByBinding) {
    let bindingIndex = 0;
    const appliedBindingSet = new Set();
    const newListValueByAbsAddress = new Map();
    const updatedAbsAddressSetByStateElement = new Map();
    const deferredSelectBindings = [];
    // Phase 1: 構造的更新 + 値更新（select.value/selectedIndex は遅延）
    while (bindingIndex < bindings.length) {
        let binding = bindings[bindingIndex];
        const stateName = binding.stateName;
        if (binding.replaceNode.isConnected === false) {
            // 切断されているバインディングは無視、本来は事前に除去されているはず
            if (config.debug) {
                console.log(`applyChangeFromBindings: skip disconnected binding: ${binding.bindingType} ${binding.statePathName} on ${binding.node.nodeName}`, binding);
            }
            bindingIndex++;
            continue;
        }
        let rootNode = binding.replaceNode.getRootNode();
        if (rootNode instanceof DocumentFragment && !(rootNode instanceof ShadowRoot)) {
            rootNode = getRootNodeByFragment(rootNode);
            if (rootNode === null) {
                raiseError(`Root node for fragment not found for binding.`);
            }
        }
        const stateElement = getStateElementByName(rootNode, stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${stateName}" not found for binding.`);
        }
        stateElement.createState("readonly", (state) => {
            const context = {
                rootNode: rootNode,
                stateName: stateName,
                stateElement: stateElement,
                state: state,
                appliedBindingSet: appliedBindingSet,
                newListValueByAbsAddress: newListValueByAbsAddress,
                updatedAbsAddressSetByStateElement: updatedAbsAddressSetByStateElement,
                deferredSelectBindings: deferredSelectBindings,
                // グループ内の binding は下の do/while が「解決済みルート === rootNode」を
                // 検証してから applyChange に渡す（applyChange 側の getRootNode 省略の根拠）
                sameRootVerified: true,
                propagationContextByBinding: propagationContextByBinding,
            };
            do {
                applyChange(binding, context);
                bindingIndex++;
                const nextBindingInfo = bindings[bindingIndex];
                if (!nextBindingInfo)
                    break; // 終端に到達
                const nextRootNode = nextBindingInfo.replaceNode.getRootNode();
                if (nextBindingInfo.stateName !== stateName || nextRootNode !== context.rootNode)
                    break; // stateName が変わった
                binding = nextBindingInfo;
            } while (true); // eslint-disable-line no-constant-condition
        });
    }
    // Phase 2: 遅延されたselect.value/selectedIndex を適用
    // applyChangeToProperty は propagationContextByBinding 以外の context を
    // 参照しないため、遅延分は最小 context を渡す
    for (const { binding, value } of deferredSelectBindings) {
        applyChangeToProperty(binding, { propagationContextByBinding }, value);
    }
    for (const [absAddress, newListValue] of newListValueByAbsAddress.entries()) {
        setLastListValueByAbsoluteStateAddress(absAddress, newListValue);
    }
    for (const [stateElement, absAddressSet] of updatedAbsAddressSetByStateElement.entries()) {
        stateElement.createState("writable", (state) => {
            state[updatedCallbackSymbol](Array.from(absAddressSet));
        });
    }
}

function scheduleDeferredSpreads(deferredSpreads, parentLoopContext, session) {
    for (const entry of deferredSpreads) {
        session.deferUntilDefined(entry.node, entry.tagName, () => {
            const bindings = processDeferredNode(entry);
            if (bindings.length === 0)
                return;
            setLoopContextByNode(entry.node, parentLoopContext);
            const initialized = session.initialize(bindings);
            applyChangeFromBindings(initialized);
        }, (error) => {
            console.error(`[@wcstack/state] deferred spread failed for <${entry.tagName}>.`, error);
        });
    }
}
function initializeBindings(root, parentLoopContext) {
    const [subscriberNodes, allBindings, deferredSpreads] = collectNodesAndBindingInfos(root);
    const session = getOrCreateBindingSession(root);
    for (const node of subscriberNodes) {
        setLoopContextByNode(node, parentLoopContext);
    }
    const initialized = session.initialize(allBindings);
    applyChangeFromBindings(initialized);
    scheduleDeferredSpreads(deferredSpreads, parentLoopContext, session);
}
function initializeBindingsByFragment(root, nodeInfos) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
    const session = new BindingSession();
    // knownRoot=null: detached fragment 上の初期化。observableRootFor が必ず null を
    // 返す（observe は no-op）ため、binding ごとの getRootNode を省略する
    const initialized = session.initialize(allBindings, {
        registerAddress: false,
        applyOnReconnect: false,
    }, null);
    return {
        nodes: subscriberNodes,
        bindingInfos: initialized,
        bindingSession: session,
    };
}
/**
 * RowPlan 経路の行初期化（createContent 専用）。remember / spread 展開 /
 * shouldApplyState フィルタを経ず、プランのスロットから直接 record を構築する。
 * 返す session は従来経路と同じ活性化（activate）・破棄（dispose/wholesale）
 * インターフェースを持つ。
 */
function initializeRowBindings(plan, bindings) {
    const session = new BindingSession();
    session.initializeRow(plan, bindings);
    return session;
}

const MUSTACHE_REGEX = /\{\{\s*(.+?)\s*\}\}/g;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE"]);
function convertMustacheToComments(root) {
    if (!config.enableMustache) {
        return;
    }
    convertTextNodes(root);
    const templates = Array.from(root.querySelectorAll("template"));
    for (const template of templates) {
        if (template.namespaceURI === SVG_NAMESPACE) {
            const newTemplate = document.createElement("template");
            const childNodes = Array.from(template.childNodes);
            for (let i = 0; i < childNodes.length; i++) {
                const childNode = childNodes[i];
                newTemplate.content.appendChild(childNode);
            }
            for (const attr of template.attributes) {
                newTemplate.setAttribute(attr.name, attr.value);
            }
            template.replaceWith(newTemplate);
            convertMustacheToComments(newTemplate.content);
        }
        else {
            convertMustacheToComments(template.content);
        }
    }
}
function convertTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }
    for (const textNode of textNodes) {
        if (textNode.parentElement && SKIP_TAGS.has(textNode.parentElement.tagName)) {
            continue;
        }
        replaceTextNode(textNode);
    }
}
function replaceTextNode(textNode) {
    const text = textNode.data;
    MUSTACHE_REGEX.lastIndex = 0;
    if (!MUSTACHE_REGEX.test(text)) {
        return;
    }
    MUSTACHE_REGEX.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = MUSTACHE_REGEX.exec(text)) !== null) {
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const bindText = match[1];
        fragment.appendChild(document.createComment(`@@: ${bindText}`));
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode.replaceChild(fragment, textNode);
}

let _notFilterInfo = undefined;
function createNotFilter() {
    if (_notFilterInfo) {
        return _notFilterInfo;
    }
    const filterName = "not";
    const args = [];
    const filterFn = builtinFilterFn(filterName, args)(outputBuiltinFilters);
    _notFilterInfo = {
        filterName,
        args,
        filterFn,
    };
    return _notFilterInfo;
}

const COMMENT_REGEX = /^(\s*@@\s*(?:.*?)\s*:\s*)(.+?)(\s*)$/;
function expandShorthandInStatePart(statePart, forPath) {
    const prefix = forPath + DELIMITER + WILDCARD;
    const pipeIndex = statePart.indexOf('|');
    const atIndex = statePart.indexOf('@');
    let pathPart;
    let suffix;
    if (pipeIndex !== -1) {
        pathPart = statePart.slice(0, pipeIndex).trim();
        suffix = statePart.slice(pipeIndex);
    }
    else if (atIndex !== -1) {
        pathPart = statePart.slice(0, atIndex).trim();
        suffix = statePart.slice(atIndex);
    }
    else {
        pathPart = statePart.trim();
        suffix = '';
    }
    if (pathPart === '.') {
        pathPart = prefix;
    }
    else if (pathPart.startsWith('.')) {
        pathPart = prefix + DELIMITER + pathPart.slice(1);
    }
    else {
        return statePart;
    }
    if (suffix.length > 0) {
        return pathPart + suffix;
    }
    return pathPart;
}
function expandCommentData(data, forPath) {
    const match = COMMENT_REGEX.exec(data);
    if (match === null) {
        return data;
    }
    const commentPrefix = match[1];
    const bindText = match[2];
    const commentSuffix = match[3];
    const expanded = expandShorthandInStatePart(bindText, forPath);
    return commentPrefix + expanded + commentSuffix;
}
function expandBindAttribute(attrValue, forPath) {
    const parts = attrValue.split(';');
    let changed = false;
    const result = parts.map(part => {
        const trimmed = part.trim();
        if (trimmed.length === 0)
            return part;
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1)
            return part;
        const propPart = trimmed.slice(0, colonIndex).trim();
        const statePart = trimmed.slice(colonIndex + 1).trim();
        const expanded = expandShorthandInStatePart(statePart, forPath);
        if (expanded !== statePart) {
            changed = true;
            return `${propPart}: ${expanded}`;
        }
        return part;
    });
    if (!changed)
        return attrValue;
    return result.join(';');
}
function expandShorthandInBindAttribute(attrValue, forPath) {
    return expandBindAttribute(attrValue, forPath);
}
function expandShorthandPaths(root, forPath) {
    const bindAttr = config.bindAttributeName;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeType === Node.COMMENT_NODE) {
            const comment = node;
            comment.data = expandCommentData(comment.data, forPath);
            continue;
        }
        const element = node;
        if (element instanceof HTMLTemplateElement) {
            continue;
        }
        const attr = element.getAttribute(bindAttr);
        if (attr !== null) {
            const expanded = expandBindAttribute(attr, forPath);
            if (expanded !== attr) {
                element.setAttribute(bindAttr, expanded);
            }
        }
    }
}

function getNodePath(node) {
    let currentNode = node;
    const path = [];
    while (currentNode.parentNode !== null) {
        const nodes = Array.from(currentNode.parentNode.childNodes);
        const index = nodes.indexOf(currentNode);
        path.unshift(index);
        currentNode = currentNode.parentNode;
    }
    return path;
}

function getFragmentNodeInfos(fragment) {
    const fragmnentNodeInfos = [];
    const subscriberNodes = getSubscriberNodes(fragment);
    for (const subscriberNode of subscriberNodes) {
        const parseBindingTextResults = getParseBindTextResults(subscriberNode);
        let node = subscriberNode;
        // テンプレート登録時の事前正規化: text 専用の wcs-text コメントは、この時点で
        // 空 Text に置き換えておく。行 clone は最初から Text を持ち、getBindingInfos が
        // その Text を replaceNode に使うため、行ごとの createTextNode と start() 時の
        // replaceChild（コメント→Text 差し替え）が丸ごと不要になる。
        // 置換は同じ位置なので nodePath は不変。wcs-for/if 等の構造コメントは
        // アンカーとしてコメントのまま維持する（bindingType で判別）。
        // 非フラグメント経路（実 DOM 上のコメント）は従来どおり実行時に差し替える。
        if (subscriberNode.nodeType === Node.COMMENT_NODE
            && parseBindingTextResults.length === 1
            && parseBindingTextResults[0].bindingType === "text"
            && subscriberNode.parentNode !== null) {
            const textNode = document.createTextNode("");
            subscriberNode.parentNode.replaceChild(textNode, subscriberNode);
            node = textNode;
        }
        fragmnentNodeInfos.push({
            nodePath: getNodePath(node),
            parseBindTextResults: parseBindingTextResults,
        });
    }
    return fragmnentNodeInfos;
}

function optimizeFragment(fragment) {
    const childNodes = Array.from(fragment.childNodes);
    for (const childNode of childNodes) {
        if (childNode.nodeType === Node.TEXT_NODE) {
            const textContent = childNode.textContent || '';
            if (textContent.trim() === '') {
                // Remove empty text nodes
                fragment.removeChild(childNode);
            }
        }
    }
}

const keywordByBindingType = new Map([
    ["for", config.commentForPrefix],
    ["if", config.commentIfPrefix],
    ["elseif", config.commentElseIfPrefix],
    ["else", config.commentElsePrefix],
]);
const notFilter = createNotFilter();
function cloneNotParseBindTextResult(bindingType, parseBindTextResult) {
    const filters = parseBindTextResult.outFilters;
    return {
        ...parseBindTextResult,
        outFilters: [...filters, notFilter],
        bindingType: bindingType,
    };
}
function _getFragmentInfo(rootNode, fragment, parseBindingTextResult, forPath) {
    optimizeFragment(fragment);
    if (typeof forPath === "string") {
        expandShorthandPaths(fragment, forPath);
    }
    collectStructuralFragments(rootNode, fragment, forPath);
    // after replacing and collect node infos on child fragment
    const fragmentInfo = {
        fragment: fragment,
        parseBindTextResult: parseBindingTextResult,
        nodeInfos: getFragmentNodeInfos(fragment),
    };
    return fragmentInfo;
}
function collectStructuralFragments(rootNode, walkRoot, forPath) {
    const elseKeyword = config.commentElsePrefix;
    const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
            const element = node;
            if (element.tagName.toLowerCase() === 'template') {
                const bindText = element.getAttribute(config.bindAttributeName) || '';
                if (bindText.length > 0) {
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
            return NodeFilter.FILTER_SKIP;
        }
    });
    let lastIfFragmentInfo = null; // for elseif chaining
    const elseFragmentInfos = []; // for elseif chaining
    const templates = [];
    while (walker.nextNode()) {
        const template = walker.currentNode;
        templates.push(template);
    }
    for (const template of templates) {
        let bindText = template.getAttribute(config.bindAttributeName) || '';
        if (typeof forPath === "string") {
            bindText = expandShorthandInBindAttribute(bindText, forPath);
        }
        const parseBindTextResults = parseBindTextsForElement(bindText);
        let parseBindTextResult = parseBindTextResults[0];
        const keyword = keywordByBindingType.get(parseBindTextResult.bindingType);
        if (typeof keyword === 'undefined') {
            continue;
        }
        const bindingType = parseBindTextResult.bindingType;
        const fragment = template.content;
        const uuid = getUUID();
        let fragmentInfo = null;
        // Determine childForPath for shorthand expansion
        const childForPath = bindingType === "for"
            ? parseBindTextResult.statePathName
            : forPath;
        if (bindingType === "else") {
            // check last 'if' or 'elseif' fragment info
            if (lastIfFragmentInfo === null) {
                raiseError(`'else' binding found without preceding 'if' or 'elseif' binding.`);
            }
            // else condition
            parseBindTextResult = cloneNotParseBindTextResult("else", lastIfFragmentInfo.parseBindTextResult);
            fragmentInfo = _getFragmentInfo(rootNode, fragment, parseBindTextResult, childForPath);
            setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);
            const lastElseFragmentInfo = elseFragmentInfos.at(-1);
            const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
            if (typeof lastElseFragmentInfo !== "undefined") {
                template.remove();
                lastElseFragmentInfo.fragment.appendChild(placeHolder);
                lastElseFragmentInfo.nodeInfos.push({
                    nodePath: getNodePath(placeHolder),
                    parseBindTextResults: getParseBindTextResults(placeHolder),
                });
            }
            else {
                template.replaceWith(placeHolder);
            }
        }
        else if (bindingType === "elseif") {
            // check last 'if' or 'elseif' fragment info
            if (lastIfFragmentInfo === null) {
                raiseError(`'elseif' binding found without preceding 'if' or 'elseif' binding.`);
            }
            fragmentInfo = _getFragmentInfo(rootNode, fragment, parseBindTextResult, childForPath);
            setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);
            const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
            // create else fragment
            const elseUUID = getUUID();
            const elseFragmentInfo = {
                fragment: document.createDocumentFragment(),
                parseBindTextResult: cloneNotParseBindTextResult("else", lastIfFragmentInfo.parseBindTextResult),
                nodeInfos: [],
            };
            elseFragmentInfo.fragment.appendChild(placeHolder);
            elseFragmentInfo.nodeInfos.push({
                nodePath: getNodePath(placeHolder),
                parseBindTextResults: getParseBindTextResults(placeHolder),
            });
            setFragmentInfoByUUID(elseUUID, rootNode, elseFragmentInfo);
            const lastElseFragmentInfo = elseFragmentInfos.at(-1);
            elseFragmentInfos.push(elseFragmentInfo);
            const elsePlaceHolder = document.createComment(`@@${elseKeyword}:${elseUUID}`);
            if (typeof lastElseFragmentInfo !== "undefined") {
                template.remove();
                lastElseFragmentInfo.fragment.appendChild(elsePlaceHolder);
                lastElseFragmentInfo.nodeInfos.push({
                    nodePath: getNodePath(elsePlaceHolder),
                    parseBindTextResults: getParseBindTextResults(elsePlaceHolder),
                });
            }
            else {
                template.replaceWith(elsePlaceHolder);
            }
        }
        else {
            fragmentInfo = _getFragmentInfo(rootNode, fragment, parseBindTextResult, childForPath);
            setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);
            const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
            template.replaceWith(placeHolder);
        }
        // Update lastIfFragmentInfo for if/elseif/else chaining
        if (bindingType === "if") {
            elseFragmentInfos.length = 0; // start new if chain
            lastIfFragmentInfo = fragmentInfo;
        }
        else if (bindingType === "elseif") {
            lastIfFragmentInfo = fragmentInfo;
        }
        else if (bindingType === "else") {
            lastIfFragmentInfo = null;
            elseFragmentInfos.length = 0; // end if chain
        }
    }
}

async function waitForStateInitialize(root) {
    const elements = root.querySelectorAll(config.tagNames.state);
    const promises = [];
    await customElements.whenDefined(config.tagNames.state);
    for (const element of elements) {
        const stateElement = element;
        promises.push(stateElement.initializePromise);
    }
    await Promise.all(promises);
}

async function buildBindings(root) {
    if (root === document) {
        // document配下のwcs-stateの初期化(connectedCallbackの完了)を待機する
        await waitForStateInitialize(document);
        // baindingを取得して、初期値をセットする
        convertMustacheToComments(document);
        collectStructuralFragments(document, document);
        initializeBindings(document.body, null);
    }
    else {
        const shadowRoot = root;
        if (shadowRoot.host.hasAttribute(config.bindAttributeName)) {
            // data-wcsを持つWebComponentは、WebComponentのbindingが完了するまで待機する。
            await waitInitializeBinding(shadowRoot.host);
        }
        // shadowRoot配下のwcs-stateの初期化(connectedCallbackの完了)を待機する
        await waitForStateInitialize(shadowRoot);
        // baindingを取得して、初期値をセットする
        convertMustacheToComments(shadowRoot);
        collectStructuralFragments(shadowRoot, shadowRoot);
        initializeBindings(shadowRoot, null);
    }
}

var version = "1.21.5";
var pkg = {
	version: version};

const VERSION = pkg.version;

/**
 * Browser builds use the native HTMLElement. Headless runtimes receive an
 * inert base so the public module can be imported without installing DOM
 * globals; constructing components remains a browser-only operation.
 */
const HTMLElementBase = (typeof HTMLElement === "undefined" ? class {
} : HTMLElement);

// SSR コメントパターン
const SSR_PLACEHOLDER_COMMENT = /^@@wcs-(?:for|if|elseif|else):[^-]/;
const SSR_BLOCK_START = /^@@wcs-(for|if|elseif|else)-start:(.+)$/;
const SSR_BLOCK_END = /^@@wcs-(for|if|elseif|else)-end:(.+)$/;
const SSR_TEXT_START = /^@@wcs-text-start:(.+)$/;
/**
 * script 要素へ埋め込む JSON を HTML パーサから保護する。
 * HTML 直列化時、script の中身は生のまま出力されるため、state 値に
 * "</script>" や "<!--" を含む文字列があると script を脱出できてしまう。
 * "<" ">" "&" と U+2028/U+2029 を JSON の \uXXXX エスケープへ置換する
 * (JSON.parse では元の文字列と等価に復元される)。
 */
function escapeJsonForScript(json) {
    return json
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
class Ssr extends HTMLElementBase {
    _stateData = null;
    _templates = null;
    _hydrateProps = null;
    get name() {
        return this.getAttribute('name') || 'default';
    }
    get version() {
        return this.getAttribute('version') || '';
    }
    get stateData() {
        if (this._stateData === null) {
            this._stateData = this._loadStateData();
        }
        return this._stateData;
    }
    get templates() {
        if (this._templates === null) {
            this._templates = this._loadTemplates();
        }
        return this._templates;
    }
    get hydrateProps() {
        if (this._hydrateProps === null) {
            this._hydrateProps = this._loadHydrateProps();
        }
        return this._hydrateProps;
    }
    getTemplate(uuid) {
        return this.templates.get(uuid) ?? null;
    }
    /**
     * サーバーの SSR バージョンとクライアントの state バージョンを検証する。
     * メジャー・マイナーバージョンが一致すればtrue。
     * version 属性がない場合は検証スキップ（true）。
     */
    verifyVersion() {
        const serverVersion = this.version;
        if (!serverVersion)
            return true;
        const serverParts = serverVersion.split('.');
        const clientParts = VERSION.split('.');
        // メジャー・マイナーが一致すれば互換
        return serverParts[0] === clientParts[0] && serverParts[1] === clientParts[1];
    }
    setStateData(data) {
        this._stateData = data;
    }
    setHydrateProps(props) {
        this._hydrateProps = props;
    }
    _loadStateData() {
        const script = this.querySelector(`script[type="application/json"]:not([data-wcs-ssr-props])`);
        if (!script)
            return {};
        try {
            return JSON.parse(script.textContent || '{}');
        }
        catch {
            return {};
        }
    }
    _loadTemplates() {
        const map = new Map();
        const templates = this.querySelectorAll('template[id]');
        for (const tpl of templates) {
            const id = tpl.getAttribute('id');
            if (id) {
                map.set(id, tpl);
            }
        }
        return map;
    }
    _loadHydrateProps() {
        const script = this.querySelector('script[data-wcs-ssr-props]');
        if (!script)
            return {};
        try {
            return JSON.parse(script.textContent || '{}');
        }
        catch {
            return {};
        }
    }
    static findByName(root, name) {
        const tagName = config.tagNames.ssr;
        const parentEl = root instanceof Element
            ? root
            : root instanceof Document
                ? root.documentElement
                : null;
        if (!parentEl)
            return null;
        const el = parentEl.querySelector(`${tagName}[name="${name}"]`);
        return el;
    }
    /**
     * stateData と構造テンプレート・プロパティから <wcs-ssr> の中身を構築する。
     * server パッケージの renderToString から呼ばれる。
     */
    /**
     * wcs-state 要素から $ プレフィックスや関数を除いたデータを抽出する。
     */
    static extractStateData(stateEl) {
        const raw = stateEl.__state;
        if (!raw || typeof raw !== 'object')
            return {};
        const data = {};
        for (const [key, value] of Object.entries(raw)) {
            if (!key.startsWith('$') && typeof value !== 'function') {
                data[key] = value;
            }
        }
        return data;
    }
    static buildContent(ssrEl, stateData) {
        // 初期データ JSON
        const jsonScript = document.createElement('script');
        jsonScript.setAttribute('type', 'application/json');
        jsonScript.textContent = escapeJsonForScript(JSON.stringify(stateData));
        ssrEl.appendChild(jsonScript);
        // UUID で管理されているテンプレートを復元して格納
        const uuids = getAllFragmentUUIDs();
        for (const uuid of uuids) {
            const fragmentInfo = getFragmentInfoByUUID(uuid);
            if (!fragmentInfo)
                continue;
            const tpl = document.createElement('template');
            tpl.setAttribute('id', uuid);
            const bindResult = fragmentInfo.parseBindTextResult;
            const bindText = bindResult.bindingType === 'else'
                ? 'else:'
                : `${bindResult.bindingType}: ${bindResult.statePathName}`;
            tpl.setAttribute(config.bindAttributeName, bindText);
            const content = fragmentInfo.fragment.cloneNode(true);
            tpl.content.appendChild(content);
            ssrEl.appendChild(tpl);
        }
        // 属性で代替不可なプロパティをハイドレーション用に格納
        const ssrNodes = getAllSsrPropertyNodes();
        if (ssrNodes.length > 0) {
            const propsData = {};
            for (let i = 0; i < ssrNodes.length; i++) {
                const node = ssrNodes[i];
                const entries = getSsrProperties(node);
                if (entries.length === 0)
                    continue;
                const id = `wcs-ssr-${i}`;
                node.setAttribute('data-wcs-ssr-id', id);
                const props = {};
                for (const entry of entries) {
                    props[entry.propName] = entry.value;
                }
                propsData[id] = props;
            }
            if (Object.keys(propsData).length > 0) {
                const propsScript = document.createElement('script');
                propsScript.setAttribute('type', 'application/json');
                propsScript.setAttribute('data-wcs-ssr-props', '');
                propsScript.textContent = escapeJsonForScript(JSON.stringify(propsData));
                ssrEl.appendChild(propsScript);
            }
        }
        clearSsrPropertyStore();
    }
    /**
     * SSR ブロック境界コメント (@@wcs-*-start/end) を除去する
     */
    static removeBlockBoundaryComments(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
        const toRemove = [];
        while (walker.nextNode()) {
            const comment = walker.currentNode;
            if (SSR_BLOCK_START.test(comment.data) || SSR_BLOCK_END.test(comment.data)) {
                toRemove.push(comment);
            }
        }
        for (const comment of toRemove) {
            comment.remove();
        }
    }
    /**
     * SSR の構造プレースホルダーコメント (@@wcs-for:uuid 等) を除去する
     */
    static removeStructuralComments(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
        const toRemove = [];
        while (walker.nextNode()) {
            const comment = walker.currentNode;
            if (SSR_PLACEHOLDER_COMMENT.test(comment.data)) {
                toRemove.push(comment);
            }
        }
        for (const comment of toRemove) {
            comment.remove();
        }
    }
    /**
     * SSR テキストバインディングコメントを復元する。
     * <!--@@wcs-text-start:path-->text<!--@@wcs-text-end:path-->
     * → <!--@@: path--> (バインディングシステムが認識する形式)
     */
    static restoreTextBindings(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
        const startComments = [];
        while (walker.nextNode()) {
            const comment = walker.currentNode;
            const match = SSR_TEXT_START.exec(comment.data);
            if (match) {
                startComments.push({ comment, path: match[1] });
            }
        }
        for (const { comment, path } of startComments) {
            const bindComment = document.createComment(`@@: ${path}`);
            comment.parentNode.insertBefore(bindComment, comment);
            let sibling = comment.nextSibling;
            comment.remove();
            const endPattern = `@@wcs-text-end:${path}`;
            while (sibling) {
                const next = sibling.nextSibling;
                if (sibling.nodeType === Node.COMMENT_NODE && sibling.data === endPattern) {
                    sibling.parentNode.removeChild(sibling);
                    break;
                }
                sibling.parentNode.removeChild(sibling);
                sibling = next;
            }
        }
    }
    /**
     * SSR DOM をクリーンアップし、buildBindings が動作できる状態に戻す。
     * バージョン不一致時のフォールバック用。
     *
     * 1. SSR ブロック境界コメント間のレンダリング済みノードを除去
     * 2. SSR テキストバインディングを @@: 形式に復元
     * 3. プレースホルダーコメントを <wcs-ssr> 内のテンプレートで差し替え
     * 4. data-wcs-ssr-id 属性を除去
     * 5. <wcs-ssr> を除去
     */
    static cleanupDom(root) {
        const body = document.body;
        // <wcs-ssr> からテンプレート UUID マップを構築（カスタム要素未定義でも動作するよう DOM 直接走査）
        const ssrElements = root.querySelectorAll(config.tagNames.ssr);
        const templateByUuid = new Map();
        for (const ssrNode of ssrElements) {
            const templates = ssrNode.querySelectorAll('template[id]');
            for (const tpl of templates) {
                const id = tpl.getAttribute('id');
                if (id) {
                    templateByUuid.set(id, tpl);
                }
            }
        }
        // SSR ブロック境界コメント間のレンダリング済みノードと境界コメントを除去
        const walker1 = document.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
        const startComments = [];
        while (walker1.nextNode()) {
            const comment = walker1.currentNode;
            if (SSR_BLOCK_START.test(comment.data)) {
                startComments.push(comment);
            }
        }
        for (const startComment of startComments) {
            const match = SSR_BLOCK_START.exec(startComment.data);
            const type = match[1];
            const info = match[2];
            const endPattern = `@@wcs-${type}-end:${info}`;
            let sibling = startComment.nextSibling;
            while (sibling) {
                const next = sibling.nextSibling;
                if (sibling.nodeType === Node.COMMENT_NODE && sibling.data === endPattern) {
                    sibling.remove();
                    break;
                }
                sibling.remove();
                sibling = next;
            }
            startComment.remove();
        }
        // SSR テキストバインディングを @@: 形式に復元
        Ssr.restoreTextBindings(body);
        // プレースホルダーコメント (@@wcs-for:uuid 等) をテンプレートに差し替え
        const walker2 = document.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
        const placeholders = [];
        while (walker2.nextNode()) {
            const comment = walker2.currentNode;
            if (SSR_PLACEHOLDER_COMMENT.test(comment.data)) {
                const uuid = comment.data.split(':')[1];
                placeholders.push({ comment, uuid });
            }
        }
        for (const { comment, uuid } of placeholders) {
            const tpl = templateByUuid.get(uuid);
            if (tpl) {
                const restored = document.createElement('template');
                const bindAttr = tpl.getAttribute(config.bindAttributeName);
                if (bindAttr)
                    restored.setAttribute(config.bindAttributeName, bindAttr);
                const imported = document.importNode(tpl.content, true);
                if (imported.childNodes.length > 0) {
                    restored.content.appendChild(imported);
                }
                else {
                    for (const child of Array.from(tpl.childNodes)) {
                        restored.content.appendChild(document.importNode(child, true));
                    }
                }
                comment.parentNode.replaceChild(restored, comment);
            }
        }
        // data-wcs-ssr-id 属性を除去
        const ssrIdElements = root.querySelectorAll('[data-wcs-ssr-id]');
        for (const el of ssrIdElements) {
            el.removeAttribute('data-wcs-ssr-id');
        }
        // <wcs-ssr> を除去
        for (const el of ssrElements) {
            el.remove();
        }
    }
}

// ハイドレーション時にスキップするバインディングタイプ
const STRUCTURAL_TYPES = new Set(['for', 'if', 'elseif', 'else']);
/**
 * SSR ブロック境界コメントを走査して、start〜end 間のノードを収集する
 */
function collectSsrBlocks(root) {
    const blocks = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const startComments = [];
    // まず全コメントを収集
    while (walker.nextNode()) {
        startComments.push(walker.currentNode);
    }
    for (const comment of startComments) {
        const startMatch = SSR_BLOCK_START.exec(comment.data);
        if (!startMatch)
            continue;
        const type = startMatch[1];
        const info = startMatch[2]; // "uuid:path:index" or "uuid:path"
        const parts = info.split(':');
        let uuid;
        let path;
        let index = null;
        if (type === 'for') {
            // uuid:path:index
            uuid = parts[0];
            path = parts[1];
            index = parseInt(parts[2], 10);
        }
        else {
            // uuid:path
            uuid = parts[0];
            path = parts.slice(1).join(':');
        }
        // start と end の間のノードを収集
        const nodes = [];
        let sibling = comment.nextSibling;
        const endPattern = `@@wcs-${type}-end:${info}`;
        while (sibling) {
            if (sibling.nodeType === Node.COMMENT_NODE && sibling.data === endPattern) {
                break;
            }
            nodes.push(sibling);
            sibling = sibling.nextSibling;
        }
        blocks.push({ type, uuid, path, index, nodes });
    }
    return blocks;
}
/**
 * live DOM ノード群からバインディングを収集する。
 * ノードを一時的に DocumentFragment に移動して collectNodesAndBindingInfos を実行し、
 * 元の位置に戻す。
 */
function collectBindingsFromLiveNodes(nodes) {
    const bindingSession = new BindingSession();
    if (nodes.length === 0) {
        return { bindingInfos: [], subscriberNodes: [], bindingSession };
    }
    // ノードの元の位置を記録
    const parent = nodes[0].parentNode;
    const nextSibling = nodes[nodes.length - 1].nextSibling;
    // 一時的に wrapper 要素に移動（collectNodesAndBindingInfos は Element を受け付ける）
    const wrapper = document.createElement('div');
    for (const node of nodes) {
        wrapper.appendChild(node);
    }
    // バインディング収集
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(wrapper);
    const bindingInfos = bindingSession.initialize(allBindings, {
        registerAddress: false,
        applyOnReconnect: false,
    });
    // 元の位置に戻す
    if (parent) {
        while (wrapper.firstChild) {
            parent.insertBefore(wrapper.firstChild, nextSibling);
        }
    }
    return {
        bindingInfos,
        subscriberNodes,
        bindingSession,
    };
}
/**
 * SSR ブロックの DOM ノードを Content 化し、バインディングを登録する。
 */
function hydrateBlocks(root, blocks) {
    // for ブロックの listIndex を UUID ごとに収集
    const listIndexesByUuid = new Map();
    for (const block of blocks) {
        if (block.nodes.length === 0)
            continue;
        const content = createContentFromNodes(block.nodes);
        // Content のバインディングを収集
        const { bindingInfos, subscriberNodes, bindingSession } = collectBindingsFromLiveNodes(block.nodes);
        setBindingSessionByContent(content, bindingSession);
        // Content 内のノードに data-wcs-completed を付与
        // （メインの collectNodesAndBindingInfos で重複登録されないようにする）
        for (const node of subscriberNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                node.setAttribute('data-wcs-completed', '');
            }
        }
        setBindingsByContent(content, bindingInfos);
        setNodesByContent(content, subscriberNodes);
        const indexBindings = [];
        for (const binding of bindingInfos) {
            if (binding.statePathName in INDEX_BY_INDEX_NAME) {
                indexBindings.push(binding);
            }
        }
        setIndexBindingsByContent(content, indexBindings);
        if (block.type === 'for' && block.index !== null) {
            const placeholderComment = findPlaceholderComment(root, 'for', block.uuid);
            if (placeholderComment) {
                const listIndex = createListIndex(null, block.index);
                hydrateSetContent(placeholderComment, listIndex, content);
                const lastNode = block.nodes[block.nodes.length - 1];
                hydrateSetLastNode(placeholderComment, lastNode);
                setContentByNode(placeholderComment, content);
                // ループコンテキストをバインドし、バインディングをアドレスに登録
                const pathInfo = getPathInfo(block.path + '.' + WILDCARD);
                const stateAddress = createStateAddress(pathInfo, listIndex);
                // ILoopContext は IStateAddress + listIndex なので、stateAddress をそのまま使う
                bindLoopContextToContent(content, stateAddress);
                bindingSession.initialize(bindingInfos, {
                    registerAddress: true,
                    registerPathInfo: false,
                    applyOnReconnect: false,
                });
                // listIndex を UUID ごとに収集（後で setListIndexesByList に渡す）
                let indexes = listIndexesByUuid.get(block.uuid);
                if (!indexes) {
                    indexes = [];
                    listIndexesByUuid.set(block.uuid, indexes);
                }
                indexes.push(listIndex);
            }
        }
        else {
            const placeholderComment = findPlaceholderComment(root, block.type, block.uuid);
            if (placeholderComment) {
                setContentByNode(placeholderComment, content);
                bindingSession.initialize(bindingInfos, {
                    registerAddress: true,
                    registerPathInfo: false,
                    applyOnReconnect: false,
                });
            }
        }
    }
    // for ブロックの listIndex を state のリスト値に紐づける
    for (const [uuid, indexes] of listIndexesByUuid) {
        const placeholderComment = findPlaceholderComment(root, 'for', uuid);
        if (!placeholderComment)
            continue;
        // state から現在のリスト値を取得して listIndexes を設定
        const rootNode = placeholderComment.getRootNode();
        // structuralBindings はまだ登録前なので、getParseBindTextResults を直接使う
        const fragmentInfo = getFragmentInfoByUUID(uuid);
        if (!fragmentInfo)
            continue;
        const stateName = fragmentInfo.parseBindTextResult.stateName;
        const statePathName = fragmentInfo.parseBindTextResult.statePathName;
        const stateElement = getStateElementByName(rootNode, stateName);
        if (!stateElement)
            continue;
        stateElement.createState("readonly", (state) => {
            const list = state[statePathName];
            if (Array.isArray(list)) {
                setListIndexesByList(list, indexes);
            }
        });
    }
}
function findPlaceholderComment(root, type, uuid) {
    const keywordMap = {
        'for': config.commentForPrefix,
        'if': config.commentIfPrefix,
        'elseif': config.commentElseIfPrefix,
        'else': config.commentElsePrefix,
    };
    const keyword = keywordMap[type];
    if (!keyword)
        return null;
    const pattern = `@@${keyword}:${uuid}`;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
        const comment = walker.currentNode;
        if (comment.data === pattern) {
            return comment;
        }
    }
    return null;
}
/**
 * <wcs-ssr> 内のテンプレートを fragmentInfoByUUID に復帰させる。
 */
function restoreFragments(root, ssrEl) {
    const rootNode = root;
    let lastIfParseResult = null;
    for (const [uuid, tpl] of ssrEl.templates) {
        const bindText = tpl.getAttribute(config.bindAttributeName) || '';
        const parseBindTextResults = parseBindTextsForElement(bindText);
        let parseBindTextResult = parseBindTextResults[0];
        const bindingType = parseBindTextResult.bindingType;
        // else: 直前の if 条件の not → 条件反転
        // elseif: 独自条件を持つが stateName は if から引き継ぐ
        if (bindingType === 'else' && lastIfParseResult) {
            parseBindTextResult = {
                ...lastIfParseResult,
                outFilters: [...lastIfParseResult.outFilters, createNotFilter()],
                bindingType: 'else',
            };
        }
        else if (bindingType === 'elseif' && lastIfParseResult) {
            parseBindTextResult = {
                ...parseBindTextResult,
                stateName: lastIfParseResult.stateName,
            };
        }
        // if chain の追跡
        if (bindingType === 'if') {
            lastIfParseResult = parseBindTextResult;
        }
        else if (bindingType === 'elseif') {
            lastIfParseResult = parseBindTextResult;
        }
        else if (bindingType === 'else') {
            lastIfParseResult = null;
        }
        const fragment = document.importNode(tpl.content, true);
        const forPath = bindingType === "for" ? parseBindTextResult.statePathName : undefined;
        optimizeFragment(fragment);
        if (typeof forPath === "string") {
            expandShorthandPaths(fragment, forPath);
        }
        collectStructuralFragments(rootNode, fragment, forPath);
        const fragmentInfo = {
            fragment,
            parseBindTextResult,
            nodeInfos: getFragmentNodeInfos(fragment),
        };
        setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);
    }
}
/**
 * SSR ハイドレーション用バインディング初期化。
 * バージョン不一致時は DOM をクリーンアップして false を返す
 * （呼び出し元で buildBindings にフォールバック）。
 */
async function hydrateBindings(root) {
    await waitForStateInitialize(root);
    // バージョン検証
    const ssrElements = root.querySelectorAll(config.tagNames.ssr);
    for (const ssrNode of ssrElements) {
        const ssrEl = ssrNode;
        if (!ssrEl.verifyVersion()) {
            console.warn(`[@wcstack/state] SSR version mismatch: server="${ssrEl.version}", client="${VERSION}". Falling back to full render.`);
            Ssr.cleanupDom(root);
            return false;
        }
    }
    // <wcs-ssr> からテンプレートを fragmentInfoByUUID に復帰
    for (const ssrNode of ssrElements) {
        restoreFragments(root, ssrNode);
    }
    // SSR ブロック境界コメントから既存 DOM を Content 化
    const blocks = collectSsrBlocks(document.body);
    hydrateBlocks(document.body, blocks);
    // ブロック境界コメント (start/end) を除去
    Ssr.removeBlockBoundaryComments(document.body);
    // <wcs-ssr> を一時除去（バインディング走査に含めない）
    const ssrParents = [];
    for (const el of ssrElements) {
        if (el.parentNode) {
            ssrParents.push({ el, parent: el.parentNode, next: el.nextSibling });
            el.remove();
        }
    }
    // 構造プレースホルダーコメント (@@wcs-for:uuid 等) は残す
    // → バインディング走査で拾われ、状態変化時の再レンダリングに使われる
    // SSR テキストバインディングを @@: 形式に復元
    Ssr.restoreTextBindings(document.body);
    // ノードとバインディングを収集
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(document.body);
    // 収集完了したノードに data-wcs-completed 属性を付与
    // for ブロック内ノード（hydrateBlocks で登録済み）にはループコンテキストをリセットしない
    for (const node of subscriberNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node;
            if (!el.hasAttribute('data-wcs-completed')) {
                setLoopContextByNode(node, null);
                el.setAttribute('data-wcs-completed', '');
            }
        }
        else {
            // コメントノード等
            setLoopContextByNode(node, null);
        }
    }
    // バインディングを構造系とそれ以外に分離
    const normalBindings = [];
    const structuralBindings = [];
    const bindingSession = getOrCreateBindingSession(document.body);
    const initializedBindings = bindingSession.initialize(allBindings);
    for (const binding of initializedBindings) {
        if (binding.bindingType === "event")
            continue;
        if (STRUCTURAL_TYPES.has(binding.bindingType)) {
            structuralBindings.push(binding);
        }
        else if (binding.statePathName.includes(WILDCARD)) {
            // for ブロック内のバインディング → Content のバインディングとして登録済み
            continue;
        }
        else {
            normalBindings.push(binding);
        }
    }
    // for バインディングの lastListValue を初期値として設定
    // （次回の状態変化時に差分計算の基準になる）
    for (const binding of structuralBindings) {
        if (binding.bindingType === 'for') {
            const absAddr = getAbsoluteStateAddressByBinding(binding);
            const rootNode = binding.replaceNode.getRootNode();
            const stateElement = getStateElementByName(rootNode, binding.stateName);
            if (stateElement) {
                stateElement.createState("readonly", (state) => {
                    const value = state[binding.statePathName];
                    if (Array.isArray(value)) {
                        setLastListValueByAbsoluteStateAddress(absAddr, value);
                    }
                });
            }
        }
    }
    // 通常バインディングのみ初回値適用（構造バインディングはSSR描画済み）
    applyChangeFromBindings(normalBindings);
    // <wcs-ssr> を元に戻す
    for (const { el, parent, next } of ssrParents) {
        parent.insertBefore(el, next);
    }
    // hydrateProps 復元
    const restoredSsrElements = root.querySelectorAll(config.tagNames.ssr);
    for (const ssrNode of restoredSsrElements) {
        const ssrEl = ssrNode;
        const props = ssrEl.hydrateProps;
        for (const [id, propMap] of Object.entries(props)) {
            const target = root.querySelector(`[data-wcs-ssr-id="${id}"]`);
            if (!target)
                continue;
            for (const [propName, value] of Object.entries(propMap)) {
                target[propName] = value;
            }
        }
    }
    // ハイドレーション中の重複登録防止用属性を除去
    const completedEls = root.querySelectorAll('[data-wcs-completed]');
    for (const el of completedEls) {
        el.removeAttribute('data-wcs-completed');
    }
    return true;
}

const stateElementByNameByNode = new WeakMap();
const bindingsReadyByNode = new WeakMap();
// devtools 用の列挙可能な登録簿（protocol §4.1 — 唯一の常時 ON 台帳）。
// サイズは <wcs-state> 要素数に拘束され、unregister（disconnectedCallback）で
// 必ず削除されるためリークしない。
const liveStateElements = new Set();
function getLiveStateElements() {
    return liveStateElements;
}
function getStateElementByName(rootNode, name) {
    let stateElementByName = stateElementByNameByNode.get(rootNode);
    if (!stateElementByName) {
        return null;
    }
    return stateElementByName.get(name) || null;
}
/**
 * 指定された rootNode のバインディング初期化が完了するまで待機する Promise を返す。
 */
function getBindingsReady(rootNode) {
    return bindingsReadyByNode.get(rootNode) ?? Promise.resolve();
}
function setStateElementByName(rootNode, name, element) {
    let stateElementByName = stateElementByNameByNode.get(rootNode);
    if (element === null) {
        // 削除の場合、Mapが存在しない場合は何もしない
        if (!stateElementByName) {
            return;
        }
        const removed = stateElementByName.get(name);
        stateElementByName.delete(name);
        if (stateElementByName.size === 0) {
            stateElementByNameByNode.delete(rootNode);
        }
        if (removed !== undefined) {
            liveStateElements.delete(removed);
            if (devtoolsSink !== null) {
                devtoolsSink({ type: "state:element-unregistered", name, rootNode, element: removed });
            }
        }
        if (config.debug) {
            console.debug(`State element unregistered: name="${name}"`);
        }
    }
    else {
        // 登録の場合
        if (!stateElementByName) {
            stateElementByName = new Map();
            stateElementByNameByNode.set(rootNode, stateElementByName);
            // 初めてルートノードに登録する場合
            // enable-ssr 属性があり、サーバーサイドでない場合はハイドレーション
            const enableSsr = !inSsr() && element.hasAttribute?.('enable-ssr');
            if (rootNode.constructor.name === 'HTMLDocument' || rootNode.constructor.name === 'Document') {
                const ready = new Promise((resolve) => {
                    queueMicrotask(async () => {
                        if (enableSsr) {
                            const success = await hydrateBindings(rootNode);
                            if (!success) {
                                await buildBindings(rootNode);
                            }
                        }
                        else {
                            await buildBindings(rootNode);
                        }
                        resolve();
                    });
                });
                bindingsReadyByNode.set(rootNode, ready);
            }
            else if (rootNode.constructor.name === 'ShadowRoot') {
                const ready = new Promise((resolve) => {
                    queueMicrotask(async () => {
                        await buildBindings(rootNode);
                        resolve();
                    });
                });
                bindingsReadyByNode.set(rootNode, ready);
            }
        }
        if (stateElementByName.has(name)) {
            raiseError(`State element with name "${name}" is already registered.`);
        }
        stateElementByName.set(name, element);
        liveStateElements.add(element);
        if (devtoolsSink !== null) {
            devtoolsSink({ type: "state:element-registered", name, rootNode, element });
        }
        if (config.debug) {
            console.debug(`State element registered: name="${name}"`, element);
        }
    }
}

const updateBatchListeners = new Set();
/**
 * drain 終了リスナーを登録する。
 */
function registerUpdateBatchListener(listener) {
    updateBatchListeners.add(listener);
}
/**
 * drain 終了リスナーを解除する（テスト間の分離用）。
 */
function unregisterUpdateBatchListener(listener) {
    updateBatchListeners.delete(listener);
}
/**
 * 全リスナーに drain のバッチを通知する。
 * リスナーの throw は握りつぶさない（内部バグの隠蔽防止）。
 * stream 側リスナーが entry ごとに自前で try/catch する契約（設計書 §3-2）。
 */
function notifyUpdateBatchListeners(batch) {
    for (const listener of updateBatchListeners) {
        listener(batch);
    }
}
class Updater {
    _queueUpdateRecords = [];
    constructor() {
    }
    enqueueAbsoluteAddress(absoluteAddress, context = null) {
        const requireStartProcess = this._queueUpdateRecords.length === 0;
        this._queueUpdateRecords.push({ absoluteAddress, context });
        if (requireStartProcess) {
            queueMicrotask(() => {
                const updateRecords = this._queueUpdateRecords;
                this._queueUpdateRecords = [];
                this._applyChange(updateRecords);
            });
        }
    }
    // テスト用に公開
    testApplyChange(absoluteAddresses, contexts) {
        this._applyChange(absoluteAddresses.map((absoluteAddress, index) => ({
            absoluteAddress,
            context: contexts?.[index] ?? null,
        })));
    }
    _applyChange(updateRecords) {
        // Note: AbsoluteStateAddress はキャッシュされているため、
        // 同一の (stateName, address) は同じインスタンスとなり、
        // Map / Set による重複排除が正しく機能する。
        // coalescing は last-write-wins: 同じ address は最後の update の
        // (値は state 側が既に保持) context をそのまま採用する（設計書 §4.1）。
        // visitedEdges の合成や synthetic transaction への置換は行わない。
        const contextByAbsoluteAddress = new Map();
        for (const record of updateRecords) {
            const previous = contextByAbsoluteAddress.get(record.absoluteAddress);
            if (devtoolsSink !== null
                && typeof previous !== "undefined" && previous !== null
                && record.context !== null
                && previous.transactionId !== record.context.transactionId) {
                devtoolsSink({
                    type: "propagation:coalesced",
                    absoluteAddress: record.absoluteAddress,
                    droppedTransactionId: previous.transactionId,
                    winnerTransactionId: record.context.transactionId,
                });
            }
            contextByAbsoluteAddress.set(record.absoluteAddress, record.context);
        }
        const processBindings = [];
        const propagationContextByBinding = new Map();
        for (const [absoluteAddress, context] of contextByAbsoluteAddress) {
            if (context !== null && context.hop >= MAX_PROPAGATION_HOPS) {
                // hop 上限超過: この transaction の未処理 record だけを quarantine する。
                // 既に適用した値は戻さず、updater から例外は投げない（設計書 §4 規則 6）。
                console.error(`[@wcstack/state] propagation hop limit exceeded; update record quarantined.`, {
                    path: absoluteAddress.absolutePathInfo.pathInfo.path,
                    stateName: absoluteAddress.absolutePathInfo.stateName,
                    transactionId: context.transactionId,
                    hop: context.hop,
                    maxHops: MAX_PROPAGATION_HOPS,
                });
                if (devtoolsSink !== null) {
                    devtoolsSink({
                        type: "propagation:hop-limit",
                        absoluteAddress,
                        transactionId: context.transactionId,
                        hop: context.hop,
                    });
                }
                continue;
            }
            // peek: バインディングの無いアドレス（リスト置換で enqueue される中間
            // アドレス等）に空エントリを生成・蓄積しない。エントリは単一 binding
            // （通常ケース）か Set（同一アドレスに 2 本以上）のどちらか。
            // 従来台帳 → パターン台帳（リスト行）の順で引く。
            const entry = peekBindingsForAddress(absoluteAddress);
            if (entry === undefined) {
                continue;
            }
            if (entry instanceof Set) {
                for (const binding of entry) {
                    if (binding.replaceNode.isConnected === false) {
                        // 切断されているバインディングは無視
                        continue;
                    }
                    processBindings.push(binding);
                    if (context !== null) {
                        propagationContextByBinding.set(binding, context);
                    }
                }
            }
            else if (entry.replaceNode.isConnected !== false) {
                processBindings.push(entry);
                if (context !== null) {
                    propagationContextByBinding.set(entry, context);
                }
            }
        }
        // context が無い場合は従来どおり 1 引数で呼ぶ（呼び出し契約の互換維持）
        if (propagationContextByBinding.size > 0) {
            applyChangeFromBindings(processBindings, propagationContextByBinding);
        }
        else {
            applyChangeFromBindings(processBindings);
        }
        // drain 終了フック: binding 適用後に dedup 済みバッチを通知する（設計書 §3-2）。
        // testApplyChange も同じ _applyChange を通るため、テストから同期に駆動できる。
        // quarantine された address も state 値は適用済みのため通知対象に含める。
        notifyUpdateBatchListeners(new Set(contextByAbsoluteAddress.keys()));
    }
}
const updater = new Updater();
function getUpdater() {
    return updater;
}

/**
 * devtools/types.ts
 *
 * DevTools Hook Protocol (docs/devtools-hook-protocol.md) の型定義。
 *
 * イベント payload はランタイム内部オブジェクト（IAbsoluteStateAddress /
 * IBindingInfo 等）への生参照を含む（同一 realm・オーバーレイ前提、protocol 原則 4）。
 * 消費者はこれらを変異してはならない。
 */
/** グローバル registry のプロパティ名 */
const DEVTOOLS_HOOK_GLOBAL = "__WCSTACK_DEVTOOLS_HOOK__";
/** プロトコル版。additive change では上げない（protocol §2） */
const DEVTOOLS_PROTOCOL_VERSION = 1;

/**
 * devtools/bridge.ts
 *
 * DevTools Hook Protocol (docs/devtools-hook-protocol.md) の state 側実装。
 *
 * - registry 最小実装: `globalThis.__WCSTACK_DEVTOOLS_HOOK__` を create-if-missing で
 *   確保する（ロード順非依存・先勝ち。devtools 側 client も同一仕様の実装を持つ）。
 * - source: この state モジュールコピーを 1 source として登録する。同一ページに
 *   コピーが複数あれば複数 source になる（正常系、protocol §5）。
 * - sink 切替: listener の有無に応じて registry が `_setSink` を呼び、ここで
 *   updater の drain リスナー登録/解除も連動させる（protocol §4.3）。
 */
/**
 * registry の最小実装（protocol §2）。30 行程度に抑え、振る舞いは
 * 「source/listener の管理と sink の配線」のみ。台帳・整形は devtools 側の責務。
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
            // 既登録 source をリプレイ（遅延アタッチの起点、protocol §6）
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
            console.warn(`[wcstack/state] devtools hook registry version mismatch: found ${existing.version}, expected ${DEVTOOLS_PROTOCOL_VERSION}. Keeping the existing registry (first-wins).`);
        }
        return existing;
    }
    const registry = createMinimalRegistry();
    globals[DEVTOOLS_HOOK_GLOBAL] = registry;
    return registry;
}
/**
 * drain 終了バッチの転送リスナー。sink 接続中のみ updater に登録される。
 */
const onUpdateBatch = (batch) => {
    if (devtoolsSink !== null) {
        devtoolsSink({ type: "state:update-batch", addresses: batch });
    }
};
/**
 * registry からの sink 差し替え。updater の drain リスナー登録/解除を連動させる。
 * detach 時に登録が残らないこと（protocol §7-2）。
 */
function setSink(sink) {
    const wasActive = devtoolsSink !== null;
    setDevtoolsSink(sink);
    const isActive = sink !== null;
    if (isActive && !wasActive) {
        registerUpdateBatchListener(onUpdateBatch);
    }
    else if (!isActive && wasActive) {
        unregisterUpdateBatchListener(onUpdateBatch);
    }
}
function createStateElementSummary(element) {
    return {
        name: element.name,
        rootNode: element.rootNode,
        element,
        paths: {
            list: element.listPaths,
            element: element.elementPaths,
            getter: element.getterPaths,
            setter: element.setterPaths,
        },
        commandTokenNames: element.commandTokenNames,
        eventTokenNames: element.eventTokenNames,
        staticDependency: element.staticDependency,
        dynamicDependency: element.dynamicDependency,
    };
}
function requireStateElement(name, rootNode) {
    return getStateElementByName(rootNode, name) ??
        raiseError(`devtools: state element not found: name="${name}"`);
}
function createSourceId() {
    // getUUID() はモジュールローカル連番のため、state コピーが複数ある
    // ページで source id が衝突する。ランダム採番で回避する。
    return "state:" + Math.random().toString(36).slice(2, 10);
}
let registeredSource = null;
/**
 * この state ランタイムを 1 source として registry に登録する。
 * bootstrapState() から呼ばれる。冪等・SSR では何もしない（protocol 原則 6）。
 */
function registerDevtoolsSource() {
    if (inSsr()) {
        return;
    }
    if (registeredSource !== null) {
        return;
    }
    const source = {
        id: createSourceId(),
        kind: "state",
        packageVersion: VERSION,
        getStateElements() {
            const summaries = [];
            for (const element of getLiveStateElements()) {
                summaries.push(createStateElementSummary(element));
            }
            return summaries;
        },
        keys(name, rootNode) {
            const element = requireStateElement(name, rootNode);
            const result = [];
            element.createState("readonly", (state) => {
                // Object.keys は Proxy の ownKeys 経由で target の own key を返す。
                // メソッド判別の typeof アクセスは getter を 1 回実行する副作用があるため、
                // ループ文脈依存で throw する getter は catch して「キーとしては存在する」
                // 側に倒す（値の表示可否は UI 側の責務）。
                for (const key of Object.keys(state)) {
                    if (key.includes("*") || key.startsWith("$")) {
                        continue;
                    }
                    try {
                        if (typeof state[key] === "function") {
                            continue;
                        }
                    }
                    catch {
                        // 読めない getter もキーとしては列挙する
                    }
                    result.push(key);
                }
            });
            return result;
        },
        read(name, rootNode, path, indexes) {
            const element = requireStateElement(name, rootNode);
            let result;
            element.createState("readonly", (state) => {
                result = state["$resolve"](path, indexes ?? []);
            });
            return result;
        },
        write(name, rootNode, path, value, indexes) {
            const element = requireStateElement(name, rootNode);
            element.createState("writable", (state) => {
                if (indexes !== undefined && indexes.length > 0) {
                    // Note: $resolve は value===undefined を「取得」と解釈するため、
                    // ワイルドカードパスへの undefined 書き込みは非サポート
                    // （spread undefined 規範と同じ側に倒す）
                    state["$resolve"](path, indexes, value);
                }
                else {
                    state[path] = value;
                }
            });
        },
        _setSink: setSink,
    };
    registeredSource = source;
    getOrCreateHookRegistry().register(source);
}

async function loadFromInnerScript(script, name) {
    let scriptModule = null;
    const uniq_comment = `\n//# sourceURL=${name}\n`;
    if (typeof URL.createObjectURL === 'function') {
        // Create a blob URL for the script and dynamically import it
        const blob = new Blob([script.text + uniq_comment], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        try {
            scriptModule = await import(url);
        }
        finally {
            // Clean up blob URL to prevent memory leak
            URL.revokeObjectURL(url);
        }
    }
    else {
        // Fallback: Base64 encoding method (for test environment)
        // Convert script to Base64 and import via data: URL
        const b64 = btoa(String.fromCodePoint(...new TextEncoder().encode(script.text + uniq_comment)));
        scriptModule = await import(`data:application/javascript;base64,${b64}`);
    }
    return (scriptModule && typeof scriptModule.default === 'object') ? scriptModule.default : {};
}

async function loadFromJsonFile(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            raiseError(`Failed to fetch JSON file: ${response.statusText}`);
        }
        const data = await response.json();
        return data;
    }
    catch (e) {
        console.error('Failed to load JSON file:', e);
        return {};
    }
}

async function loadFromScriptFile(url) {
    try {
        const module = await import(/* @vite-ignore */ url);
        return module.default || {};
    }
    catch (e) {
        raiseError(`Failed to load script file: ${e}`);
    }
}

function loadFromScriptJson(id) {
    const script = document.getElementById(id);
    if (script && script.type === 'application/json') {
        try {
            const data = JSON.parse(script.textContent || '{}');
            return data;
        }
        catch (e) {
            raiseError('Failed to parse JSON from script element:' + e);
        }
    }
    return {};
}

class LoopContextStack {
    _loopContextStack = Array(MAX_LOOP_DEPTH).fill(undefined);
    _length = 0;
    createLoopContext(elementStateAddress, callback) {
        if (elementStateAddress.listIndex === null) {
            raiseError(`Cannot create loop context for a state address that does not have a list index.`);
        }
        const loopContext = elementStateAddress;
        if (this._length >= MAX_LOOP_DEPTH) {
            raiseError(`Exceeded maximum loop context stack depth of ${MAX_LOOP_DEPTH}. Possible infinite loop.`);
        }
        const lastLoopContext = this._loopContextStack[this._length - 1];
        if (typeof lastLoopContext !== "undefined") {
            if (lastLoopContext.pathInfo.wildcardCount + 1 !== loopContext.pathInfo.wildcardCount) {
                raiseError(`Cannot push loop context for a list whose wildcard count is not exactly one more than the current active loop context.`);
            }
            // 
            const prevWildcardPathInfo = loopContext.pathInfo.wildcardPathInfos[loopContext.pathInfo.wildcardPathInfos.length - 2];
            if (lastLoopContext.pathInfo !== prevWildcardPathInfo) {
                raiseError(`Cannot push loop context for a list whose parent wildcard path info does not match the current active loop context.`);
            }
        }
        else {
            // With no active loop context the address must be self-contained: the
            // listIndex chain supplies one index per wildcard. Top-level lists
            // (wildcardCount 1) always satisfy this. A nested list re-rendered
            // directly (e.g. replaced via $resolve from outside the loop) also
            // satisfies it — the for binding's listIndex carries the full ancestor
            // chain.
            if (loopContext.listIndex.length !== loopContext.pathInfo.wildcardCount) {
                raiseError(`Cannot push loop context when there is no active loop context: the list index chain (length ${loopContext.listIndex.length}) does not cover the wildcard path (wildcard count ${loopContext.pathInfo.wildcardCount}).`);
            }
        }
        this._loopContextStack[this._length] = loopContext;
        this._length++;
        let retValue = void 0;
        try {
            retValue = callback(loopContext);
        }
        finally {
            if (retValue instanceof Promise) {
                retValue.finally(() => {
                    this._length--;
                    this._loopContextStack[this._length] = undefined;
                });
            }
            else {
                this._length--;
                this._loopContextStack[this._length] = undefined;
            }
        }
        return retValue;
    }
}
function createLoopContextStack() {
    return new LoopContextStack();
}

/**
 * `$commandTokens: ["a", "b", ...]` 配列宣言を解析し、宣言された名前群を Set で返す。
 *
 * 注入は行わず、proxy 側で `state.$command.<name>` として token を解決する設計。
 * （以前の実装は state 直下に各名前の getter を注入していたが、リアクティブ値との
 * 名前空間衝突を避け識別性を上げるため `$command` ネームスペース集約に切り替え。）
 *
 * 対応している宣言形式は **オブジェクトリテラル** のみ。
 * クラス本体に `static $commandTokens = [...]` を書く形式や、
 * クラスのプロトタイプ上の同名コマンドの検出は現状サポートしない。
 */
function processCommandTokensDeclaration(state) {
    const names = new Set();
    const declared = state[STATE_COMMAND_TOKENS_NAME];
    if (typeof declared === "undefined") {
        return names;
    }
    if (!Array.isArray(declared)) {
        raiseError(`${STATE_COMMAND_TOKENS_NAME} must be an array of strings.`);
    }
    for (const name of declared) {
        if (typeof name !== "string" || name.length === 0) {
            raiseError(`${STATE_COMMAND_TOKENS_NAME} entries must be non-empty strings.`);
        }
        if (name === STATE_COMMAND_NAMESPACE_NAME) {
            raiseError(`${STATE_COMMAND_TOKENS_NAME} entry "${name}" conflicts with the reserved namespace name "${STATE_COMMAND_NAMESPACE_NAME}".`);
        }
        if (names.has(name)) {
            raiseError(`${STATE_COMMAND_TOKENS_NAME} entry "${name}" is duplicated.`);
        }
        names.add(name);
    }
    return names;
}

const registryByStateElement$1 = new WeakMap();
function getOrCreateCommandToken(stateElement, name) {
    let registry = registryByStateElement$1.get(stateElement);
    if (typeof registry === "undefined") {
        registry = new Map();
        registryByStateElement$1.set(stateElement, registry);
    }
    let token = registry.get(name);
    if (typeof token === "undefined") {
        token = new CommandToken(name, stateElement.name);
        registry.set(name, token);
    }
    return token;
}
function clearCommandTokenRegistry(stateElement) {
    registryByStateElement$1.delete(stateElement);
}

/**
 * `state.$command` でアクセスされる command token の namespace proxy を提供する。
 *
 * - state element 単位で memo 化し、同一 stateElement なら同じ proxy が返る。
 * - 宣言された名前 (`$commandTokens` に列挙されたもの) のみ token を返す。
 *   宣言外の名前にアクセスした場合は undefined を返す。
 *   （`constructor` / `Symbol.toPrimitive` / `then` など内部システムが触るキーで
 *    例外を投げないため。typo は subsequent な `.emit()` 呼び出しで TypeError として
 *    間接的に表面化する。）
 * - token そのものの memo は `getOrCreateCommandToken` 側に集約されており、
 *   namespace proxy は薄いゲートウェイとして振る舞う。
 */
const namespaceProxyByStateElement = new WeakMap();
function getCommandNamespace(stateElement) {
    const cached = namespaceProxyByStateElement.get(stateElement);
    if (typeof cached !== "undefined") {
        return cached;
    }
    const proxy = new Proxy(Object.create(null), {
        get(_target, prop) {
            if (typeof prop !== "string") {
                return undefined;
            }
            if (!stateElement.commandTokenNames.has(prop)) {
                return undefined;
            }
            return getOrCreateCommandToken(stateElement, prop);
        },
        has(_target, prop) {
            return typeof prop === "string" && stateElement.commandTokenNames.has(prop);
        },
        ownKeys() {
            return Array.from(stateElement.commandTokenNames);
        },
        getOwnPropertyDescriptor(_target, prop) {
            if (typeof prop === "string" && stateElement.commandTokenNames.has(prop)) {
                return {
                    configurable: true,
                    enumerable: true,
                    value: getOrCreateCommandToken(stateElement, prop),
                };
            }
            return undefined;
        },
        set() {
            raiseError(`$command namespace is read-only; assigning to it is not allowed.`);
        },
        deleteProperty() {
            raiseError(`$command namespace is read-only; deleting from it is not allowed.`);
        },
    });
    namespaceProxyByStateElement.set(stateElement, proxy);
    return proxy;
}
function clearCommandNamespace(stateElement) {
    namespaceProxyByStateElement.delete(stateElement);
}

/**
 * `$eventTokens: ["a", "b", ...]` 配列宣言を解析し、宣言された名前群を Set で返す。
 *
 * event-token は command-token の双対（element→state 方向）。要素が dispatch する
 * イベントを `eventToken.<prop>: <name>` で token に流し、state 側は `$on` マップで受ける。
 * ここで宣言された名前のみが `eventToken.X` / `$on` の有効なチャネル名になる（typo 耐性）。
 *
 * 対応している宣言形式は **オブジェクトリテラル** のみ。
 */
function processEventTokensDeclaration(state) {
    const names = new Set();
    const declared = state[STATE_EVENT_TOKENS_NAME];
    if (typeof declared === "undefined") {
        return names;
    }
    if (!Array.isArray(declared)) {
        raiseError(`${STATE_EVENT_TOKENS_NAME} must be an array of strings.`);
    }
    for (const name of declared) {
        if (typeof name !== "string" || name.length === 0) {
            raiseError(`${STATE_EVENT_TOKENS_NAME} entries must be non-empty strings.`);
        }
        if (names.has(name)) {
            raiseError(`${STATE_EVENT_TOKENS_NAME} entry "${name}" is duplicated.`);
        }
        names.add(name);
    }
    return names;
}

/**
 * `$on: { <name>: (state, event, ...listIndexes) => {...} }` マップを解析し、
 * 各ハンドラを対応する event-token に subscribe する（state 側の受信配線）。
 *
 * - `$on` のキーは `$eventTokens` で宣言済みでなければならない（typo 耐性）。
 * - 各値は関数でなければならない。
 * - 引数規約は `(state, event, ...listIndexes)`。`this` 束縛は行わず引数で state を渡すため
 *   アロー関数で書ける（command-token の emit 規約と対称）。
 *
 * `$eventTokens` で宣言されたが `$on` に対応が無い token は subscriber ゼロ（emit は no-op）。
 */
function processOnDeclaration(stateElement, state, eventTokenNames) {
    const declared = state[STATE_ON_NAME];
    if (typeof declared === "undefined") {
        return;
    }
    if (typeof declared !== "object" || declared === null) {
        raiseError(`${STATE_ON_NAME} must be an object mapping event-token names to handler functions.`);
    }
    for (const [name, handler] of Object.entries(declared)) {
        if (!eventTokenNames.has(name)) {
            raiseError(`${STATE_ON_NAME} entry "${name}" is not declared in $eventTokens.`);
        }
        if (typeof handler !== "function") {
            raiseError(`${STATE_ON_NAME} entry "${name}" must be a function.`);
        }
        const token = getOrCreateEventToken(stateElement, name);
        token.subscribe(handler);
    }
}

/**
 * stream/lastNotified.ts
 *
 * 「最後に通知した観測値」台帳 — DOM binding / $updatedCallback（観測層）が
 * 最後に見た status・error（docs/state-streams-design.md §4-3）。
 *
 * 通知の same-value 判定を entry フィールドとの比較で行うと、再 set
 * （clearStreamRegistry → 新 entry 生成）を跨いだ陳腐化を検出できない
 * （error 表示中に再 set すると新 entry は error=null で生まれるため
 * null → null と誤判定して $postUpdate が落ち、DOM に旧 error が残る）。
 * そのため通知 dedup は entry の寿命ではなく stateElement の寿命で持つ
 * （ただし再 set で新宣言から消えた名前のエントリは pruneLastNotified で削除する —
 *  同名にしか dedup は要らず、放置すると台帳が単調増加するため）。
 * 未通知（初回）の基準値は宣言直後の観測初期値と同じ { idle, null }。
 *
 * さらに abortAllStreams（§5-1）は registry entry を通知なしで idle / null に
 * 直接ミューテーションするため、観測層が「台帳の値」と「idle / null」の
 * どちらを見たか確定できなくなる（binding / computed の fresh 読みは通知が
 * なくても他パスの drain で走る）。その乖離フィールドは invalidateLastNotified
 * で UNCERTAIN に無効化し、次回 updateStreamStatus の同値判定が必ず
 * 「変化あり」になるようにする（再接続ウィンドウ内の idle 描画が恒久陳腐化
 * しないための不変条件、§4-3）。
 */
/**
 * 無通知ミューテーション後の「観測値が確定できない」印。
 * どの実値とも一致しないため、次回の通知 dedup（`!==` / `Object.is`）を強制的に解除する。
 */
const UNCERTAIN = Symbol("wcs-stream-last-notified-uncertain");
const lastNotifiedByStateElement = new WeakMap();
/**
 * 最後に通知した観測値を返す。未通知なら基準値 { idle, null }。
 */
function getLastNotified(stateElement, name) {
    return (lastNotifiedByStateElement.get(stateElement)?.get(name) ?? { status: "idle", error: null });
}
/**
 * 通知した観測値を記録する（updateStreamStatus が $postUpdate 発行と同時に呼ぶ）。
 */
function setLastNotified(stateElement, name, status, error) {
    let lastMap = lastNotifiedByStateElement.get(stateElement);
    if (typeof lastMap === "undefined") {
        lastMap = new Map();
        lastNotifiedByStateElement.set(stateElement, lastMap);
    }
    lastMap.set(name, { status, error });
}
/**
 * 再 set（clearStreamRegistry → processStreamsDeclaration）後に呼び、新宣言に
 * 存在しない名前の台帳エントリを削除する。台帳は stateElement の寿命で生存するが
 * （§4-3 の再 set・再接続跨ぎ dedup）、それが必要なのは同名エントリのみで、
 * 旧宣言にしか無い名前は以後どの通知経路（updateStreamStatus）からも参照されない。
 * prune しないと、再 set のたびに異なる stream 名を使うステートで台帳が
 * stateElement の寿命の間単調増加する。
 * 既知の許容: prune 後に同名を再宣言した場合、dedup は基準値 { idle, null } から
 * やり直しになる（宣言削除時の binding 陳腐化が §4-4 の既知エッジである以上、
 * 再宣言は新規宣言と同じ扱いでよい）。
 */
function pruneLastNotified(stateElement, liveNames) {
    const lastMap = lastNotifiedByStateElement.get(stateElement);
    if (typeof lastMap === "undefined") {
        return;
    }
    for (const name of lastMap.keys()) {
        if (!liveNames.has(name)) {
            lastMap.delete(name);
        }
    }
}
/**
 * 無通知ミューテーション（abortAllStreams の idle / null 直接書き換え）の直後に呼び、
 * 台帳のうちミューテーション後の値と一致しないフィールドを UNCERTAIN に無効化する。
 * 一致しているフィールド（観測層がどちらを見ても同じ値）は dedup を維持する
 * （例: error が null のままなら再接続時に $streamError.<name> の余計な通知は出ない）。
 */
function invalidateLastNotified(stateElement, name) {
    const lastMap = lastNotifiedByStateElement.get(stateElement);
    if (typeof lastMap === "undefined") {
        return;
    }
    const last = lastMap.get(name);
    if (typeof last === "undefined") {
        // 未通知: 基準値 { idle, null } はミューテーション後の値と一致するため乖離しない
        return;
    }
    lastMap.set(name, {
        status: last.status === "idle" ? last.status : UNCERTAIN,
        error: Object.is(last.error, null) ? null : UNCERTAIN,
    });
}

/**
 * stream/activeStateElements.ts
 *
 * 起動中（startStreams 済み・未切断）の stateElement の列挙用 Set
 * （docs/state-streams-design.md §3-2）。
 *
 * streamRegistry の WeakMap は列挙不能のため、updater の drain リスナーが
 * 「どの stateElement の entry と batch を交差させるか」を知るには
 * 列挙可能な strong Set が別途必要になる。lastNotified.ts と同じ
 * 「import 循環回避の小モジュール」パターン
 * （streamRegistry → activeStateElements ← streamRuntime の一方向依存に保つ）。
 *
 * リーク防止の不変条件（strong Set が切断済み要素の GC を妨げないための連動）:
 * - add は startStreams（streamRuntime.ts）だけが行う
 *   （eager 起動＝connect 時、および接続中の `_state` 再 set 時の再起動）。
 * - delete は abortAllStreams / clearStreamRegistry（streamRegistry.ts）が行う。
 *   disconnect（disconnectedCallback → abortAllStreams）と `_state` 再 set
 *   （clearStreamRegistry → processStreamsDeclaration → 接続中なら startStreams で
 *   再 add）の両経路が必ずここを通るため、「Set に居る = 接続中かつ起動済み」が
 *   常に保たれ、切断済み stateElement への強参照は残らない。
 *   設計書 §3-2 の「未接続（disconnect 済み）の stateElement の entry は restart
 *   しない」はこの不変条件で担保される。
 */
const activeStateElements = new Set();
/**
 * 起動中 stateElement として登録する（startStreams 専用。不変条件はモジュールヘッダ参照）。
 */
function addActiveStateElement(stateElement) {
    activeStateElements.add(stateElement);
}
/**
 * 起動中 stateElement から外す（abortAllStreams / clearStreamRegistry 専用）。
 */
function deleteActiveStateElement(stateElement) {
    activeStateElements.delete(stateElement);
}
/**
 * 起動中 stateElement を列挙する（drain リスナーの交差判定用）。
 */
function getActiveStateElements() {
    return activeStateElements;
}

/**
 * stream/streamRegistry.ts
 *
 * `$streams` の registry（docs/state-streams-design.md §2-1 / §5）。
 * eventTokenRegistry と対称の WeakMap registry。
 *
 * - status / error の正本は registry entry（state オブジェクト上に実プロパティは持たない）。
 * - disconnect 時は abortAllStreams（abort のみ・registry 保持）、
 *   `_state` 再 set 時のみ clearStreamRegistry（abort ＋ 全削除）。
 */
const registryByStateElement = new WeakMap();
/**
 * stream entry 群を置換登録する（`_state` セッターからの再構築で丸ごと差し替える）。
 */
function setStreamEntries(stateElement, entries) {
    registryByStateElement.set(stateElement, entries);
}
/**
 * 登録済みの stream entry 群を返す。未登録なら空 Map を返す（registry への登録はしない）。
 */
function getStreamEntries(stateElement) {
    return registryByStateElement.get(stateElement) ?? new Map();
}
/**
 * 全 stream を abort して idle に戻す（設計書 §5-1）。registry は保持する。
 *
 * disconnectedCallback（切断時）に呼ばれるため、status / error の反映は
 * proxy / $postUpdate を使わず entry への直接ミューテーションで行う
 * （切断済みで binding 更新は不要かつ rootNode が無い）。
 *
 * 無通知ミューテーションは「最後に通知した観測値」台帳（stream/lastNotified.ts）
 * と registry を乖離させるため、同時に台帳側を invalidate する。これを怠ると
 * 再接続ウィンドウ内の fresh 読み（他パスの drain での getter 再計算など）が
 * 描画した idle に対し、restart の updateStreamStatus("active") が切断前の
 * 通知値と同値判定されて skip され、DOM が恒久的に陳腐化する（設計書 §4-3）。
 */
function abortAllStreams(stateElement) {
    // 依存駆動 restart の対象から外す（切断済み stateElement は restart しない、
    // 設計書 §3-2。add 側は startStreams — stream/activeStateElements.ts の
    // リーク防止不変条件を参照）。registry の有無に関わらず必ず外す。
    deleteActiveStateElement(stateElement);
    const entries = registryByStateElement.get(stateElement);
    if (typeof entries === "undefined") {
        return;
    }
    for (const entry of entries.values()) {
        entry.controller?.abort();
        entry.controller = null;
        entry.status = "idle";
        entry.error = null;
        invalidateLastNotified(stateElement, entry.name);
    }
}
/**
 * 全 stream を abort したうえで registry から削除する（`_state` 再 set 時の再配線用、設計書 §5-2）。
 */
function clearStreamRegistry(stateElement) {
    abortAllStreams(stateElement);
    // abortAllStreams が既に delete 済みだが、「clear = 全削除でも必ず restart 対象から
    // 外れる」不変条件を将来の abortAllStreams の変更から独立に保証するため明示的に呼ぶ。
    deleteActiveStateElement(stateElement);
    registryByStateElement.delete(stateElement);
}

/**
 * stream/processStreamsDeclaration.ts
 *
 * `$streams: { <name>: { args?, source, fold?, initial? } }` 宣言マップを解析し、
 * IStreamEntry を構築して streamRegistry に一括登録する
 * （docs/state-streams-design.md §1-1 / §1-2 / §1-3）。
 *
 * - バリデーション（§1-2）: 違反は raiseError。
 *   - 名前はフラットなプロパティ名のみ（空文字 / `.`（DELIMITER）/ `*`（WILDCARD）/ 先頭 `$` を禁止）。
 *   - Object.prototype の継承名（`__proto__` / `constructor` / `toString` 等）を禁止
 *     （own key でなくても `in` 判定が真になり、実体化 skip ＋ 起動時 Reflect.set の
 *      継承 setter 化 — `__proto__` は prototype 差し替え — を引き起こすため）。
 *   - getter / setter として宣言済みのパスとの衝突を禁止（getterPaths / setterPaths を検査）。
 *   - `source` は関数必須。`fold` は（あれば）関数。`fold` があるのに `initial` が無ければエラー
 *     （reduce は initial 必須。`initial` の有無は in 演算子で判定）。`args` は（あれば）関数。
 * - fold 省略時は latest（`(_acc, chunk) => chunk`）を注入する（§0 決定レコード）。
 * - 値プロパティ実体化（§1-3）: `state[name]` が未定義なら `initial`
 *   （fold 無しなら undefined）でデータプロパティとして初期化する。
 *   ユーザーが同名プロパティを先に宣言していた場合は上書きしない
 *   （起動時の initial リセットは streamRuntime 側の責務）。
 * - 通知 dedup 台帳の prune（§4-3）: 新宣言に存在しない名前の lastNotified エントリを
 *   削除する（台帳は stateElement 寿命 — 再 set 跨ぎ dedup が必要なのは同名のみ）。
 *
 * 呼び出しは stateElement.getterPaths / setterPaths の確定後であること
 * （State の `_state` セッターが getStateInfo の反映より後に呼ぶことで保証する）。
 */
/** fold 省略時に注入される既定 fold（latest = 最新チャンクで置換） */
const latestFold = (_acc, chunk) => chunk;
/** `$streams` 無し宣言の prune 用（旧宣言の全名前が残骸になる） */
const NO_STREAM_NAMES = new Set();
function processStreamsDeclaration(stateElement, state) {
    const declared = state[STATE_STREAMS_NAME];
    if (typeof declared === "undefined") {
        // $streams 無しの再 set でも旧宣言の名前は通知 dedup 台帳の残骸になるため prune する
        pruneLastNotified(stateElement, NO_STREAM_NAMES);
        return;
    }
    if (typeof declared !== "object" || declared === null) {
        raiseError(`${STATE_STREAMS_NAME} must be an object mapping stream names to stream definitions.`);
    }
    const entries = new Map();
    for (const [name, def] of Object.entries(declared)) {
        if (name.length === 0) {
            raiseError(`${STATE_STREAMS_NAME} entry name must be a non-empty string.`);
        }
        if (name.includes(DELIMITER)) {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" must be a flat property name ("${DELIMITER}" is not allowed).`);
        }
        if (name.includes(WILDCARD)) {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" must be a flat property name ("${WILDCARD}" is not allowed).`);
        }
        if (name.startsWith("$")) {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" must not start with "$" (reserved namespace).`);
        }
        // Object.prototype の継承名（__proto__ / constructor / toString 等）は一律拒否する。
        // own key でないのに `name in state` が真になるため実体化（§1-3）が skip され、
        // 起動時の initial リセット（Reflect.set）が継承 setter に化ける
        // （特に __proto__ は state の prototype を差し替える）ため、名前検査の防衛線で落とす（§1-2）。
        if (name in Object.prototype) {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" must not be a property name inherited from Object.prototype (e.g. "__proto__", "constructor").`);
        }
        if (stateElement.getterPaths.has(name)) {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" conflicts with a getter declared on the state.`);
        }
        if (stateElement.setterPaths.has(name)) {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" conflicts with a setter declared on the state.`);
        }
        if (typeof def !== "object" || def === null) {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" must be an object ({ args?, source, fold?, initial? }).`);
        }
        const definition = def;
        if (typeof definition.source !== "function") {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" source must be a function.`);
        }
        const hasFold = typeof definition.fold !== "undefined";
        if (hasFold && typeof definition.fold !== "function") {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" fold must be a function.`);
        }
        if (hasFold && !("initial" in definition)) {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" requires "initial" when fold is specified (reduce needs a seed value).`);
        }
        const hasArgs = typeof definition.args !== "undefined";
        if (hasArgs && typeof definition.args !== "function") {
            raiseError(`${STATE_STREAMS_NAME} entry "${name}" args must be a function.`);
        }
        const entry = {
            name,
            definition: {
                args: definition.args ?? null,
                source: definition.source,
                fold: definition.fold ?? latestFold,
                initial: definition.initial,
            },
            status: "idle",
            error: null,
            controller: null,
            depAddresses: new Set(),
        };
        // 値プロパティ実体化（§1-3）: ユーザーが同名プロパティを先に宣言していたら上書きしない
        if (!(name in state)) {
            state[name] = entry.definition.initial;
        }
        entries.set(name, entry);
    }
    setStreamEntries(stateElement, entries);
    // 新宣言に存在しない名前の通知 dedup 台帳エントリを prune する
    // （同名は保持 = §4-3 の再 set 跨ぎ dedup 契約を維持。stream/lastNotified.ts 参照）
    pruneLastNotified(stateElement, new Set(entries.keys()));
}

/**
 * stream/streamNamespace.ts
 *
 * `$streamStatus` / `$streamError` の read-only namespace proxy
 * （docs/state-streams-design.md §4-1 / §4-2）。commandNamespace と対称。
 *
 * - state element 単位で memo 化し、同一 stateElement なら同じ proxy が返る。
 * - 宣言された stream 名（`$streams` に列挙されたもの）のみ registry entry の
 *   status / error を返す。宣言外の名前・Symbol キーは undefined
 *   （`then` / `constructor` 等を内部機構が触っても throw しない寛容規約、
 *    $command と同じ）。
 * - 値は memo しない: proxy は getStreamEntries を毎回読む thin gateway
 *   （status / error は runtime が随時書き換えるため。registry entry が正本、§2-1）。
 * - set / deleteProperty は raiseError。setByAddress の親走査が namespace proxy に
 *   到達したときの Reflect.set もここで落ちる（書き込み防御 S11 の終端）。
 */
const statusNamespaceByStateElement = new WeakMap();
const errorNamespaceByStateElement = new WeakMap();
function createStreamNamespaceProxy(stateElement, namespaceName, pick) {
    return new Proxy(Object.create(null), {
        get(_target, prop) {
            if (typeof prop !== "string") {
                return undefined;
            }
            const entry = getStreamEntries(stateElement).get(prop);
            if (typeof entry === "undefined") {
                return undefined;
            }
            return pick(entry);
        },
        has(_target, prop) {
            return typeof prop === "string" && getStreamEntries(stateElement).has(prop);
        },
        ownKeys() {
            return Array.from(getStreamEntries(stateElement).keys());
        },
        getOwnPropertyDescriptor(_target, prop) {
            if (typeof prop !== "string") {
                return undefined;
            }
            const entry = getStreamEntries(stateElement).get(prop);
            if (typeof entry === "undefined") {
                return undefined;
            }
            return {
                configurable: true,
                enumerable: true,
                value: pick(entry),
            };
        },
        set() {
            raiseError(`${namespaceName} namespace is read-only; assigning to it is not allowed.`);
        },
        deleteProperty() {
            raiseError(`${namespaceName} namespace is read-only; deleting from it is not allowed.`);
        },
    });
}
function getStreamStatusNamespace(stateElement) {
    const cached = statusNamespaceByStateElement.get(stateElement);
    if (typeof cached !== "undefined") {
        return cached;
    }
    const proxy = createStreamNamespaceProxy(stateElement, STATE_STREAM_STATUS_NAMESPACE_NAME, (entry) => entry.status);
    statusNamespaceByStateElement.set(stateElement, proxy);
    return proxy;
}
function getStreamErrorNamespace(stateElement) {
    const cached = errorNamespaceByStateElement.get(stateElement);
    if (typeof cached !== "undefined") {
        return cached;
    }
    const proxy = createStreamNamespaceProxy(stateElement, STATE_STREAM_ERROR_NAMESPACE_NAME, (entry) => entry.error);
    errorNamespaceByStateElement.set(stateElement, proxy);
    return proxy;
}
/**
 * 両 namespace proxy の memo を破棄する（clearCommandNamespace と対称）。
 * disconnectedCallback と `_state` 再 set 時に呼ばれる。
 */
function clearStreamNamespace(stateElement) {
    statusNamespaceByStateElement.delete(stateElement);
    errorNamespaceByStateElement.delete(stateElement);
}

/**
 * stream/argsTrace.ts
 *
 * `$streams` の args トレース（依存捕捉、docs/state-streams-design.md §3-1）。
 *
 * - モジュールスコープの collector を立てて readonly proxy 上で args を評価し、
 *   getByAddress を通った読みを絶対アドレス（IAbsoluteStateAddress）として捕捉する。
 *   AbsolutePathInfo / AbsoluteStateAddress は両方キャッシュ済みのため、捕捉した
 *   アドレスは drain バッチと Set.has のインスタンス同一性で O(1) 照合できる（§2-1）。
 * - collectStreamDependency は getByAddress のホットパスから毎読み呼ばれるため、
 *   collector === null なら即 return し、それ以外の計算を一切しない。
 * - 起動・restart のたびに traceArgs が呼ばれ、成功時は entry.depAddresses を
 *   丸ごと置換する（per-run の動的再捕捉）。失敗時は前回成功 run の検証済み
 *   捕捉を保持する（§2-2 の「error からも依存変化で restart」を保つ）。
 * - lastNotified.ts と同じく import 循環回避のための小モジュール
 *   （getByAddress → argsTrace ← streamRuntime の一方向依存に保つ）。
 */
/** トレース中のみ非 null。getByAddress を通った読みの絶対アドレスが溜まる。 */
let collector = null;
/**
 * getByAddress の入口（checkDependency 直後）から毎読み呼ばれるフック。
 * トレース外（collector === null）では何もしない。
 */
function collectStreamDependency(stateElement, address) {
    if (collector === null) {
        return;
    }
    const absolutePathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
    collector.add(createAbsoluteStateAddress(absolutePathInfo, address.listIndex));
}
/**
 * args を readonly proxy で同期評価し、読まれたパスを entry.depAddresses に
 * 丸ごと置換で再捕捉する（§3-1）。評価値（source の第 1 引数になる）を返す。
 *
 * - args === null（宣言で省略）なら depAddresses を clear して undefined
 *   （依存なし = 起動後 restart しない）。
 * - 検査（違反は raiseError）:
 *   (a) 評価値が Promise（同期契約違反）
 *   (b) 自己依存 — `<name>` / `$streamStatus.<name>` / `$streamError.<name>` の読み
 *       （restart の自己書き込みで再発火する無限ループ、S8）
 *   (c) wildcard を含むパスの読み（`$getAll` 等も同様。第 1 段スコープ外）
 * - 失敗時（args のユーザー例外・検査違反）は今回の捕捉（captured）を採用せず
 *   伝播し、entry.depAddresses には**前回成功 run の検証済み捕捉を保持する**。
 *   これにより drain リスナーが throw を error 経路に正規化したあとも、依存の
 *   書き込みで再試行できる（§2-2「done / error からも依存変化で restart」——
 *   一時的な args throw で stream が恒久固着しない）。ループ安全性:
 *   保持されるのは前回**成功** run の捕捉のみ（自己依存・wildcard 検査済み）で
 *   自分の `<name>` / `$streamStatus.<name>` / `$streamError.<name>` を含み得ず、
 *   traceArgs throw 時の startStream は initial リセットに到達しないため、
 *   error 正規化の書き込みが保持 deps に再 hit することはない。再試行は依存
 *   書き込み 1 回につき高々 1 回で有界。未検査の captured を採用しないことが
 *   ループ防止の要件であり、前回検証済み捕捉の保持はそれを侵さない。
 * - collector は finally で必ず復元する（例外・再入安全。ネスト評価は想定しないが
 *   防御的に「前の collector を復元」の形にしておく — コストは同等）。
 */
function traceArgs(stateElement, entry) {
    const argsFn = entry.definition.args;
    if (argsFn === null) {
        entry.depAddresses.clear();
        return undefined;
    }
    const previousCollector = collector;
    const captured = new Set();
    collector = captured;
    let argsValue = undefined;
    try {
        stateElement.createState("readonly", (state) => {
            argsValue = argsFn(state);
        });
    }
    finally {
        // args のユーザー例外時は captured を採用せずそのまま伝播する
        // （entry.depAddresses は前回成功 run の検証済み捕捉を保持）
        collector = previousCollector;
    }
    if (argsValue instanceof Promise) {
        raiseError(`${STATE_STREAMS_NAME} entry "${entry.name}" args must be synchronous (it returned a Promise).`);
    }
    const selfStatusPath = `${STATE_STREAM_STATUS_NAMESPACE_NAME}${DELIMITER}${entry.name}`;
    const selfErrorPath = `${STATE_STREAM_ERROR_NAMESPACE_NAME}${DELIMITER}${entry.name}`;
    for (const dep of captured) {
        const pathInfo = dep.absolutePathInfo.pathInfo;
        if (dep.absolutePathInfo.stateElement === stateElement &&
            (pathInfo.path === entry.name || pathInfo.path === selfStatusPath || pathInfo.path === selfErrorPath)) {
            raiseError(`${STATE_STREAMS_NAME} entry "${entry.name}" args must not read the stream itself ("${pathInfo.path}"): a self-dependency would restart the stream on its own writes (infinite loop).`);
        }
        if (pathInfo.wildcardCount > 0) {
            raiseError(`${STATE_STREAMS_NAME} entry "${entry.name}" args must not read wildcard paths ("${pathInfo.path}"): wildcard dependencies are out of scope.`);
        }
    }
    entry.depAddresses = captured;
    return argsValue;
}

/**
 * stream/consumeSource.ts
 *
 * `$streams` のチャンク消費ループ（docs/state-streams-design.md §3-3）。
 * packages/signals/src/streamResource.ts の consume / iterate /
 * readableToAsyncIterable の移植（パッケージ間依存は持たない自己完結原則）。
 *
 * 唯一の構造差分は状態書き込みの IConsumeSink への委譲:
 *   value.set(fold(value.peek(), chunk)) → sink.fold(chunk)
 *   status.set("done")                   → sink.done()
 *   error.set(e) + status.set("error")   → sink.fail(e)
 *
 * sink.fold() が throw した場合（fold throw）もループ内の throw として
 * 既存の catch に流れ、signal.aborted なら return、でなければ sink.fail(e)。
 * consumeSource 自体は fold throw と source throw を区別しない
 * （producer の掃除 = controller.abort() は呼び出し側 runtime が fail 内で行う）。
 * consumeSource は reject しない（全経路 catch 済み）。
 *
 * ---------------------------------------------------------------------------
 * 以下、移植元モジュールヘッダの契約（原文英語のまま維持）:
 *
 * CONTRACT (cooperative cancellation — STRONG REQUIREMENT): the `source` MUST honor
 * the `AbortSignal` it is given. Honoring it is what drives switchMap restart/dispose;
 * a source that ignores it cannot be reliably cancelled.
 *
 * Rescue levels on abort:
 *   - ReadableStream: FULLY rescued. A parked read() is force-unwound via
 *     reader.cancel(), which both releases the underlying source and settles the
 *     pending read() so the loop unwinds.
 *   - AsyncIterable / async generator: PARTIALLY rescued. On abort we call
 *     iterator.return() to trigger the generator's finally/cleanup. But a parked
 *     `await` (the producer stalling before its next yield while IGNORING `signal`)
 *     cannot be force-unwound from outside — return() only takes effect when the
 *     generator next resumes. So a source that parks forever and never observes
 *     `signal` still leaks its consume task. Honor `signal` to bound this.
 * The `if (signal.aborted) return` check only runs after a chunk arrives, not while
 * parked — it drops stale chunks but is not, by itself, a cancellation mechanism.
 */
async function consumeSource(source, args, signal, sink) {
    // Obtain the iterator EXPLICITLY (not via `for await`'s implicit one) so abort can
    // call `iterator.return()` to trigger an AsyncIterable / async generator's
    // `finally`/cleanup. A `for await` only calls `.return()` when the loop itself exits;
    // if the producer is PARKED (awaiting before the next yield while ignoring `signal`),
    // the loop never advances, so the implicit `.return()` never runs and the task leaks
    // past restart/dispose. Calling `.return()` on abort is the PARTIAL rescue: the
    // parked `await` cannot be force-unwound from outside, but once the generator resumes
    // (its next tick), `.return()` makes it run its `finally` and stop — recovering the
    // common "generator wakes up after abort" case. The ReadableStream path is fully
    // rescued via `reader.cancel()` (see `readableToAsyncIterable`).
    let iterator = null;
    // Guard against returning the SAME iterator twice. `onAbort` is reachable two ways:
    // the abort listener, and the explicit call below when abort raced the
    // `await source(...)`. The guard keys on the iterator instance (not a plain "ran"
    // flag): the listener firing with iterator still null must NOT consume the single
    // real cleanup that the explicit call performs once the iterator exists. So we only
    // mark an iterator returned once we have actually called `.return()` on it.
    let returned = null;
    const onAbort = () => {
        if (!iterator || iterator === returned) {
            return; // nothing to release yet, or already released this iterator
        }
        returned = iterator;
        // Fire the iterator's cleanup. Swallow any throw/rejection from `.return()` — we
        // are tearing down; a producer that rejects on return must not surface here.
        try {
            void iterator.return?.()?.then?.(undefined, () => { });
        }
        catch {
            // `.return()` threw synchronously while tearing down — ignore.
        }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
        const produced = await source(args, signal);
        iterator = iterate(produced, signal)[Symbol.asyncIterator]();
        if (signal.aborted) {
            // Aborted while awaiting the source: the abort listener already ran (iterator
            // was still null then), so explicitly release the just-produced iterator now —
            // this fires a generator's finally / a ReadableStream's cancel for the
            // resource we created but will never iterate.
            onAbort();
            return;
        }
        for (;;) {
            const result = await iterator.next();
            if (result.done) {
                break;
            }
            if (signal.aborted) {
                return; // stale chunk from a superseded/disposed run — drop it
            }
            sink.fold(result.value);
        }
        if (signal.aborted) {
            return; // stream ended but this run was aborted — don't mark done
        }
        sink.done();
    }
    catch (e) {
        if (signal.aborted) {
            return; // an abort that surfaced as a throw is not an error
        }
        sink.fail(e); // keep the last folded value (do not reset)
    }
    finally {
        signal.removeEventListener("abort", onAbort);
    }
}
function iterate(produced, signal) {
    // Optional chaining: a null/undefined source return value must fall through to the
    // explicit TypeError below (symmetric with the `?.` on the getReader probe), not
    // throw an opaque "Cannot read properties of null" from this property access.
    if (typeof produced?.[Symbol.asyncIterator] === "function") {
        return produced;
    }
    // Not async-iterable: must be a ReadableStream (read via getReader). Validate so
    // a wrong source value yields a clear error instead of an opaque "getReader is
    // not a function" from inside the generator.
    if (typeof produced?.getReader !== "function") {
        throw new TypeError("[@wcstack/state] $streams: source must return an AsyncIterable or a ReadableStream (got neither).");
    }
    return readableToAsyncIterable(produced, signal);
}
async function* readableToAsyncIterable(stream, signal) {
    const reader = stream.getReader();
    // A ReadableStream read() does NOT observe an AbortSignal on its own. Without
    // this, a switchMap restart / dispose leaves the previous reader parked in a
    // pending read() forever, leaking the underlying source. Cancelling on abort
    // both releases the source AND settles the pending read() so the for-await
    // unwinds and the finally below can release the lock. Abort is the only
    // early-exit path for this generator (the consumer never calls .return()
    // without aborting), so this is the sole place a non-drained stream is cancelled.
    const onAbort = () => {
        void reader.cancel().catch(() => { }); // tearing down; swallow a rejected cancel
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                return;
            }
            yield value;
        }
    }
    finally {
        signal.removeEventListener("abort", onAbort);
        reader.releaseLock();
    }
}

/**
 * stream/streamRuntime.ts
 *
 * `$streams` の起動・チャンク反映・status 遷移（docs/state-streams-design.md
 * §2-2 / §3-3 / §4-3）。
 *
 * スコープ:
 * - eager 起動（startStreams）と start = restart の共通手順（startStream）。
 * - args は traceArgs（stream/argsTrace.ts）で readonly proxy 評価と同時に依存を
 *   per-run 再捕捉する（§3-1）。
 * - 依存駆動 restart（§3-2）: モジュール初期化時に updater の drain 終了リスナーを
 *   1 つ登録し（restartStreamsOnUpdateBatch）、起動中 stateElement
 *   （stream/activeStateElements.ts — startStreams で add・abortAllStreams /
 *   clearStreamRegistry で delete）の各 entry について depAddresses と batch を
 *   交差させ、hit した entry を restart する。
 *
 * 切断後の後始末について（不変条件）:
 * - disconnect（abortAllStreams）は registry entry を直接ミューテーションして
 *   idle に戻す（$postUpdate は呼ばない — 切断済みで binding 更新は不要かつ
 *   rootNode が無い）。
 * - abort 済み run の sink コールバック（fold / done / fail）は consumeSource の
 *   stale-drop（全経路の signal.aborted チェック）が createState 到達前に
 *   落とすため、runtime 側に切断後ガードは不要。
 *   「runtime が createState を呼ぶのは自分の controller が生きている間だけ」が
 *   この 2 つの組み合わせで常に保たれる。
 */
/**
 * 登録済みの全 stream を起動する（eager 起動、設計書 §2-3）。
 * State.connectedCallback（$connectedCallback 完了後）と接続中の `_state` 再 set
 * から呼ばれる想定。
 *
 * 同時に依存駆動 restart（§3-2）の対象として activeStateElements に登録する
 * （delete 側は abortAllStreams / clearStreamRegistry —
 *  stream/activeStateElements.ts のリーク防止不変条件を参照）。
 * eager 起動の throw（args のユーザー例外等）はここでは正規化せず loud fail のまま
 * （既存の $connectedCallback と同じ扱い。正規化は drain リスナー側の restart のみ）。
 */
function startStreams(stateElement) {
    const entries = getStreamEntries(stateElement);
    if (entries.size === 0) {
        return;
    }
    addActiveStateElement(stateElement);
    for (const entry of entries.values()) {
        startStream(stateElement, entry);
    }
}
/**
 * stream を起動する。start = restart の共通手順（設計書 §2-2）:
 *
 * 1. 旧 run を abort（restart 時）→ 新 AbortController
 * 2. traceArgs で args を readonly proxy 評価し依存を丸ごと再捕捉
 *    （Promise / 自己依存 / wildcard 読みは raiseError、§3-1）
 * 3. 値を initial にリセット（起動 = 最初の run も restart と同一セマンティクス、§1-3）
 * 4. status="active"・error=null を反映
 * 5. consumeSource で消費開始
 */
function startStream(stateElement, entry) {
    entry.controller?.abort();
    const controller = new AbortController();
    entry.controller = controller;
    // args 評価 ＋ 依存の per-run 再捕捉（args === null なら depAddresses を clear して
    // undefined。Promise / 自己依存 / wildcard 読みは raiseError、§3-1）
    const argsValue = traceArgs(stateElement, entry);
    // 値リセット: setByAddress を通すことで updater coalesce・sameValueGuard・
    // walkDependency（stream 値に依存する computed の dirty 化）がすべて乗る（§3-3）
    stateElement.createState("writable", (state) => {
        state[entry.name] = entry.definition.initial;
    });
    updateStreamStatus(stateElement, entry, "active", null);
    const definition = entry.definition;
    const sink = {
        fold(chunk) {
            // fold の throw はそのまま伝播させる（consumeSource が fail 経路に回す）
            stateElement.createState("writable", (state) => {
                state[entry.name] = definition.fold(state[entry.name], chunk);
            });
        },
        done() {
            updateStreamStatus(stateElement, entry, "done", null);
        },
        fail(error) {
            // 値は直前の fold 結果を保持（リセットしない）
            updateStreamStatus(stateElement, entry, "error", error);
            // fold-throw 時の producer 掃除（iterator.return() / reader.cancel() を発火）。
            // source-throw 時は producer が既に終了しているので abort は無害（§3-3）。
            controller.abort();
        },
    };
    void consumeSource(definition.source, argsValue, controller.signal, sink);
}
/**
 * status / error の反映ヘルパ（設計書 §4-3）。
 *
 * - registry entry が正本。常に最新値へ書き換える。
 * - 「最後に通知した観測値」（stream/lastNotified.ts — 再 set・再接続を跨いで
 *   stateElement の寿命で生存する台帳）から変化した項目に対応する名前空間パス
 *   （`$streamStatus.<name>` / `$streamError.<name>`）だけを writable proxy の
 *   $postUpdate で通知する（updater enqueue ＋ walkDependency）。
 * - 両方不変なら通知しない（名前空間パスは setByAddress を通らないため
 *   sameValueGuard が効かず、同等の same-value 判定を runtime 側が持つ）。
 *   abortAllStreams の無通知ミューテーションで台帳が invalidate されている場合は
 *   同値扱いにならず必ず通知される（再接続ウィンドウ内の fresh 読みが描画した
 *   idle の恒久陳腐化を防ぐ、§4-3）。
 */
function updateStreamStatus(stateElement, entry, status, error) {
    entry.status = status;
    entry.error = error;
    const last = getLastNotified(stateElement, entry.name);
    const statusChanged = last.status !== status;
    const errorChanged = !Object.is(last.error, error);
    if (!statusChanged && !errorChanged) {
        return;
    }
    setLastNotified(stateElement, entry.name, status, error);
    stateElement.createState("writable", (state) => {
        if (statusChanged) {
            state.$postUpdate(`${STATE_STREAM_STATUS_NAMESPACE_NAME}${DELIMITER}${entry.name}`);
        }
        if (errorChanged) {
            state.$postUpdate(`${STATE_STREAM_ERROR_NAMESPACE_NAME}${DELIMITER}${entry.name}`);
        }
    });
}
/**
 * 依存駆動 restart の drain リスナー（設計書 §3-2）。
 * モジュール初期化時に registerUpdateBatchListener で 1 つだけ登録される。
 *
 * - 起動中の各 stateElement の各 entry について、depAddresses と batch の交差を
 *   Set.has のインスタンス同一性で判定する（小さい方 = depAddresses を回して
 *   batch.has(dep)。AbsoluteStateAddress はキャッシュにより同一 (stateName, path,
 *   listIndex) が同一インスタンス、§2-1）。args なし（depAddresses 空）の entry は
 *   自然にスキップされる。
 * - status は問わず restart する（done / error からも依存の叩き直しで再試行、§2-2）。
 * - hit は収集してから一括で restart する（イテレーション中の registry 変更を避ける。
 *   entry ごとに最初の hit で break するため「1 drain につき 1 entry 最大 1 restart」
 *   もここで自然に成立する — 同一 tick 内の複数依存書き込みは 1 restart に畳まれる）。
 * - hits の実行時にも active ＋ entry identity を再チェックする: 先行 restart の
 *   source / args は consumeSource / traceArgs の同期プレフィックスで同期実行される
 *   ため、そこで (a) 他の stateElement（や自分自身のホスト）の同期切断、(b) 同一要素の
 *   _state 同期再 set（clearStreamRegistry → startStreams で Set に再 add される）が
 *   起こり得る。(a) は切断済み要素への startStream が rootNode 不在で throw する経路、
 *   (b) は registry から置換済みの旧 entry を restart して到達不能な孤児 consume run を
 *   リークする経路（§3-2「未接続の stateElement の entry は restart しない」・
 *   §5-1「切断後は idle」に違反）で、いずれも「entry が現行 registry の live entry で
 *   あること」の再検証で skip する。startStream **実行中**の自己切断・再 set は事前
 *   チェックではガードできないため、catch 側でも同じ再検証を行ってから error に
 *   正規化する（切断済みでの正規化は createState が再 throw して drain リスナー外へ
 *   漏れ、後続 hits の restart を巻き添えにするため）。
 * - restart（startStream）は entry ごとに try/catch し、throw（args のユーザー例外・
 *   Promise 同期契約違反等）は controller.abort() → status="error"・$streamError 格納
 *   に正規化する（§3-2 規範 3）。updater の drain を壊さず、他 entry の restart も
 *   継続する。eager 起動（connect 時の startStreams）の throw は従来どおり loud fail。
 * - restart 内の書き込み（initial リセット・status 通知）は updater への enqueue のみで
 *   新しい microtask バッチを作る（drain 再入ではない）。自己依存は traceArgs が
 *   宣言時に raiseError で検出するため、restart 書き込みが自分の依存に再 hit する
 *   ループは起きない（§3-1）。
 */
function restartStreamsOnUpdateBatch(batch) {
    const activeStateElements = getActiveStateElements();
    if (activeStateElements.size === 0) {
        // stream 未使用アプリの drain に配列・イテレータ割り当てのコストを載せない
        return;
    }
    const hits = [];
    for (const stateElement of activeStateElements) {
        for (const entry of getStreamEntries(stateElement).values()) {
            for (const dep of entry.depAddresses) {
                if (batch.has(dep)) {
                    hits.push({ stateElement, entry });
                    break;
                }
            }
        }
    }
    for (const { stateElement, entry } of hits) {
        // 先行 restart の source / args 同期実行は他要素の切断や同一要素の _state 同期再 set を
        // 行い得るため、実行時に再チェックする（live な Set / registry ビューで即時反映）:
        // - 切断済み要素は skip（§3-2「未接続の stateElement の entry は restart しない」）
        // - entry が現行 registry のものでなければ skip — 同期再 set で置換された旧 entry を
        //   restart すると、registry から到達不能なため abortAllStreams でも止められない
        //   孤児 consume run がリークする
        if (!activeStateElements.has(stateElement) ||
            getStreamEntries(stateElement).get(entry.name) !== entry) {
            continue;
        }
        try {
            startStream(stateElement, entry);
        }
        catch (e) {
            entry.controller?.abort();
            // startStream 実行中（args / source の同期プレフィックス）の自己切断・同期再 set は
            // 上の再チェックではガードできない。切断済みだと updateStreamStatus の createState が
            // rootNode 不在で再 throw して drain リスナー外へ漏れる（後続 hits の restart を
            // 巻き添えにする）ため、entry がまだ現行の live entry である場合のみ error に
            // 正規化する（切断済みなら abortAllStreams が idle に戻し済み。§3-2 規範 3 / §5-1）。
            if (activeStateElements.has(stateElement) &&
                getStreamEntries(stateElement).get(entry.name) === entry) {
                updateStreamStatus(stateElement, entry, "error", e);
            }
        }
    }
}
registerUpdateBatchListener(restartStreamsOnUpdateBatch);

function getterFn(name) {
    return function () {
        const stateEl = this.stateElement;
        if (!stateEl)
            return undefined;
        let value;
        try {
            stateEl.createState("readonly", (state) => {
                value = state[name];
            });
        }
        catch (e) {
            console.warn(`[@wcstack/state] DCC getter "${name}" failed:`, e);
            return undefined;
        }
        return value;
    };
}
function setterFn(name) {
    return function (value) {
        const stateEl = this.stateElement;
        if (!stateEl)
            return;
        stateEl.initializePromise.then(() => {
            stateEl.createState("writable", (state) => {
                state[name] = value;
            });
        });
    };
}
function callFn(name, isAsync) {
    if (isAsync) {
        return function (...args) {
            const stateEl = this.stateElement;
            if (!stateEl)
                return undefined;
            return stateEl.initializePromise.then(() => {
                let result;
                return stateEl.createStateAsync("writable", async (state) => {
                    result = await state[name](...args);
                }).then(() => result);
            });
        };
    }
    return function (...args) {
        const stateEl = this.stateElement;
        if (!stateEl)
            return undefined;
        return stateEl.initializePromise.then(() => {
            let result;
            stateEl.createState("writable", (state) => {
                result = state[name](...args);
            });
            return result;
        });
    };
}
function isInternalProperty(name) {
    return name.startsWith("$");
}

function createWcBindable(tagName, bindables) {
    const properties = bindables.map((propName) => ({
        name: propName,
        event: `${tagName}:${propName}-changed`,
    }));
    // Every $bindables member gets both a getter and a setter on the DCC prototype,
    // so declare it in inputs as well — a property declared only in `properties` is
    // output-only under directional initial sync, which would permanently block
    // parent-state → DCC writes.
    const inputs = bindables.map((propName) => ({
        name: propName,
    }));
    return {
        protocol: "wc-bindable",
        version: 1,
        properties,
        inputs,
    };
}
function createBindableEventMap(tagName, bindables) {
    const map = {};
    for (const propName of bindables) {
        map[propName] = `${tagName}:${propName}-changed`;
    }
    return map;
}

function defineDCC(hostElement, shadowRoot, state) {
    const tagName = hostElement.tagName.toLowerCase();
    // バリデーション
    if (!tagName.includes("-")) {
        raiseError(`DCC: "${tagName}" is not a valid custom element name (must contain a hyphen).`);
    }
    if (customElements.get(tagName)) {
        // 既に登録済みならスキップ（重複定義の検知のため警告は出す）
        console.warn(`[@wcstack/state] DCC: "${tagName}" is already registered. Skipping redefinition.`);
        return;
    }
    // ShadowRoot は cloneNode 不可のため、template 経由で内容をクローン
    const template = document.createElement("template");
    template.innerHTML = shadowRoot.innerHTML;
    const shadowRootMode = shadowRoot.mode;
    // $bindables から wcBindable + bindableEventMap を生成
    const bindables = Array.isArray(state[STATE_BINDABLES_NAME])
        ? state[STATE_BINDABLES_NAME]
        : [];
    const wcBindable = bindables.length > 0
        ? createWcBindable(tagName, bindables)
        : null;
    const bindableEventMap = bindables.length > 0
        ? createBindableEventMap(tagName, bindables)
        : {};
    // DCC クラス生成
    const stateTagSelector = `${config.tagNames.state}:not([name])`;
    const DCCElement = class extends HTMLElement {
        static template = template;
        static shadowRootMode = shadowRootMode;
        static wcBindable = wcBindable;
        static bindableEventMap = bindableEventMap;
        _shadow = null;
        connectedCallback() {
            if (this.hasAttribute(DCC_DEFINITION_ATTRIBUTE))
                return;
            this._shadow = this.attachShadow({ mode: DCCElement.shadowRootMode });
            this._shadow.appendChild(DCCElement.template.content.cloneNode(true));
            // bindableEventMap の設定
            if (Object.keys(DCCElement.bindableEventMap).length > 0) {
                const stateEl = this._shadow.querySelector(stateTagSelector);
                if (stateEl) {
                    stateEl.initializePromise.then(() => {
                        stateEl.setBindableEventMap(DCCElement.bindableEventMap);
                    });
                }
            }
        }
        get stateElement() {
            return this._shadow?.querySelector(stateTagSelector);
        }
    };
    // state プロパティを走査して DCC クラスのプロトタイプにgetter/setter/methodを定義
    const descriptors = Object.getOwnPropertyDescriptors(state);
    for (const [name, desc] of Object.entries(descriptors)) {
        if (isInternalProperty(name))
            continue;
        const newDesc = { configurable: true, enumerable: true };
        if (typeof desc.value === "function") {
            const isAsync = desc.value.constructor?.name === "AsyncFunction";
            newDesc.value = callFn(name, isAsync);
        }
        else {
            newDesc.get = getterFn(name);
            newDesc.set = setterFn(name);
        }
        Object.defineProperty(DCCElement.prototype, name, newDesc);
    }
    // カスタム要素登録
    customElements.define(tagName, DCCElement);
}

/**
 * Cache for resolved path information.
 * Uses Map to safely handle property names including reserved words like "constructor" and "toString".
 */
const _cache = new Map();
/**
 * Class that parses and stores resolved path information.
 *
 * Analyzes property path strings to extract:
 * - Path segments and their hierarchy
 * - Wildcard locations and types
 * - Numeric indexes vs unresolved wildcards
 * - Wildcard type classification (none/context/all/partial)
 */
class ResolvedAddress {
    path;
    segments;
    wildcardCount;
    wildcardType;
    wildcardIndexes;
    pathInfo;
    /**
     * Constructs resolved path information from a property path string.
     *
     * Parses the path to identify wildcards (*) and numeric indexes,
     * classifies the wildcard type, and generates structured path information.
     *
     * @param name - Property path string (e.g., "items.*.name" or "data.0.value")
     */
    constructor(path) {
        // Split path into individual segments
        const segments = path.split(".");
        const tmpPatternSegments = segments.slice();
        let incompleteCount = 0; // Count of unresolved wildcards (*)
        let completeCount = 0; // Count of resolved wildcards (numeric indexes)
        let wildcardCount = 0;
        let wildcardType = "none";
        const wildcardIndexes = [];
        // Process each segment to identify wildcards and indexes
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            if (segment === "*") {
                // Unresolved wildcard
                tmpPatternSegments[i] = "*";
                wildcardIndexes.push(null);
                incompleteCount++;
                wildcardCount++;
            }
            else {
                const number = Number(segment);
                if (!Number.isNaN(number)) {
                    // Numeric index - treat as resolved wildcard
                    tmpPatternSegments[i] = "*";
                    wildcardIndexes.push(number);
                    completeCount++;
                    wildcardCount++;
                }
            }
        }
        // Generate pattern string with wildcards normalized
        const structuredPath = tmpPatternSegments.join(".");
        const pathInfo = getPathInfo(structuredPath);
        // Classify wildcard type based on resolved vs unresolved counts
        if (incompleteCount > 0 || completeCount > 0) {
            if (incompleteCount === wildcardCount) {
                // All wildcards are unresolved - need context to resolve
                wildcardType = "context";
            }
            else if (completeCount === wildcardCount) {
                // All wildcards are resolved with numeric indexes
                wildcardType = "all";
            }
            else {
                // Mix of resolved and unresolved wildcards
                wildcardType = "partial";
            }
        }
        this.path = path;
        this.segments = segments;
        this.wildcardCount = wildcardCount;
        this.wildcardType = wildcardType;
        this.wildcardIndexes = wildcardIndexes;
        this.pathInfo = pathInfo;
    }
}
/**
 * Retrieves or creates resolved path information for a property path.
 *
 * This function caches resolved path information for performance.
 * On first access, it parses the path and creates a ResolvedPathInfo instance.
 * Subsequent accesses return the cached result.
 *
 * @param name - Property path string (e.g., "items.*.name", "data.0.value")
 * @returns Resolved path information containing segments, wildcards, and type classification
 */
function getResolvedAddress(name) {
    let nameInfo;
    // Return cached value or create, cache, and return new instance
    return _cache.get(name) ?? (_cache.set(name, nameInfo = new ResolvedAddress(name)), nameInfo);
}

/**
 * connectedCallback.ts
 *
 * StateClassのライフサイクルフック「$connectedCallback」を呼び出すユーティリティ関数です。
 *
 * 主な役割:
 * - オブジェクト（target）に$connectedCallbackメソッドが定義されていれば呼び出す
 * - コールバックはtargetのthisコンテキストで呼び出し、IReadonlyStateProxy（receiver）を引数として渡す
 * - 非同期関数として実行可能（await対応）
 *
 * 設計ポイント:
 * - Reflect.getで$connectedCallbackプロパティを安全に取得
 * - 存在しない場合は何もしない
 * - ライフサイクル管理やカスタム初期化処理に利用
 */
async function connectedCallback(target, _prop, receiver, _handler) {
    const callback = Reflect.get(target, STATE_CONNECTED_CALLBACK_NAME);
    if (typeof callback === "function") {
        await callback.call(receiver);
    }
}

/**
 * disconnectedCallback.ts
 *
 * StateClassのライフサイクルフック「$disconnectedCallback」を呼び出すユーティリティ関数です。
 *
 * 主な役割:
 * - オブジェクト（target）に$disconnectedCallbackメソッドが定義されていれば呼び出す
 * - コールバックはtargetのthisコンテキストで呼び出し、IReadonlyStateProxy（receiver）を引数として渡す
 *
 * 設計ポイント:
 * - Reflect.getで$disconnectedCallbackプロパティを安全に取得
 * - 存在しない場合は何もしない
 * - ライフサイクル管理やクリーンアップ処理に利用
 */
function disconnectedCallback(target, _prop, receiver, _handler) {
    const callback = Reflect.get(target, STATE_DISCONNECTED_CALLBACK_NAME);
    if (typeof callback === "function") {
        callback.call(receiver);
    }
}

const cacheEntryByAbsoluteStateAddress = new WeakMap();
function getCacheEntryByAbsoluteStateAddress(address) {
    return cacheEntryByAbsoluteStateAddress.get(address) ?? null;
}
function setCacheEntryByAbsoluteStateAddress(address, cacheEntry) {
    if (cacheEntry === null) {
        cacheEntryByAbsoluteStateAddress.delete(address);
    }
    else {
        cacheEntryByAbsoluteStateAddress.set(address, cacheEntry);
    }
}
function dirtyCacheEntryByAbsoluteStateAddress(address) {
    const cacheEntry = cacheEntryByAbsoluteStateAddress.get(address);
    if (cacheEntry) {
        cacheEntry.dirty = true;
    }
}

function checkDependency(handler, address) {
    // $untrackDependency スコープ中／setter 実行中は依存を張らない
    if (handler.untracking) {
        return;
    }
    // 動的依存関係の登録
    if (handler.addressStackLength > 0) {
        const lastAddress = handler.lastAddressStack;
        const lastInfo = lastAddress?.pathInfo ?? null;
        const stateElement = handler.stateElement;
        if (lastInfo !== null) {
            if (stateElement.getterPaths.has(lastInfo.path) &&
                lastInfo.path !== address.pathInfo.path) {
                // lastInfo.pathはgetterの名前であり、address.pathInfo.pathは
                // そのgetterが参照している値のパスである
                stateElement.addDynamicDependency(address.pathInfo.path, lastInfo.path);
                // 他行読み取りの検出: 評価中の getter と読み取り先が同じワイルドカード親
                // （リスト）を共有し、その階層の listIndex が異なる場合、この getter は
                // 自行の外に依存する（隣接項目参照など）。該当リストを crossRowListPaths に
                // 記録し、walkDependency の diff-filter 展開を全行展開へフォールバックさせる。
                if (address.pathInfo.wildcardCount > 0 && lastInfo.wildcardCount > 0) {
                    const sharedLen = calcWildcardLen(address.pathInfo, lastInfo);
                    if (sharedLen > 0) {
                        let crossRow = false;
                        for (let level = 0; level < sharedLen; level++) {
                            if (address.listIndex?.at(level) !== lastAddress.listIndex?.at(level)) {
                                crossRow = true;
                                break;
                            }
                        }
                        if (crossRow) {
                            for (let level = 0; level < sharedLen; level++) {
                                stateElement.addCrossRowListPath?.(address.pathInfo.wildcardParentPaths[level]);
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * getByAddress.ts
 *
 * StateClassの内部APIとして、構造化パス情報（IStructuredPathInfo）とリストインデックス（IListIndex）を指定して
 * 状態オブジェクト（target）から値を取得するための関数（getByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を取得（多重ループやワイルドカードにも対応）
 * - 依存関係の自動登録（checkDependencyで登録）
 * - キャッシュ機構（リストもキャッシュ対象）
 * - getter経由で値取得時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathAddressやlistIndexを辿って再帰的に値を取得
 *
 * 設計ポイント:
 * - checkDependencyで依存追跡を実行
 * - キャッシュ有効時はstateAddressで値をキャッシュし、取得・再利用を最適化
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値取得を実現
 * - finallyでキャッシュへの格納を保証
 */
/**
 * namespace 配下のパスは raw state を持たないため、proxy の get トラップと同じ
 * namespace オブジェクトを辿る。1セグメント目は namespace 本体、2セグメント目以降は
 * namespace 上のキーを順に走査する。走査値が object / function 以外（null /
 * undefined / primitive の葉）になったら undefined を返す — 葉より深い読み
 * （例: `$streamStatus.<name>.<key>`、error が primitive throw のときの
 * `$streamError.<name>.message`）は宣言外アクセスと同じ undefined 解決とし、
 * Reflect.get の non-object TypeError を updater の drain に漏らさない
 * （§4-1 の throw しない寛容規約）。
 */
function walkNamespace(namespace, segments) {
    let value = namespace;
    for (let i = 1; i < segments.length; i++) {
        // Object(v) !== v は「v が object / function でない」（= primitive / null / undefined）判定
        if (Object(value) !== value) {
            return undefined;
        }
        value = Reflect.get(value, segments[i]);
    }
    return value;
}
function _getByAddress(target, address, receiver, handler, stateElement) {
    const firstSegment = address.pathInfo.segments[0];
    if (firstSegment === STATE_COMMAND_NAMESPACE_NAME) {
        // $command 名前空間: キーは宣言済み command token 名
        return walkNamespace(getCommandNamespace(stateElement), address.pathInfo.segments);
    }
    if (firstSegment === STATE_STREAM_STATUS_NAMESPACE_NAME) {
        // $streamStatus / $streamError 名前空間: キーは宣言済み stream 名
        // （registry entry が正本の thin gateway、docs/state-streams-design.md §4-2）。
        // setByAddress の親走査もここを通るため、子への Reflect.set が namespace proxy の
        // raiseError に到達する = 書き込み防御（S11）もこの分岐で成立する。
        return walkNamespace(getStreamStatusNamespace(stateElement), address.pathInfo.segments);
    }
    if (firstSegment === STATE_STREAM_ERROR_NAMESPACE_NAME) {
        return walkNamespace(getStreamErrorNamespace(stateElement), address.pathInfo.segments);
    }
    if (address.pathInfo.path in target) {
        // getterの中で参照の可能性があるので、addressをプッシュする
        if (stateElement.getterPaths.has(address.pathInfo.path)) {
            handler.pushAddress(address);
            try {
                return Reflect.get(target, address.pathInfo.path, receiver);
            }
            finally {
                handler.popAddress();
            }
        }
        else {
            return Reflect.get(target, address.pathInfo.path);
        }
    }
    else {
        const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
        const parentValue = getByAddress(target, parentAddress, receiver, handler);
        const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
        if (lastSegment === WILDCARD) {
            const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined path: ${address.pathInfo.path}`);
            return Reflect.get(parentValue, index);
        }
        else {
            return Reflect.get(parentValue, lastSegment);
        }
    }
}
function _getByAddressWithCache(target, address, receiver, handler, stateElement) {
    const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
    const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
    const cacheEntry = getCacheEntryByAbsoluteStateAddress(absAddress);
    if (cacheEntry !== null && cacheEntry.dirty === false) {
        return cacheEntry.value;
    }
    const value = _getByAddress(target, address, receiver, handler, stateElement);
    setCacheEntryByAbsoluteStateAddress(absAddress, {
        value: value,
        dirty: false
    });
    return value;
}
function getByAddress(target, address, receiver, handler) {
    checkDependency(handler, address);
    // $streams の args トレース中のみ絶対アドレスを捕捉（collector 非活性なら即 return）
    collectStreamDependency(handler.stateElement, address);
    const stateElement = handler.stateElement;
    const cacheable = address.pathInfo.wildcardCount > 0 ||
        stateElement.getterPaths.has(address.pathInfo.path);
    if (cacheable) {
        return _getByAddressWithCache(target, address, receiver, handler, stateElement);
    }
    else {
        return _getByAddress(target, address, receiver, handler, stateElement);
    }
}

/**
 * getContextListIndex.ts
 *
 * Stateの内部APIとして、現在のプロパティ参照スコープにおける
 * 指定したstructuredPath（ワイルドカード付きプロパティパス）に対応する
 * リストインデックス（IListIndex）を取得する関数です。
 *
 * 主な役割:
 * - handlerの最後にアクセスされたAddressから、指定パスに対応するリストインデックスを取得
 * - ワイルドカード階層に対応し、多重ループやネストした配列バインディングにも利用可能
 *
 * 設計ポイント:
 * - 直近のプロパティ参照情報を取得
 * - info.indexByWildcardPathからstructuredPathのインデックスを特定
 * - listIndex.at(index)で該当階層のリストインデックスを取得
 * - パスが一致しない場合や参照が存在しない場合はnullを返す
 */
function getContextListIndex(handler, structuredPath) {
    if (handler.addressStackLength === 0) {
        return null;
    }
    const address = handler.lastAddressStack;
    if (address === null) {
        return null;
    }
    const index = address.pathInfo.indexByWildcardPath[structuredPath];
    if (typeof index === "undefined") {
        return null;
    }
    return address.listIndex?.at(index) ?? null;
}

/**
 * Reports whether an address has been initialized, independently of its value.
 * In particular, an own slot containing `undefined` is initialized while a
 * missing slot is not.
 */
function hasByAddress(target, address, receiver, handler) {
    if (address.pathInfo.path in target)
        return true;
    const parentAddress = address.parentAddress;
    if (parentAddress === null)
        return false;
    const parentValue = getByAddress(target, parentAddress, receiver, handler);
    if (parentValue === null || (typeof parentValue !== "object" && typeof parentValue !== "function")) {
        return false;
    }
    const lastSegment = address.pathInfo.lastSegment;
    if (lastSegment === WILDCARD) {
        const index = address.listIndex?.index;
        return typeof index === "number" && index in parentValue;
    }
    return lastSegment in parentValue;
}

const swapInfoByStateAddress = new WeakMap();
function getSwapInfoByAddress(address) {
    return swapInfoByStateAddress.get(address) ?? null;
}
function setSwapInfoByAddress(address, swapInfo) {
    if (swapInfo === null) {
        swapInfoByStateAddress.delete(address);
    }
    else {
        swapInfoByStateAddress.set(address, swapInfo);
    }
}

const MAX_DEPENDENCY_DEPTH = 1000;
function getIndexes(listDiff, searchType) {
    switch (searchType) {
        case "old":
            return listDiff.oldIndexes;
        case "new":
            return listDiff.newIndexes;
        case "add":
            return listDiff.addIndexSet;
        case "change":
            return listDiff.changeIndexSet;
        case "delete":
            return listDiff.deleteIndexSet;
        default:
            if (config.debug) {
                console.log(`Invalid search type: ${searchType}`);
            }
            return [];
    }
}
function _walkExpandWildcard(context, currentWildcardIndex, parentListIndex) {
    const parentPath = context.wildcardParentPaths[currentWildcardIndex];
    const parentPathInfo = getPathInfo(parentPath);
    const parentAbsPathInfo = getAbsolutePathInfo(context.stateElement, parentPathInfo);
    const parentAddress = createStateAddress(parentPathInfo, parentListIndex);
    const parentAbsAddress = createAbsoluteStateAddress(parentAbsPathInfo, parentListIndex);
    const lastValue = getLastListValueByAbsoluteStateAddress(parentAbsAddress);
    const newValue = context.stateProxy[getByAddressSymbol](parentAddress);
    const listDiff = createListDiff(parentAddress.listIndex, lastValue, newValue);
    const loopIndexes = getIndexes(listDiff, context.searchType);
    if (currentWildcardIndex === context.wildcardPaths.length - 1) {
        context.targetListIndexes.push(...loopIndexes);
    }
    else {
        for (const listIndex of loopIndexes) {
            _walkExpandWildcard(context, currentWildcardIndex + 1, listIndex);
        }
    }
}
const EMPTY_INDEXES = [];
/**
 * 静的子展開で訪問する listIndex 群を選ぶ。"diff" でも次の場合は全行に倒す:
 * - diff に変化が一切見えない再代入（同一参照および内容同一コピーの再代入。
 *   `arr[0].v = 5; s.items = [...arr]` のような in-place 変異後のリフレッシュ
 *   イディオムは diff に映らないため、全行展開で従来挙動を保つ。
 *   削除だけの置換は除く — 残存行に変化は無く、集計はコンテナ動的エッジが担う）
 * - 他行を読む getter が検出されたリスト（隣接項目参照など。未変更行の派生値も変わりうる）
 */
function selectExpansionIndexes(context, sourcePath, _lastValue, _newValue, listDiff) {
    if (context.listExpansion === "full") {
        return { fullRows: listDiff.newIndexes, movedRows: null };
    }
    if (context.stateElement.crossRowListPaths?.has(sourcePath)) {
        return { fullRows: listDiff.newIndexes, movedRows: null };
    }
    if (listDiff.addIndexSet.size === 0 && listDiff.changeIndexSet.size === 0) {
        // 追加も移動も無い。削除も無ければ「変化が見えない再代入」= リフレッシュ意図
        if (listDiff.deleteIndexSet.size === 0) {
            return { fullRows: listDiff.newIndexes, movedRows: null };
        }
        // 削除のみ: 残存行は位置も値も不変なので展開しない
        return { fullRows: EMPTY_INDEXES, movedRows: null };
    }
    return { fullRows: listDiff.addIndexSet, movedRows: listDiff.changeIndexSet };
}
const EMPTY_PATH_INFOS = [];
/**
 * 位置だけが変わった行（movedRows）で展開すべきパス群を求める。
 * `${listPath}.*` の静的 subtree を辿り、$1 等を読んだ実績のある getter
 * （indexDependentGetterPaths）だけを返す。行の同一性・listIndex は保たれ
 * index 以外の入力が不変なので、index を読まない getter / 値パスは再評価不要。
 * 戻り値:
 * - IPathInfo[]（空可）: この各パスだけを行の listIndex で展開する
 * - null: ネストしたワイルドカード配下に index 依存 getter がある
 *   （listIndex の階数が合わず個別展開できない）→ 呼び出し側で行全体展開に倒す
 */
function getMovedRowExpansionPaths(context, wildcardPath, depPathInfo) {
    const indexGetters = context.stateElement.indexDependentGetterPaths;
    if (!indexGetters || indexGetters.size === 0) {
        return EMPTY_PATH_INFOS;
    }
    let result = null;
    const queue = [wildcardPath];
    const seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
        const path = queue[i];
        if (indexGetters.has(path)) {
            const pathInfo = getPathInfo(path);
            if (pathInfo.wildcardCount !== depPathInfo.wildcardCount) {
                return null;
            }
            (result ??= []).push(pathInfo);
        }
        const children = context.staticMap.get(path);
        if (children) {
            for (const child of children) {
                if (!seen.has(child)) {
                    seen.add(child);
                    queue.push(child);
                }
            }
        }
    }
    return result ?? EMPTY_PATH_INFOS;
}
function _walkDependency(context, startAddress, callback) {
    const stack = [{ address: startAddress, depth: 0 }];
    while (stack.length > 0) {
        const { address, depth } = stack.pop();
        if (depth > MAX_DEPENDENCY_DEPTH) {
            raiseError(`Maximum dependency depth of ${MAX_DEPENDENCY_DEPTH} exceeded. Possible circular dependency detected at path: ${address.pathInfo.path}`);
        }
        if (context.visited.has(address)) {
            continue;
        }
        context.visited.add(address);
        callback(address);
        const sourcePath = address.pathInfo.path;
        const nextDepth = depth + 1;
        // 依存アドレスを逆順でpushするための一時バッファ
        const nextEntries = [];
        /**
         * パスから依存関係をたどる
         * users.*.name <= users.* <= users
         * ただし、users がリストであれば users.* の依存関係は展開する
         */
        const staticDeps = context.staticMap.get(sourcePath);
        if (staticDeps) {
            for (const dep of staticDeps) {
                const depPathInfo = getPathInfo(dep);
                if (context.listPathSet.has(sourcePath) && depPathInfo.lastSegment === WILDCARD) {
                    //expand indexes
                    const newValue = context.stateProxy[getByAddressSymbol](address);
                    const absPathInfo = getAbsolutePathInfo(context.stateElement, address.pathInfo);
                    const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
                    const lastValue = getLastListValueByAbsoluteStateAddress(absAddress);
                    const listDiff = createListDiff(address.listIndex, lastValue, newValue);
                    const selection = selectExpansionIndexes(context, sourcePath, lastValue, newValue, listDiff);
                    for (const listIndex of selection.fullRows) {
                        const depAddress = createStateAddress(depPathInfo, listIndex);
                        context.result.add(depAddress);
                        nextEntries.push({ address: depAddress, depth: nextDepth });
                    }
                    if (selection.movedRows !== null) {
                        const movedPathInfos = getMovedRowExpansionPaths(context, dep, depPathInfo);
                        if (movedPathInfos === null) {
                            // ネスト配下に index 依存 getter: 安全側で行全体を展開（従来挙動）
                            for (const listIndex of selection.movedRows) {
                                const depAddress = createStateAddress(depPathInfo, listIndex);
                                context.result.add(depAddress);
                                nextEntries.push({ address: depAddress, depth: nextDepth });
                            }
                        }
                        else if (movedPathInfos.length > 0) {
                            // 位置のみ変わった行は index 依存 getter のパスだけを展開する
                            for (const listIndex of selection.movedRows) {
                                for (const pathInfo of movedPathInfos) {
                                    const depAddress = createStateAddress(pathInfo, listIndex);
                                    context.result.add(depAddress);
                                    nextEntries.push({ address: depAddress, depth: nextDepth });
                                }
                            }
                        }
                        // movedPathInfos が空: index を読む getter が subtree に無い =
                        // 位置のみ変わった行の値は不変。展開・dirty 化とも不要。
                    }
                }
                else {
                    const depAddress = createStateAddress(depPathInfo, address.listIndex);
                    context.result.add(depAddress);
                    nextEntries.push({ address: depAddress, depth: nextDepth });
                }
            }
        }
        /**
         * 動的依存関係をたどる
         * 動的依存関係は、getterの実行時に決定される
         *
         * source,           target
         *
         * products.*.price => products.*.tax
         * get "products.*.tax"() { return this["products.*.price"] * 0.1; }
         *
         * products.*.price => products.summary
         * get "products.summary"() { return this.$getAll("products.*.price", []).reduce(sum); }
         *
         * categories.*.name => categories.*.products.*.categoryName
         * get "categories.*.products.*.categoryName"() { return this["categories.*.name"]; }
         */
        const dynamicDeps = context.dynamicMap.get(sourcePath);
        if (dynamicDeps) {
            for (const dep of dynamicDeps) {
                const depPathInfo = getPathInfo(dep);
                const listIndexes = [];
                if (depPathInfo.wildcardCount > 0) {
                    // ワイルドカードを含む依存関係の処理
                    // 同じ親を持つかをパスの集合積で判定する
                    // polyfills.tsにてSetのintersectionメソッドを定義している
                    const wildcardLen = calcWildcardLen(address.pathInfo, depPathInfo);
                    const expandable = (depPathInfo.wildcardCount - wildcardLen) >= 1;
                    if (expandable) {
                        let listIndex;
                        if (wildcardLen > 0) {
                            // categories.*.name => categories.*.products.*.categoryName
                            // ワイルドカードを含む同じ親（products.*）を持つのが、
                            // さらに下位にワイルドカードがあるので展開する
                            if (address.listIndex === null) {
                                raiseError(`Cannot expand dynamic dependency with wildcard for non-list address: ${address.pathInfo.path}`);
                            }
                            listIndex = address.listIndex.at(wildcardLen - 1);
                        }
                        else {
                            // selectedIndex => items.*.selected
                            // 同じ親を持たない場合はnullから開始
                            listIndex = null;
                        }
                        const expandContext = {
                            stateElement: context.stateElement,
                            targetListIndexes: [],
                            wildcardPaths: depPathInfo.wildcardPaths,
                            wildcardParentPaths: depPathInfo.wildcardParentPaths,
                            stateProxy: context.stateProxy,
                            searchType: context.searchType,
                        };
                        _walkExpandWildcard(expandContext, wildcardLen, listIndex);
                        listIndexes.push(...expandContext.targetListIndexes);
                    }
                    else {
                        // products.*.price => products.*.tax
                        // ワイルドカードを含む同じ親（products.*）を持つので、リストインデックスは引き継ぐ
                        if (address.listIndex === null) {
                            raiseError(`Cannot expand dynamic dependency with wildcard for non-list address: ${address.pathInfo.path}`);
                        }
                        const listIndex = address.listIndex.at(wildcardLen - 1);
                        listIndexes.push(listIndex);
                    }
                }
                else {
                    // products.*.tax => currentTaxRate
                    // 同じ親を持たないので、リストインデックスはnull
                    listIndexes.push(null);
                }
                for (const listIndex of listIndexes) {
                    const depAddress = createStateAddress(depPathInfo, listIndex);
                    context.result.add(depAddress);
                    nextEntries.push({ address: depAddress, depth: nextDepth });
                }
            }
        }
        // 逆順でpushして、元の再帰と同じ探索順序を保つ
        for (let i = nextEntries.length - 1; i >= 0; i--) {
            stack.push(nextEntries[i]);
        }
    }
}
function walkDependency(stateName, stateElement, startAddress, staticDependency, dynamicDependency, listPathSet, stateProxy, searchType, callback, options) {
    // 依存ゼロの葉パス（staticMap / dynamicMap にエントリ無し）は context や Set を
    // 割り当てず、開始アドレスの callback だけで完結する。リスト行の値書き込み
    // （update ホットパス）は set 毎にここを通る。開始アドレスへの callback は
    // 従来の walk 先頭と同一で、戻り値（依存アドレス群）も従来どおり空。
    const startPath = startAddress.pathInfo.path;
    if (!staticDependency.has(startPath) && !dynamicDependency.has(startPath)) {
        callback(startAddress);
        return [];
    }
    const context = {
        stateElement: stateElement,
        staticMap: staticDependency,
        dynamicMap: dynamicDependency,
        result: new Set(),
        listPathSet: listPathSet,
        visited: new Set(),
        stateProxy: stateProxy,
        searchType: searchType,
        listExpansion: options?.listExpansion ?? "full",
    };
    _walkDependency(context, startAddress, callback);
    return Array.from(context.result);
}

/**
 * setByAddress.ts
 *
 * Stateの内部APIとして、アドレス情報（IStateAddress）を指定して
 * 状態オブジェクト（target）に値を設定するための関数（setByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を設定（多重ループやワイルドカードにも対応）
 * - getter/setter経由で値設定時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathInfoやlistIndexを辿って再帰的に値を設定
 * - 設定後はupdater.enqueueUpdateAddressで更新情報を登録
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値設定を実現
 * - finallyで必ず更新情報を登録し、再描画や依存解決に利用
 * - getter/setter経由のスコープ切り替えも考慮した設計
 */
// Phase 3: 書き込み時点の因果 context を update record に付与する。
// binding 経由の書き込みは呼び出し元の dynamic scope から context を引き継ぎ、
// binding 外からの API update は新しい transaction を開始する（設計書 §4 規則 1）。
// 依存 walk で enqueue される派生アドレスも同じ書き込みの因果に属する。
function notifyWrite(address, absAddress, receiver, handler) {
    const propagationContext = config.enablePropagationContext
        ? (getCurrentPropagationContext() ?? beginPropagationTransaction(-1))
        : null;
    const updater = getUpdater();
    updater.enqueueAbsoluteAddress(absAddress, propagationContext);
    // 依存関係のあるキャッシュを無効化（ダーティ）、更新対象として登録
    walkDependency(handler.stateName, handler.stateElement, address, handler.stateElement.staticDependency, handler.stateElement.dynamicDependency, handler.stateElement.listPaths, receiver, "new", (depAddress) => {
        // キャッシュを無効化（ダーティ）
        if (depAddress === address)
            return;
        const absDepPathInfo = getAbsolutePathInfo(handler.stateElement, depAddress.pathInfo);
        const absDepAddress = createAbsoluteStateAddress(absDepPathInfo, depAddress.listIndex);
        dirtyCacheEntryByAbsoluteStateAddress(absDepAddress);
        // 更新対象として登録
        updater.enqueueAbsoluteAddress(absDepAddress, propagationContext);
    }, 
    // リスト置換時は追加行・位置変更行のみ展開する（未変更行の再訪を省く。
    // $postUpdate の手動リフレッシュは従来通り全行展開のまま）
    { listExpansion: "diff" });
}
function _setByAddress(target, address, absAddress, value, receiver, handler) {
    try {
        if (address.pathInfo.path in target) {
            if (handler.stateElement.setterPaths.has(address.pathInfo.path)) {
                // setterの中で参照の可能性があるので、addressをプッシュする。
                // setter は命令的な代入であって派生（getter）ではないため、実行中の
                // 読み取り（同値ガードの旧値読み・$1 参照等）で依存を張らない。
                // アクセサペア（get/set 同名パス）では、抑止しないと setter 内の内部
                // 書き込みの同値ガード読みが「getter の依存」として誤登録される。
                handler.pushAddress(address);
                handler.beginUntrack();
                try {
                    return Reflect.set(target, address.pathInfo.path, value, receiver);
                }
                finally {
                    handler.endUntrack();
                    handler.popAddress();
                }
            }
            else {
                return Reflect.set(target, address.pathInfo.path, value);
            }
        }
        else {
            const parentAddress = address.parentAddress;
            if (parentAddress === null) {
                return Reflect.set(target, address.pathInfo.path, value);
            }
            const parentValue = getByAddress(target, parentAddress, receiver, handler);
            const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
            if (lastSegment === WILDCARD) {
                const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined path: ${address.pathInfo.path}`);
                return Reflect.set(parentValue, index, value);
            }
            else {
                return Reflect.set(parentValue, lastSegment, value);
            }
        }
    }
    finally {
        notifyWrite(address, absAddress, receiver, handler);
    }
}
function _setByAddressWithSwap(target, address, absAddress, value, receiver, handler) {
    // elementsの場合はswapInfoを準備
    let parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
    let swapInfo = getSwapInfoByAddress(parentAddress);
    if (swapInfo === null) {
        const parentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
        const listIndexes = getListIndexesByList(parentValue) ?? [];
        swapInfo = {
            value: [...parentValue], listIndexes: [...listIndexes]
        };
        setSwapInfoByAddress(parentAddress, swapInfo);
    }
    try {
        return _setByAddress(target, address, absAddress, value, receiver, handler);
    }
    finally {
        const index = swapInfo.value.indexOf(value);
        const currentParentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
        const currentListIndexes = Array.isArray(currentParentValue) ? (getListIndexesByList(currentParentValue) ?? []) : [];
        const curIndex = address.listIndex.index;
        const listIndex = (index !== -1) ?
            swapInfo.listIndexes[index] :
            createListIndex(parentAddress.listIndex, -1);
        currentListIndexes[curIndex] = listIndex;
        // 重複チェック
        // 重複していない場合、swapが完了したとみなし、インデックスを更新
        const listValueSet = new Set(currentParentValue);
        if (listValueSet.size === swapInfo.value.length) {
            for (let i = 0; i < currentListIndexes.length; i++) {
                currentListIndexes[i].index = i;
            }
            // 完了したのでswapInfoを削除
            setSwapInfoByAddress(parentAddress, null);
        }
    }
}
function setByAddress(target, address, value, receiver, handler) {
    const stateElement = handler.stateElement;
    const path = address.pathInfo.path;
    // --- fast path: 宣言済み getter/setter でも swap 対象でもない、親を持つ葉パス ---
    // 従来は same-value guard の値読み・hasByAddress・実書き込みがそれぞれ親チェーンを
    // 解決していた（キャッシュヒットでも getByAddress 呼び出しの固定費 ×3）。
    // 親を 1 回だけ解決し、同じ親オブジェクトに対して guard 判定と Reflect.set を行う。
    // 非オブジェクト親などの例外形は従来経路へ倒し、挙動差を作らない。
    if (!(path in target) && address.parentAddress !== null && !stateElement.elementPaths.has(path)) {
        const parentValue = getByAddress(target, address.parentAddress, receiver, handler);
        if (typeof parentValue === "object" && parentValue !== null) {
            // ワイルドカード末尾で listIndex が無い不正アドレスは、従来どおり
            // 書き込み時（enqueue 済みの try 内）に raiseError する → key は undefined のまま持ち回す
            const lastSegment = address.pathInfo.lastSegment;
            const key = lastSegment === WILDCARD
                ? address.listIndex?.index
                : lastSegment;
            let devOldValue;
            let devHasOldValue = false;
            if (config.sameValueGuard && (value === null || typeof value !== "object")) {
                // hasByAddress と同じ「初期化済みスロットか」判定（undefined 格納と未初期化を区別）
                const has = key !== undefined && key in parentValue;
                const oldValue = key !== undefined ? parentValue[key] : undefined;
                if (has && Object.is(oldValue, value)) {
                    return true;
                }
                devOldValue = oldValue;
                devHasOldValue = true;
            }
            const cacheable = address.pathInfo.wildcardCount > 0 ||
                stateElement.getterPaths.has(path);
            const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
            const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
            if (devtoolsSink !== null) {
                devtoolsSink({
                    type: "state:write",
                    absoluteAddress: absAddress,
                    value,
                    oldValue: devOldValue,
                    hasOldValue: devHasOldValue,
                });
            }
            try {
                if (key === undefined) {
                    raiseError(`address.listIndex?.index is undefined path: ${path}`);
                }
                return Reflect.set(parentValue, key, value);
            }
            finally {
                notifyWrite(address, absAddress, receiver, handler);
                if (cacheable) {
                    setCacheEntryByAbsoluteStateAddress(absAddress, {
                        value: value,
                        dirty: false
                    });
                }
                // DCC bindable イベントディスパッチ
                const eventName = stateElement.bindableEventMap[path];
                if (eventName) {
                    const rootNode = stateElement.rootNode;
                    if (rootNode instanceof ShadowRoot) {
                        rootNode.host.dispatchEvent(new CustomEvent(eventName, {
                            detail: value,
                            bubbles: true,
                        }));
                    }
                }
            }
        }
    }
    // --- end fast path ---
    // --- same-value guard (config.sameValueGuard・既定 ON) ---
    // primitive 値かつ Object.is 同値なら、set / enqueue / walkDependency / DOM 適用 /
    // $updatedCallback / DCC イベントを丸ごとスキップ（標準的なリアクティブ no-op）。
    // 参照型(object/array)は in-place mutation 取りこぼし防止のため素通し（ガードしない）。
    // devtools write イベント用: guard が既に取得した旧値のみ流用する
    // （参照型のために追加の get はしない — protocol §4.2）
    let devOldValue;
    let devHasOldValue = false;
    if (config.sameValueGuard && (value === null || typeof value !== "object")) {
        const oldValue = getByAddress(target, address, receiver, handler);
        if (hasByAddress(target, address, receiver, handler) && Object.is(oldValue, value)) {
            return true;
        }
        devOldValue = oldValue;
        devHasOldValue = true;
    }
    // --- end same-value guard ---
    const isSwappable = stateElement.elementPaths.has(address.pathInfo.path);
    const cacheable = address.pathInfo.wildcardCount > 0 ||
        stateElement.getterPaths.has(address.pathInfo.path);
    const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
    const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
    if (devtoolsSink !== null) {
        devtoolsSink({
            type: "state:write",
            absoluteAddress: absAddress,
            value,
            oldValue: devOldValue,
            hasOldValue: devHasOldValue,
        });
    }
    try {
        if (isSwappable) {
            return _setByAddressWithSwap(target, address, absAddress, value, receiver, handler);
        }
        else {
            return _setByAddress(target, address, absAddress, value, receiver, handler);
        }
    }
    finally {
        if (cacheable) {
            setCacheEntryByAbsoluteStateAddress(absAddress, {
                value: value,
                dirty: false
            });
        }
        // DCC bindable イベントディスパッチ
        const eventName = stateElement.bindableEventMap[address.pathInfo.path];
        if (eventName) {
            const rootNode = stateElement.rootNode;
            if (rootNode instanceof ShadowRoot) {
                rootNode.host.dispatchEvent(new CustomEvent(eventName, {
                    detail: value,
                    bubbles: true,
                }));
            }
        }
    }
}

/**
 * resolve.ts
 *
 * StateClassのAPIとして、パス（path）とインデックス（indexes）を指定して
 * Stateの値を取得・設定するための関数（resolve）の実装です。
 *
 * 主な役割:
 * - 文字列パス（path）とインデックス配列（indexes）から、該当するState値の取得・設定を行う
 * - ワイルドカードや多重ループを含むパスにも対応
 * - value未指定時は取得（getByRef）、指定時は設定（setByRef）を実行
 *
 * 設計ポイント:
 * - getStructuredPathInfoでパスを解析し、ワイルドカード階層ごとにリストインデックスを解決
 * - handler.engine.getListIndexesSetで各階層のリストインデックス集合を取得
 * - getByRef/setByRefで値の取得・設定を一元的に処理
 * - 柔軟なバインディングやAPI経由での利用が可能
 */
function resolve(target, _prop, receiver, handler) {
    return (path, indexes, value) => {
        const pathInfo = getPathInfo(path);
        if (handler.addressStackLength > 0) {
            const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
            const stateElement = handler.stateElement;
            if (lastInfo !== null && lastInfo.path !== pathInfo.path) {
                // gettersに含まれる場合は依存関係を登録
                if (stateElement.getterPaths.has(lastInfo.path)) {
                    stateElement.addDynamicDependency(pathInfo.path, lastInfo.path);
                }
            }
        }
        if (pathInfo.wildcardParentPathInfos.length > indexes.length) {
            raiseError(`indexes length is insufficient: ${path}`);
        }
        // ワイルドカード階層ごとにListIndexを解決していく
        let listIndex = null;
        for (let i = 0; i < pathInfo.wildcardParentPathInfos.length; i++) {
            const wildcardParentPathInfo = pathInfo.wildcardParentPathInfos[i];
            const wildcardAddress = createStateAddress(wildcardParentPathInfo, listIndex);
            const tmpValue = getByAddress(target, wildcardAddress, receiver, handler);
            const listIndexes = getListIndexesByList(tmpValue);
            if (listIndexes == null) {
                raiseError(`ListIndexes not found: ${wildcardParentPathInfo.path}`);
            }
            const index = indexes[i];
            listIndex = listIndexes[index] ??
                raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
        }
        // ToDo:WritableかReadonlyかを判定して適切なメソッドを呼び出す
        const address = createStateAddress(pathInfo, listIndex);
        const hasSetValue = typeof value !== "undefined";
        if (!hasSetValue) {
            return getByAddress(target, address, receiver, handler);
        }
        else {
            setByAddress(target, address, value, receiver, handler);
        }
    };
}

/**
 * getAllReadonly
 *
 * ワイルドカードを含む State パスから、対象となる全要素を配列で取得する。
 * Throws: LIST-201（インデックス未解決）、BIND-201（ワイルドカード情報不整合）
 */
// ToDo: IAbsoluteStateAddressに変更する
const lastValueByListAddress = new WeakMap();
function getAll(target, prop, receiver, handler) {
    const resolveFn = resolve(target, prop, receiver, handler);
    return (path, indexes) => {
        const newValueByAddress = new Map();
        const pathInfo = getPathInfo(path);
        if (handler.addressStackLength > 0) {
            const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
            const stateElement = handler.stateElement;
            if (lastInfo !== null && lastInfo.path !== pathInfo.path) {
                // gettersに含まれる場合は依存関係を登録
                if (stateElement.getterPaths.has(lastInfo.path)) {
                    stateElement.addDynamicDependency(pathInfo.path, lastInfo.path);
                }
            }
        }
        if (typeof indexes === "undefined") {
            for (let i = 0; i < pathInfo.wildcardParentPathInfos.length; i++) {
                const wildcardPattern = pathInfo.wildcardParentPathInfos[i];
                const listIndex = getContextListIndex(handler, wildcardPattern.path);
                if (listIndex) {
                    indexes = listIndex.indexes;
                    break;
                }
            }
            if (typeof indexes === "undefined") {
                indexes = [];
            }
        }
        const walkWildcardPattern = (wildcardParentPathInfos, wildcardIndexPos, listIndex, indexes, indexPos, parentIndexes, results) => {
            const wildcardParentPathInfo = wildcardParentPathInfos[wildcardIndexPos] ?? null;
            if (wildcardParentPathInfo === null) {
                results.push(parentIndexes);
                return;
            }
            const wildcardAddress = createStateAddress(wildcardParentPathInfo, listIndex);
            const oldValue = lastValueByListAddress.get(wildcardAddress);
            const newValue = getByAddress(target, wildcardAddress, receiver, handler);
            const listDiff = createListDiff(listIndex, oldValue, newValue);
            const listIndexes = listDiff.newIndexes;
            const index = indexes[indexPos] ?? null;
            newValueByAddress.set(wildcardAddress, newValue);
            if (index === null) {
                for (let i = 0; i < listIndexes.length; i++) {
                    const listIndex = listIndexes[i];
                    walkWildcardPattern(wildcardParentPathInfos, wildcardIndexPos + 1, listIndex, indexes, indexPos + 1, parentIndexes.concat(listIndex.index), results);
                }
            }
            else {
                const listIndex = listIndexes[index] ??
                    raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
                if ((wildcardIndexPos + 1) < wildcardParentPathInfos.length) {
                    walkWildcardPattern(wildcardParentPathInfos, wildcardIndexPos + 1, listIndex, indexes, indexPos + 1, parentIndexes.concat(listIndex.index), results);
                }
                else {
                    // 最終ワイルドカード層まで到達しているので、結果を確定
                    results.push(parentIndexes.concat(listIndex.index));
                }
            }
        };
        const resultIndexes = [];
        walkWildcardPattern(pathInfo.wildcardParentPathInfos, 0, null, indexes, 0, [], resultIndexes);
        const resultValues = [];
        for (let i = 0; i < resultIndexes.length; i++) {
            resultValues.push(resolveFn(pathInfo.path, resultIndexes[i]));
        }
        for (const [address, newValue] of newValueByAddress.entries()) {
            lastValueByListAddress.set(address, newValue);
        }
        return resultValues;
    };
}

/**
 * getListIndex.ts
 *
 * StateClassの内部APIとして、パス情報（IResolvedAddress）から
 * 対応するリストインデックス（IListIndex）を取得する関数です。
 *
 * 主な役割:
 * - パスのワイルドカード種別（context/all/partial/none）に応じてリストインデックスを解決
 * - context型は現在のループコンテキストからリストインデックスを取得
 * - all型は各階層のリストインデックス集合からインデックスを辿って取得
 * - partial型やnone型は未実装またはnullを返す
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループ、ネストした配列バインディングに柔軟に対応
 * - getListIndexesByListで各階層のリストインデックス集合を取得
 * - エラー時はraiseErrorで例外を投げる
 */
function getListIndex(target, resolvedAddress, receiver, handler) {
    const pathInfo = resolvedAddress.pathInfo;
    switch (resolvedAddress.wildcardType) {
        case "none":
            return null;
        case "context": {
            const lastWildcardPath = pathInfo.wildcardPaths.at(-1) ??
                raiseError(`lastWildcardPath is null: ${resolvedAddress.pathInfo.path}`);
            return getContextListIndex(handler, lastWildcardPath) ??
                raiseError(`ListIndex not found: ${resolvedAddress.pathInfo.path}`);
        }
        case "all": {
            let parentListIndex = null;
            for (let i = 0; i < resolvedAddress.pathInfo.wildcardCount; i++) {
                const wildcardParentPathInfo = resolvedAddress.pathInfo.wildcardParentPathInfos[i] ??
                    raiseError(`wildcardParentPathInfo is null: ${resolvedAddress.pathInfo.path}`);
                const wildcardParentAddress = createStateAddress(wildcardParentPathInfo, parentListIndex);
                const wildcardParentValue = getByAddress(target, wildcardParentAddress, receiver, handler);
                const wildcardParentListIndexes = getListIndexesByList(wildcardParentValue) ??
                    raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
                const wildcardIndex = resolvedAddress.wildcardIndexes[i] ??
                    raiseError(`wildcardIndex is null: ${resolvedAddress.pathInfo.path}`);
                parentListIndex = wildcardParentListIndexes[wildcardIndex] ??
                    raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
            }
            return parentListIndex;
        }
        case "partial": {
            raiseError(`Partial wildcard type is not supported yet: ${resolvedAddress.pathInfo.path}`);
        }
    }
}

function postUpdate(target, _prop, receiver, handler) {
    const stateElement = handler.stateElement;
    return (path) => {
        const resolvedAddress = getResolvedAddress(path);
        const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
        const address = createStateAddress(resolvedAddress.pathInfo, listIndex);
        const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
        const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
        const updater = getUpdater();
        updater.enqueueAbsoluteAddress(absAddress);
        // 依存関係のあるキャッシュを無効化（ダーティ）、更新対象として登録
        walkDependency(handler.stateName, handler.stateElement, address, handler.stateElement.staticDependency, handler.stateElement.dynamicDependency, handler.stateElement.listPaths, receiver, "new", (depAddress) => {
            // キャッシュを無効化（ダーティ）
            const absDepPathInfo = getAbsolutePathInfo(stateElement, depAddress.pathInfo);
            const absDepAddress = createAbsoluteStateAddress(absDepPathInfo, depAddress.listIndex);
            dirtyCacheEntryByAbsoluteStateAddress(absDepAddress);
            // 更新対象として登録
            updater.enqueueAbsoluteAddress(absDepAddress);
        });
    };
}

/**
 * trackDependency.ts
 *
 * StateClassのAPIとして、getterチェーン中に参照されたパス間の
 * 依存関係を動的に登録するための関数（trackDependency）の実装です。
 *
 * 主な役割:
 * - 現在解決中のStatePropertyRef（lastRefStack）を取得
 * - pathManager.gettersに登録されているgetterの場合のみ依存を追跡
 * - 自身と同一パターンでない参照に対してaddDynamicDependencyを呼び出す
 *
 * 設計ポイント:
 * - lastRefStackが存在しない場合はSTATE-202エラーを発生させる
 * - getter同士の再帰（自己依存）は登録しない
 * - 動的依存はpathManagerに集約し、キャッシュの無効化に利用する
 */
function trackDependency(_target, _prop, _receiver, handler) {
    return (path) => {
        if (handler.addressStackLength === 0) {
            raiseError(`No active state reference to track dependency for path "${path}".`);
        }
        const lastInfo = handler.lastAddressStack?.pathInfo ??
            raiseError('Internal error: lastAddressStack is null');
        const stateElement = handler.stateElement;
        if (handler.stateElement.getterPaths.has(lastInfo.path) &&
            lastInfo.path !== path) {
            stateElement.addDynamicDependency(path, lastInfo.path);
        }
    };
}

/**
 * untrackDependency.ts
 *
 * StateClass の API として、コールバック実行中の依存追跡を抑止する関数
 * （$untrackDependency）の実装です。$trackDependency（明示的な依存登録）と
 * 対称の「明示的な依存抑止」API。
 *
 * 主な役割:
 * - fn 実行中、checkDependency の動的依存登録と $1 インデックス依存の記録を抑止
 * - fn の戻り値をそのまま返す（値の読み取り自体は通常どおり行われる）
 *
 * 設計ポイント:
 * - スコープはハンドラ単位のカウンタ（ネスト可）で管理し、finally で必ず復元する
 * - 典型例: リスト行 getter が「行の外の単一値」を読みたいが、その値の変更で
 *   全行を再評価させたくない場合（選択インデックス等）。書き手側が該当行へ
 *   直接書き込むことで、必要な行だけが更新される
 */
function untrackDependency(_target, _prop, _receiver, handler) {
    return (fn) => {
        handler.beginUntrack();
        try {
            return fn();
        }
        finally {
            handler.endUntrack();
        }
    };
}

/**
 * updatedCallback.ts
 *
 * Utility function to invoke the StateClass lifecycle hook "$updatedCallback".
 *
 * Main responsibilities:
 * - Invokes $updatedCallback method if defined on the object (target)
 * - Callback is invoked with target's this context, passing IReadonlyStateProxy (receiver) as argument
 * - Executable as async function (await compatible)
 *
 * Design points:
 * - Safely retrieves $updatedCallback property using Reflect.get
 * - Does nothing if the callback doesn't exist
 * - Used for lifecycle management and update handling logic
 */
/**
 * Invokes the $updatedCallback lifecycle hook if defined on the target.
 * Aggregates updated paths and their indexes before passing to the callback.
 * @param target - Target object to check for callback
 * @param refs - Array of state property references that were updated
 * @param receiver - State proxy to pass as this context
 * @param handler - State handler (unused but part of signature)
 * @returns Promise or void depending on callback implementation
 */
function updatedCallback(target, refs, receiver, handler) {
    const callback = Reflect.get(target, STATE_UPDATED_CALLBACK_NAME);
    if (typeof callback === "function") {
        const paths = new Set();
        // ToDo:現状では1階層のみのワイルドカードに対応。多階層対応は後回し
        const indexesListByPath = {};
        for (const ref of refs) {
            const pathInfo = ref.absolutePathInfo.pathInfo;
            let pathName;
            if (ref.absolutePathInfo.stateName === handler.stateName) {
                pathName = pathInfo.path;
            }
            else {
                pathName = pathInfo.path + "@" + ref.absolutePathInfo.stateName;
            }
            paths.add(pathName);
            if (pathInfo.wildcardCount > 0) {
                const indexes = ref.listIndex.indexes ?? [];
                const indexesList = indexesListByPath[pathName];
                if (typeof indexesList === "undefined") {
                    indexesListByPath[pathName] = [indexes];
                }
                else {
                    indexesList.push(indexes);
                }
            }
        }
        return callback.call(receiver, Array.from(paths), indexesListByPath);
    }
}

/**
 * setLoopContext.ts
 *
 * StateClassの内部APIとして、ループコンテキスト（ILoopContext）を一時的に設定し、
 * 指定した同期/非同期コールバックをそのスコープ内で実行するための関数です。
 *
 * 主な役割:
 * - handler.loopContextにループコンテキストを一時的に設定
 * - 既にループコンテキストが設定されている場合はエラーを投げる
 * - 常にスコープを設定しコールバックを実行
 * - finallyで必ずloopContextをnullに戻し、スコープ外への影響を防止
 *
 * 設計ポイント:
 * - ループバインディングや多重ループ時のスコープ管理を安全に行う
 * - finallyで状態復元を保証し、例外発生時も安全
 * - 非同期処理にも対応
 */
function _setLoopContext(handler, loopContext, callback) {
    if (typeof handler.loopContext !== "undefined") {
        raiseError('already in loop context');
    }
    handler.setLoopContext(loopContext);
    try {
        handler.pushAddress(loopContext);
        try {
            return callback();
        }
        finally {
            handler.popAddress();
        }
    }
    finally {
        handler.clearLoopContext();
    }
}
function setLoopContext(handler, loopContext, callback) {
    return _setLoopContext(handler, loopContext, callback);
}
async function setLoopContextAsync(handler, loopContext, callback) {
    return await _setLoopContext(handler, loopContext, callback);
}

/**
 * get.ts
 *
 * StateClassのProxyトラップとして、プロパティアクセス時の値取得処理を担う関数（get）の実装です。
 *
 * 主な役割:
 * - 文字列プロパティの場合、特殊プロパティ（$1〜、$stateElement, $getAll, $postUpdate,
 *   $resolve, $trackDependency, $command, $streamStatus, $streamError）に応じた値やAPIを返却
 * - 通常のプロパティはgetResolvedPathInfoでパス情報を解決し、getListIndexでリストインデックスを取得
 * - getByRefで構造化パス・リストインデックスに対応した値を取得
 * - シンボルプロパティの場合はhandler.callableApi経由でAPIを呼び出し
 * - それ以外はReflect.getで通常のプロパティアクセスを実行
 *
 * 設計ポイント:
 * - $1〜$128（MAX_WILDCARD_DEPTH）は直近のStatePropertyRefのリストインデックス値を返す特殊プロパティ
 * - $getAll, $resolve 等はAPI関数を、$command / $streamStatus / $streamError は名前空間を返す
 * - 通常のプロパティアクセスもバインディングや多重ループに対応
 * - シンボルAPIやReflect.getで拡張性・互換性も確保
 */
// `$streamStatus.<name>` / `$streamError.<name>` の dotted パス判定用プレフィックス
const STREAM_STATUS_PATH_PREFIX = `${STATE_STREAM_STATUS_NAMESPACE_NAME}${DELIMITER}`;
const STREAM_ERROR_PATH_PREFIX = `${STATE_STREAM_ERROR_NAMESPACE_NAME}${DELIMITER}`;
// symbol API のクロージャは handler（= proxy と 1:1、target/receiver 不変）ごとに
// 使い回す。drain の getValue が binding ごとに getByAddressSymbol を引くため、
// 毎回の新規クロージャ生成が GC 圧・固定費になっていた。
const symbolApiCacheByHandler = new WeakMap();
function getSymbolApiCache(handler) {
    let cache = symbolApiCacheByHandler.get(handler);
    if (typeof cache === "undefined") {
        cache = new Map();
        symbolApiCacheByHandler.set(handler, cache);
    }
    return cache;
}
function get(target, prop, receiver, handler) {
    const index = INDEX_BY_INDEX_NAME[prop];
    if (typeof index !== "undefined") {
        if (handler.addressStackLength === 0) {
            raiseError(`No active state reference to get list index for "${prop.toString()}".`);
        }
        const lastAddress = handler.lastAddressStack;
        // getter 評価中のインデックス読み取りを記録する。位置だけが変わった行
        // （listDiff.changeIndexSet）は index 以外の入力が不変なので、walkDependency の
        // 静的子展開を「インデックスを読んだ getter の subtree」に限定できる。
        // $untrackDependency スコープ中／setter 実行中は記録しない。
        const lastInfo = lastAddress?.pathInfo;
        if (lastInfo && !handler.untracking && handler.stateElement?.getterPaths.has(lastInfo.path)) {
            handler.stateElement.addIndexDependentGetterPath?.(lastInfo.path);
        }
        const listIndex = lastAddress?.listIndex;
        return listIndex?.indexes[index] ?? raiseError(`ListIndex not found: ${prop.toString()}`);
    }
    if (typeof prop === "string") {
        if (prop[0] === '$') {
            switch (prop) {
                case "$stateElement": {
                    return handler.stateElement;
                }
                case "$getAll": {
                    return (path, indexes) => {
                        return getAll(target, prop, receiver, handler)(path, indexes);
                    };
                }
                case "$postUpdate": {
                    return (path) => {
                        return postUpdate(target, prop, receiver, handler)(path);
                    };
                }
                case "$resolve": {
                    return (path, indexes, value) => {
                        return resolve(target, prop, receiver, handler)(path, indexes, value);
                    };
                }
                case "$trackDependency": {
                    return (path) => {
                        return trackDependency(target, prop, receiver, handler)(path);
                    };
                }
                case "$untrackDependency": {
                    return (fn) => {
                        return untrackDependency(target, prop, receiver, handler)(fn);
                    };
                }
                case STATE_COMMAND_NAMESPACE_NAME: {
                    return getCommandNamespace(handler.stateElement);
                }
                case STATE_STREAM_STATUS_NAMESPACE_NAME: {
                    return getStreamStatusNamespace(handler.stateElement);
                }
                case STATE_STREAM_ERROR_NAMESPACE_NAME: {
                    return getStreamErrorNamespace(handler.stateElement);
                }
            }
            // switch 不一致の $ プロパティのうち、`$streamStatus.<name>` / `$streamError.<name>`
            // の dotted パスだけは通常のパス解決（getByAddress）へフォールスルーさせる。
            // これが computed（getter）内での依存追跡付き読み取りの正規形
            // （checkDependency が getter スコープで動的依存を登録し、$postUpdate の
            //  walkDependency で computed が無効化される、docs/state-streams-design.md §4-3）。
            // それ以外の未知 $ プロパティは従来どおり undefined を返す。
            if (!prop.startsWith(STREAM_STATUS_PATH_PREFIX) && !prop.startsWith(STREAM_ERROR_PATH_PREFIX)) {
                return undefined;
            }
        }
        const resolvedAddress = getResolvedAddress(prop);
        const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
        const stateAddress = createStateAddress(resolvedAddress.pathInfo, listIndex);
        return getByAddress(target, stateAddress, receiver, handler);
    }
    else if (typeof prop === "symbol") {
        const cache = getSymbolApiCache(handler);
        const cached = cache.get(prop);
        if (typeof cached !== "undefined") {
            return cached;
        }
        let api;
        switch (prop) {
            case setLoopContextAsyncSymbol: {
                api = (loopContext, callback = async () => { }) => {
                    return setLoopContextAsync(handler, loopContext, callback);
                };
                break;
            }
            case setLoopContextSymbol: {
                api = (loopContext, callback = () => { }) => {
                    return setLoopContext(handler, loopContext, callback);
                };
                break;
            }
            case getByAddressSymbol: {
                api = (address) => {
                    return getByAddress(target, address, receiver, handler);
                };
                break;
            }
            case hasByAddressSymbol: {
                api = (address) => {
                    return hasByAddress(target, address, receiver, handler);
                };
                break;
            }
            case setByAddressSymbol: {
                api = (address, value) => {
                    return setByAddress(target, address, value, receiver, handler);
                };
                break;
            }
            case connectedCallbackSymbol: {
                api = () => {
                    return connectedCallback(target, connectedCallbackSymbol, receiver);
                };
                break;
            }
            case disconnectedCallbackSymbol: {
                api = () => {
                    return disconnectedCallback(target, disconnectedCallbackSymbol, receiver);
                };
                break;
            }
            case updatedCallbackSymbol: {
                api = (refs) => {
                    return updatedCallback(target, refs, receiver, handler);
                };
                break;
            }
            default: {
                return Reflect.get(target, prop, receiver);
            }
        }
        cache.set(prop, api);
        return api;
    }
}

/**
 * set.ts
 *
 * StateClassのProxyトラップとして、プロパティ設定時の値セット処理を担う関数（set）の実装です。
 *
 * 主な役割:
 * - 文字列プロパティの場合、getResolvedPathInfoでパス情報を解決し、getListIndexでリストインデックスを取得
 * - setByRefで構造化パス・リストインデックスに対応した値設定を実行
 * - それ以外（シンボル等）の場合はReflect.setで通常のプロパティ設定を実行
 *
 * 設計ポイント:
 * - バインディングや多重ループ、ワイルドカードを含むパスにも柔軟に対応
 * - setByRefを利用することで、依存解決や再描画などの副作用も一元管理
 * - Reflect.setで標準的なプロパティ設定の互換性も確保
 */
function set(target, prop, value, receiver, handler) {
    if (typeof prop === "string") {
        const resolvedAddress = getResolvedAddress(prop);
        const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
        const stateAddress = createStateAddress(resolvedAddress.pathInfo, listIndex);
        return setByAddress(target, stateAddress, value, receiver, handler);
    }
    else {
        return Reflect.set(target, prop, value, receiver);
    }
}

class StateHandler {
    _stateElement;
    _stateName;
    _addressStack = Array(MAX_LOOP_DEPTH).fill(undefined);
    _addressStackIndex = -1;
    _loopContext;
    _mutability;
    _untrackDepth = 0;
    constructor(rootNode, stateName, mutability) {
        this._stateName = stateName;
        const stateElement = getStateElementByName(rootNode, this._stateName);
        if (stateElement === null) {
            raiseError(`StateHandler: State element with name "${this._stateName}" not found.`);
        }
        this._stateElement = stateElement;
        this._mutability = mutability;
    }
    get stateName() {
        return this._stateName;
    }
    get stateElement() {
        return this._stateElement;
    }
    get lastAddressStack() {
        let address = undefined;
        if (this._addressStackIndex >= 0) {
            address = this._addressStack[this._addressStackIndex];
        }
        if (typeof address === "undefined") {
            raiseError(`Last address stack is undefined.`);
        }
        return address;
    }
    get addressStackLength() {
        return this._addressStackIndex + 1;
    }
    get loopContext() {
        return this._loopContext;
    }
    pushAddress(address) {
        this._addressStackIndex++;
        if (this._addressStackIndex >= MAX_LOOP_DEPTH) {
            raiseError(`Exceeded maximum address stack depth of ${MAX_LOOP_DEPTH}. Possible infinite loop.`);
        }
        this._addressStack[this._addressStackIndex] = address;
    }
    popAddress() {
        if (this._addressStackIndex < 0) {
            return null;
        }
        const address = this._addressStack[this._addressStackIndex];
        if (typeof address === "undefined") {
            raiseError(`Address stack at index ${this._addressStackIndex} is undefined.`);
        }
        this._addressStack[this._addressStackIndex] = undefined;
        this._addressStackIndex--;
        return address;
    }
    setLoopContext(loopContext) {
        this._loopContext = loopContext;
    }
    clearLoopContext() {
        this._loopContext = undefined;
    }
    get untracking() {
        return this._untrackDepth > 0;
    }
    beginUntrack() {
        this._untrackDepth++;
    }
    endUntrack() {
        this._untrackDepth--;
    }
    get(target, prop, receiver) {
        return get(target, prop, receiver, this);
    }
    set(target, prop, value, receiver) {
        if (this._mutability === "readonly") {
            raiseError(`State "${this._stateName}" is readonly.`);
        }
        return set(target, prop, value, receiver, this);
    }
    has(target, prop) {
        return Reflect.has(target, prop);
        //    return Reflect.has(target, prop) || this.symbols.has(prop) || this.apis.has(prop);
    }
}
function createStateProxy(rootNode, state, stateName, mutability) {
    const handler = new StateHandler(rootNode, stateName, mutability);
    const stateProxy = new Proxy(state, handler);
    return stateProxy;
}

// WebComponent専用のキャッシュ
// outerState.tsからのアクセスで、これを返す
const lastValueByAbsoluteStateAddress = new WeakMap();
function setLastValueByAbsoluteStateAddress(absoluteStateAddress, value) {
    lastValueByAbsoluteStateAddress.set(absoluteStateAddress, value);
}
function getLastValueByAbsoluteStateAddress(absoluteStateAddress) {
    return lastValueByAbsoluteStateAddress.get(absoluteStateAddress);
}

const stateElementByWebComponent = new WeakMap();
function setStateElementByWebComponent(webComponent, stateName, stateElement) {
    let stateMap = stateElementByWebComponent.get(webComponent);
    if (!stateMap) {
        stateMap = new Map();
        stateElementByWebComponent.set(webComponent, stateMap);
    }
    stateMap.set(stateName, stateElement);
}
function getStateElementByWebComponent(webComponent, stateName) {
    const stateMap = stateElementByWebComponent.get(webComponent);
    if (!stateMap) {
        return null;
    }
    return stateMap.get(stateName) ?? null;
}

const innerMappingByElement = new WeakMap();
const outerMappingByElement = new WeakMap();
const primaryMappingRuleSetByElement = new WeakMap();
const primaryBindingByMappingRule = new WeakMap();
function createMappingRuleByBinding(innerState, binding) {
    const innerPathInfo = getPathInfo(binding.propSegments.slice(1).join(DELIMITER));
    const innerAbsPathInfo = getAbsolutePathInfo(innerState, innerPathInfo);
    const outerAbsStateAddress = getAbsoluteStateAddressByBinding(binding);
    const outerAbsPathInfo = outerAbsStateAddress.absolutePathInfo;
    return { innerAbsPathInfo, outerAbsPathInfo };
}
function buildPrimaryMappingRule(webComponent, stateName, bindings) {
    if (bindings.length === 0) {
        return;
    }
    const innerState = getStateElementByWebComponent(webComponent, stateName);
    if (innerState === null) {
        raiseError('State element not found for web component.');
    }
    const innerMappingRule = new Map();
    const outerMappingRule = new Map();
    for (const binding of bindings) {
        const mappingRule = createMappingRuleByBinding(innerState, binding);
        let primaryMappingRuleSet = primaryMappingRuleSetByElement.get(webComponent);
        if (typeof primaryMappingRuleSet === 'undefined') {
            primaryMappingRuleSetByElement.set(webComponent, new Set([mappingRule]));
        }
        else {
            primaryMappingRuleSet.add(mappingRule);
        }
        const innerAbsPathInfo = mappingRule.innerAbsPathInfo;
        const outerAbsPathInfo = mappingRule.outerAbsPathInfo;
        primaryBindingByMappingRule.set(mappingRule, binding);
        innerMappingRule.set(innerAbsPathInfo, outerAbsPathInfo);
        outerMappingRule.set(outerAbsPathInfo, innerAbsPathInfo);
    }
    innerMappingByElement.set(webComponent, innerMappingRule);
    outerMappingByElement.set(webComponent, outerMappingRule);
}
function getOuterAbsolutePathInfo(webComponent, innerAbsPathInfo) {
    let innerMapping = innerMappingByElement.get(webComponent);
    if (typeof innerMapping === 'undefined') {
        innerMapping = new Map();
        innerMappingByElement.set(webComponent, innerMapping);
    }
    if (innerMapping.has(innerAbsPathInfo)) {
        return innerMapping.get(innerAbsPathInfo);
    }
    let outerMapping = outerMappingByElement.get(webComponent);
    if (typeof outerMapping === 'undefined') {
        outerMapping = new Map();
        outerMappingByElement.set(webComponent, outerMapping);
    }
    // 内側からのアクセスの場合、ルールがなければプライマリルールから新たにルールとバインディングを生成する
    const primaryMappingRuleSet = primaryMappingRuleSetByElement.get(webComponent);
    if (typeof primaryMappingRuleSet === 'undefined') {
        // マッピングルールが存在しない場合はnullを返し、ローカル状態へのフォールバックを許可する
        return null;
    }
    let primaryMappingRule = null;
    for (const currentPrimaryMappingRule of primaryMappingRuleSet) {
        // innerPathInfoがprimaryMappingRuleのinnerPathInfoを包含しているか
        if (!innerAbsPathInfo.pathInfo.cumulativePathInfoSet.has(currentPrimaryMappingRule.innerAbsPathInfo.pathInfo)) {
            continue;
        }
        if (currentPrimaryMappingRule.innerAbsPathInfo.pathInfo.segments.length === innerAbsPathInfo.pathInfo.segments.length) {
            raiseError('Duplicate mapping rule for web component.');
        }
        primaryMappingRule = currentPrimaryMappingRule;
        break;
    }
    if (primaryMappingRule === null) {
        // マッピングルールに一致しない場合はnullを返し、ローカル状態へのフォールバックを許可する
        return null;
    }
    // マッチした残りのパスをouterPathInfoに付与して新たなルールを生成
    const primaryBinding = primaryBindingByMappingRule.get(primaryMappingRule);
    /* c8 ignore start */
    if (typeof primaryBinding === 'undefined') {
        raiseError('Binding not found for primary mapping rule on web component.');
    }
    /* c8 ignore stop */
    const outerRemainingSegments = innerAbsPathInfo.pathInfo.segments.slice(primaryMappingRule.innerAbsPathInfo.pathInfo.segments.length);
    const outerSegments = primaryMappingRule.outerAbsPathInfo.pathInfo.segments.concat(outerRemainingSegments);
    const outerPathInfo = getPathInfo(outerSegments.join(DELIMITER));
    const rootNode = webComponent.getRootNode();
    const outerStateElement = getStateElementByName(rootNode, primaryBinding.stateName);
    if (outerStateElement === null) {
        raiseError(`State element with name "${primaryBinding.stateName}" not found for web component.`);
    }
    const outerAbsPathInfo = getAbsolutePathInfo(outerStateElement, outerPathInfo);
    innerMapping.set(innerAbsPathInfo, outerAbsPathInfo);
    outerMapping.set(outerAbsPathInfo, innerAbsPathInfo);
    // ルールに対応するバインディングを生成
    const newBinding = {
        ...primaryBinding,
        propName: innerAbsPathInfo.pathInfo.path,
        propSegments: innerAbsPathInfo.pathInfo.segments,
        statePathName: outerAbsPathInfo.pathInfo.path,
        statePathInfo: outerAbsPathInfo.pathInfo,
    };
    addBindingByNode(webComponent, newBinding);
    return outerAbsPathInfo;
}

function cloneWithDescriptors(obj) {
    const proto = Object.getPrototypeOf(obj);
    const clone = Object.create(proto);
    const descriptors = Object.getOwnPropertyDescriptors(obj);
    for (const key in descriptors) {
        const descriptor = descriptors[key];
        if (descriptor.writable === false) {
            descriptor.writable = true;
        }
    }
    Object.defineProperties(clone, descriptors);
    return clone;
}
function meltFrozenObject(frozenObj) {
    return cloneWithDescriptors(frozenObj);
}

class InnerStateProxyHandler {
    _webComponent;
    _innerStateElement;
    constructor(webComponent, stateName) {
        this._webComponent = webComponent;
        this._innerStateElement = getStateElementByWebComponent(webComponent, stateName) ?? raiseError('State element not found for web component.');
    }
    get(target, prop, receiver) {
        if (typeof prop === 'string') {
            if (prop === "then") {
                // Promiseのthenと誤認識されるのを防ぐため、Promiseに存在するプロパティはProxyのgetで処理しない
                return undefined;
            }
            if (prop[0] === '$') {
                return undefined;
            }
            // 1. getter完全一致 → ローカル計算（this = receiverで依存自動追跡）
            if (this._innerStateElement.getterPaths.has(prop) && prop in target) {
                return Reflect.get(target, prop, receiver);
            }
            // 2 & 3. マッピング完全一致 / サブパス → 親の状態
            const innerPathInfo = getPathInfo(prop);
            const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
            const outerAbsPathInfo = getOuterAbsolutePathInfo(this._webComponent, innerAbsPathInfo);
            if (outerAbsPathInfo !== null) {
                const loopContext = getLoopContextByNode(this._webComponent);
                let value = undefined;
                outerAbsPathInfo.stateElement.createState("readonly", (state) => {
                    state[setLoopContextSymbol](loopContext, () => {
                        value = state[outerAbsPathInfo.pathInfo.path];
                        let listIndex = null;
                        if (loopContext !== null && loopContext.listIndex !== null) {
                            if (outerAbsPathInfo.pathInfo.wildcardCount > 0) {
                                // wildcardPathSetとloopContextのpathInfoSetのintersectionのうち、segment数が最も多いものをouterAbsPathInfoにする
                                // 例: outerPathInfoが "todos.*.name"で、loopContextのpathInfoSetに "todos.0.name", "todos.1.name"がある場合、"todos.0.name"や"todos.1.name"をouterAbsPathInfoにする
                                listIndex = loopContext.listIndex.at(outerAbsPathInfo.pathInfo.wildcardCount - 1);
                            }
                        }
                        const absStateAddress = createAbsoluteStateAddress(outerAbsPathInfo, listIndex);
                        setLastValueByAbsoluteStateAddress(absStateAddress, value);
                    });
                });
                return value;
            }
            // 4. ローカルデータプロパティ → ローカル値
            if (prop in target) {
                return Reflect.get(target, prop, receiver);
            }
            // 5. エラー
            raiseError(`Property "${prop}" not found in inner state: no mapping rule and no local state property.`);
        }
        else {
            return Reflect.get(target, prop, receiver);
        }
    }
    set(target, prop, value, receiver) {
        if (typeof prop === 'string') {
            // 1. setter完全一致 → ローカル処理（this = receiverで親への書き込み可能）
            if (this._innerStateElement.setterPaths.has(prop) && prop in target) {
                return Reflect.set(target, prop, value, receiver);
            }
            // 2 & 3. マッピング完全一致 / サブパス → 親に書く
            const innerPathInfo = getPathInfo(prop);
            const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
            const outerAbsPathInfo = getOuterAbsolutePathInfo(this._webComponent, innerAbsPathInfo);
            if (outerAbsPathInfo !== null) {
                const loopContext = getLoopContextByNode(this._webComponent);
                outerAbsPathInfo.stateElement.createState("writable", (state) => {
                    state[setLoopContextSymbol](loopContext, () => {
                        state[outerAbsPathInfo.pathInfo.path] = value;
                    });
                });
                return true;
            }
            // 4. ローカルデータプロパティ → ローカルに書く
            if (prop in target) {
                return Reflect.set(target, prop, value, receiver);
            }
            // 5. エラー
            raiseError(`Property "${prop}" not found in inner state: no mapping rule and no local state property.`);
        }
        else {
            return Reflect.set(target, prop, value, receiver);
        }
    }
    has(target, prop) {
        if (typeof prop === 'string') {
            if (prop[0] === '$') {
                return false;
            }
            // 1. getter/setter完全一致
            if ((this._innerStateElement.getterPaths.has(prop) || this._innerStateElement.setterPaths.has(prop)) && prop in target) {
                return true;
            }
            // 2 & 3. マッピング
            const innerPathInfo = getPathInfo(prop);
            const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
            const outerAbsPathInfo = getOuterAbsolutePathInfo(this._webComponent, innerAbsPathInfo);
            if (outerAbsPathInfo !== null) {
                return true;
            }
            // 4. ローカルデータ
            if (prop in target) {
                return true;
            }
            // 5. 存在しない
            return false;
        }
        else {
            return Reflect.has(target, prop);
        }
    }
}
function createInnerState(webComponent, stateName) {
    const handler = new InnerStateProxyHandler(webComponent, stateName);
    const innerState = getStateElementByWebComponent(webComponent, stateName);
    /* c8 ignore start */
    if (innerState === null) {
        raiseError('State element not found for web component.');
    }
    /* c8 ignore stop */
    if (innerState.boundComponentStateProp === null) {
        raiseError('State element is not bound to any component state prop.');
    }
    if (!(innerState.boundComponentStateProp in webComponent)) {
        raiseError(`State element is not bound to a valid component state prop: ${innerState.boundComponentStateProp}`);
    }
    const state = webComponent[innerState.boundComponentStateProp];
    if (typeof state !== 'object' || state === null) {
        raiseError(`Invalid state object for component state prop: ${innerState.boundComponentStateProp}`);
    }
    return new Proxy(meltFrozenObject(state), handler);
}

class OuterStateProxyHandler {
    _innerStateElement;
    constructor(webComponent, stateName) {
        this._innerStateElement = getStateElementByWebComponent(webComponent, stateName) ?? raiseError('State element not found for web component.');
    }
    get(target, prop, receiver) {
        if (typeof prop === 'string') {
            const innerPathInfo = getPathInfo(prop);
            const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
            const absStateAddress = createAbsoluteStateAddress(innerAbsPathInfo, null);
            return getLastValueByAbsoluteStateAddress(absStateAddress);
        }
        else {
            return Reflect.get(target, prop, receiver);
        }
    }
    set(target, prop, value, receiver) {
        if (typeof prop === 'string') {
            const innerPathInfo = getPathInfo(prop);
            const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
            this._innerStateElement.createState("readonly", (state) => {
                state.$postUpdate(innerAbsPathInfo.pathInfo.path);
            });
            return true;
        }
        else {
            return Reflect.set(target, prop, value, receiver);
        }
    }
}
function createOuterState(webComponent, stateName) {
    const handler = new OuterStateProxyHandler(webComponent, stateName);
    return new Proxy({}, handler);
}

class PlainOuterStateProxyHandler {
    _innerStateElement;
    constructor(webComponent, stateName) {
        this._innerStateElement = getStateElementByWebComponent(webComponent, stateName) ?? raiseError('State element not found for web component.');
    }
    get(target, prop, receiver) {
        if (typeof prop === 'string') {
            let value;
            this._innerStateElement.createState("readonly", (state) => {
                value = state[prop];
            });
            return value;
        }
        else {
            return Reflect.get(target, prop, receiver);
        }
    }
    set(target, prop, value, receiver) {
        if (typeof prop === 'string') {
            this._innerStateElement.createState("writable", (state) => {
                state[prop] = value;
            });
            return true;
        }
        else {
            return Reflect.set(target, prop, value, receiver);
        }
    }
}
function createPlainOuterState(webComponent, stateName) {
    const handler = new PlainOuterStateProxyHandler(webComponent, stateName);
    return new Proxy({}, handler);
}

const getOuter = (outerState) => () => outerState;
function bindWebComponent(innerStateElement, component, stateProp, state) {
    setStateElementByWebComponent(component, stateProp, innerStateElement);
    if (component.hasAttribute(config.bindAttributeName)) {
        const bindings = (getBindingsByNode(component) ?? []).filter(binding => binding.propSegments[0] === stateProp);
        buildPrimaryMappingRule(component, stateProp, bindings);
        const outerState = createOuterState(component, stateProp);
        const innerState = createInnerState(component, stateProp);
        innerStateElement.setInitialState(innerState);
        Object.defineProperty(component, stateProp, {
            get: getOuter(outerState),
            enumerable: true,
            configurable: true,
        });
    }
    else {
        innerStateElement.setInitialState(meltFrozenObject(state));
        const outerState = createPlainOuterState(component, stateProp);
        Object.defineProperty(component, stateProp, {
            get: getOuter(outerState),
            enumerable: true,
            configurable: true,
        });
    }
    markWebComponentAsComplete(component, innerStateElement);
    if (WEBCOMPONENT_STATE_READY_CALLBACK_NAME in component) {
        const func = component[WEBCOMPONENT_STATE_READY_CALLBACK_NAME];
        if (typeof func === 'function') {
            func.call(component, stateProp).catch((error) => {
                raiseError(`Error in ${WEBCOMPONENT_STATE_READY_CALLBACK_NAME}: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
        else {
            raiseError(`${WEBCOMPONENT_STATE_READY_CALLBACK_NAME} is not a function.`);
        }
    }
}

function getAllPropertyDescriptors(obj) {
    let descriptors = {};
    let proto = obj;
    while (proto && proto !== Object.prototype) {
        Object.assign(descriptors, Object.getOwnPropertyDescriptors(proto));
        proto = Object.getPrototypeOf(proto);
    }
    return descriptors;
}
function getStateInfo(state) {
    const getterPaths = new Set();
    const setterPaths = new Set();
    const descriptors = getAllPropertyDescriptors(state);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (typeof descriptor.get === "function") {
            getterPaths.add(key);
        }
        if (typeof descriptor.set === "function") {
            setterPaths.add(key);
        }
    }
    return {
        getterPaths, setterPaths
    };
}
class State extends HTMLElementBase {
    static hasConnectedCallbackPromise = true;
    static getBindingsReady(rootNode) {
        return getBindingsReady(rootNode);
    }
    __state;
    _hasUpdatedCallback = false;
    // 他行を読む getter が検出されたリストパス（diff-filter 展開の全行フォールバック対象）。
    // 依存マップ（static/dynamic）と同様に追加のみ・クリアしない（安全側に固定される）。
    _crossRowListPaths = new Set();
    // $1 等のインデックスを読んだ getter パス（実行時検出）。位置のみ変わった行の
    // 静的子展開はこの集合の subtree に限定される。追加のみ・クリアしない（安全側）。
    _indexDependentGetterPaths = new Set();
    _name = 'default';
    _initialized = false;
    _initializePromise;
    _resolveInitialize = null;
    _connectedCallbackPromise;
    _resolveConnectedCallback = null;
    _loadingPromise;
    _resolveLoading = null;
    _setStatePromise = null;
    _resolveSetState = null;
    _listPaths = new Set();
    _elementPaths = new Set();
    _getterPaths = new Set();
    _setterPaths = new Set();
    _loopContextStack = createLoopContextStack();
    _dynamicDependency = new Map();
    _staticDependency = new Map();
    _pathSet = new Set();
    _version = 0;
    _rootNode = null;
    _boundComponent = null;
    _boundComponentStateProp = null;
    _bindableEventMap = {};
    _commandTokenNames = new Set();
    _eventTokenNames = new Set();
    _dcc = false;
    // connect サイクルの世代カウンタ（connectedCallback 冒頭でインクリメント）。
    // $connectedCallback の await 中の「切断 → 即再接続」では、新 connect が
    // _rootNode を再設定済みのため陳腐化した旧 connect の再開が _rootNode ガードを
    // 素通りして startStreams に到達し、同一の再接続に対して source が二重起動する。
    // 末尾で冒頭に捕捉した世代と照合し、陳腐 connect からの起動を skip する（設計書 §2-3）。
    _connectGeneration = 0;
    // _state セッター側の startStreams が走った connect 世代
    // （connectedCallback 末尾の startStreams との二重起動防止、設計書 §2-3。
    //  世代が進めば不一致となり自然に無効化される — サイクル単位のフラグリセット相当）
    _streamsStartedGeneration = 0;
    constructor() {
        super();
        this._initializePromise = new Promise((resolve) => {
            this._resolveInitialize = resolve;
        });
        this._connectedCallbackPromise = new Promise((resolve) => {
            this._resolveConnectedCallback = resolve;
        });
        this._loadingPromise = new Promise((resolve) => {
            this._resolveLoading = resolve;
        });
        this._setStatePromise = new Promise((resolve) => {
            this._resolveSetState = resolve;
        });
    }
    get _state() {
        if (typeof this.__state === "undefined") {
            raiseError(`${config.tagNames.state} _state is not initialized yet.`);
        }
        return this.__state;
    }
    set _state(value) {
        this._commandTokenNames = processCommandTokensDeclaration(value);
        this._eventTokenNames = processEventTokensDeclaration(value);
        this.__state = value;
        // $updatedCallback の有無を state セット時に確定しておく（in はプロトタイプ
        // チェーンも見る・getter を評価しない）。drain 側はこのフラグで更新アドレスの
        // 集計と writable createState をスキップできる。
        // 注: state セット後に生オブジェクトへ直接 $updatedCallback を後付けする
        // パターンは検知できない（bindProperty / _state 再セットは検知する）。
        // ライフサイクルフックは宣言時に定義するのが規約。
        this._hasUpdatedCallback = STATE_UPDATED_CALLBACK_NAME in value;
        // 再 set 時に二重 subscribe しないよう registry をクリアしてから $on を配線し直す。
        clearEventTokenRegistry(this);
        processOnDeclaration(this, value, this._eventTokenNames);
        this._listPaths.clear();
        this._elementPaths.clear();
        this._getterPaths.clear();
        // 再 set 時の残骸が $streams の衝突検査（processStreamsDeclaration）に
        // 偽陽性で命中しないよう getterPaths と対称にクリアする。
        this._setterPaths.clear();
        this._pathSet.clear();
        const stateInfo = getStateInfo(value);
        for (const path of stateInfo.getterPaths) {
            this._getterPaths.add(path);
        }
        for (const path of stateInfo.setterPaths) {
            this._setterPaths.add(path);
        }
        // $streams: 再 set 時の二重起動防止のため旧 stream を abort ＋ registry 全削除してから
        // 新宣言をパースする（clearEventTokenRegistry → processOnDeclaration と同じ再配線パターン）。
        // getterPaths / setterPaths の収集後であること（宣言バリデーションが衝突検査で参照する）。
        // namespace proxy の memo も破棄して古い proxy を捨てる（clearCommandNamespace と対称）。
        clearStreamNamespace(this);
        clearStreamRegistry(this);
        processStreamsDeclaration(this, value);
        // 接続中の再 set（S13）は新宣言で即再起動する。
        // 初回（_initialize 中）は _initialized が false なのでここでは起動されず、
        // connectedCallback 側の startStreams（$connectedCallback 完了後）が担う。
        if (this._initialized && this._rootNode !== null && !inSsr()) {
            startStreams(this);
            // $connectedCallback 実行中の再 set（setInitialState）では、ここで新宣言が
            // 起動済みのため connectedCallback 末尾の startStreams を skip させる。
            // skip しないと同一 connect サイクルで新宣言の source が 2 回起動する
            // （1 回目は即 abort — switchMap 意味論で状態は壊れないが、副作用を持つ
            // source が 2 回発火してしまう）。
            this._streamsStartedGeneration = this._connectGeneration;
        }
        this._resolveLoading?.();
    }
    get name() {
        return this._name;
    }
    _loadFromSsrElement() {
        if (!this.hasAttribute('enable-ssr'))
            return null;
        const name = this.getAttribute('name') || 'default';
        const root = this.parentNode;
        if (!root)
            return null;
        const ssrEl = Ssr.findByName(root, name);
        if (!ssrEl)
            return null;
        const data = ssrEl.stateData;
        return Object.keys(data).length > 0 ? data : null;
    }
    async _initialize() {
        // enable-ssr (クライアント側のみ): <wcs-ssr> から初期データを取得
        const ssrState = !inSsr() ? this._loadFromSsrElement() : null;
        try {
            if (this.hasAttribute('state')) {
                const state = this.getAttribute('state');
                this._state = loadFromScriptJson(state);
            }
            else if (this.hasAttribute('src')) {
                const src = this.getAttribute('src');
                if (src && src.endsWith('.json')) {
                    this._state = await loadFromJsonFile(src);
                }
                else if (src && src.endsWith('.js')) {
                    this._state = await loadFromScriptFile(src);
                }
                else {
                    raiseError(`Unsupported src file type: ${src}`);
                }
            }
            else if (this.hasAttribute('json')) {
                const json = this.getAttribute('json');
                this._state = JSON.parse(json);
            }
            else {
                const script = this.querySelector('script[type="module"]');
                if (script) {
                    this._state = await loadFromInnerScript(script, `${this._name}`);
                }
                else {
                    const timerId = setTimeout(() => {
                        console.warn(`[@wcstack/state] Warning: No state source found for <${config.tagNames.state}> element with name="${this._name}".`);
                    }, NO_SET_TIMEOUT);
                    // 要注意！！！APIでセットする場合はここで待機する必要がある --(1)
                    this._state = await this._setStatePromise;
                    clearTimeout(timerId);
                }
            }
        }
        catch (e) {
            raiseError(`Failed to initialize state: ${e}`);
        }
        // SSR データがある場合、state 定義（メソッド/getter）を維持しつつデータ値を上書き
        if (ssrState !== null && this.__state) {
            for (const [key, value] of Object.entries(ssrState)) {
                if (key in this.__state) {
                    const desc = Object.getOwnPropertyDescriptor(this.__state, key);
                    // getter/setter はスキップ（定義側を優先）
                    if (desc && (desc.get || desc.set))
                        continue;
                    // 関数はスキップ
                    if (typeof this.__state[key] === 'function')
                        continue;
                }
                this.__state[key] = value;
            }
        }
        await this._loadingPromise;
        this._name = this.getAttribute('name') || 'default';
        setStateElementByName(this.rootNode, this._name, this);
    }
    async _initializeBindWebComponent() {
        if (this.hasAttribute("bind-component")) {
            // wcs-stateはコンポーネントのトップレベル要素であること
            // ShadowDOM直下: parentNodeがShadowRoot → hostが親コンポーネント
            // LightDOM/ShadowDOM内のLightDOM: parentNodeがElement → それが親コンポーネント
            const parentNode = this.parentNode;
            const boundComponent = parentNode instanceof ShadowRoot
                ? parentNode.host
                : parentNode instanceof Element
                    ? parentNode
                    : null;
            const customTagName = boundComponent ? getCustomElement(boundComponent) : null;
            if (boundComponent === null || customTagName === null) {
                raiseError(`"bind-component" requires <${config.tagNames.state}> to be a direct child of a custom element.`);
            }
            // LightDOMの場合、名前空間が上位スコープと共有されるためnameが必須
            if (!(parentNode instanceof ShadowRoot) && !this.hasAttribute("name")) {
                raiseError(`"bind-component" in Light DOM requires a "name" attribute to avoid namespace conflicts with the parent scope.`);
            }
            const boundComponentStateProp = this.getAttribute("bind-component");
            await customElements.whenDefined(customTagName.toLowerCase());
            // data-wcs属性がある場合は、上位の状態によりbinding情報の設定が完了するまで待機する
            if (boundComponent.hasAttribute(config.bindAttributeName)) {
                await waitInitializeBinding(boundComponent);
            }
            if (!(boundComponentStateProp in boundComponent)) {
                raiseError(`Component does not have property "${boundComponentStateProp}" for state binding.`);
            }
            const state = boundComponent[boundComponentStateProp];
            if (typeof state !== 'object' || state === null) {
                raiseError(`Component property "${boundComponentStateProp}" is not an object for state binding.`);
            }
            this._boundComponent = boundComponent;
            this._boundComponentStateProp = boundComponentStateProp;
            bindWebComponent(this, this._boundComponent, this._boundComponentStateProp, state);
        }
    }
    async _callStateConnectedCallback() {
        await this.createStateAsync("writable", async (state) => {
            // stateに"$connectedCallback"があるか確認し、connectedCallbackAPIを呼び出す
            if (STATE_CONNECTED_CALLBACK_NAME in state) {
                await state[connectedCallbackSymbol]();
            }
        });
    }
    async _initializeDCC(hostElement, shadowRoot) {
        let state;
        try {
            if (this.hasAttribute('src')) {
                const src = this.getAttribute('src');
                if (src.endsWith('.js')) {
                    state = await loadFromScriptFile(src);
                }
                else {
                    raiseError(`DCC: Unsupported src type: ${src}`);
                }
            }
            else {
                const script = this.querySelector('script[type="module"]');
                if (script) {
                    state = await loadFromInnerScript(script, hostElement.tagName.toLowerCase());
                }
                else {
                    raiseError(`DCC: No state source found for "${hostElement.tagName.toLowerCase()}".`);
                }
            }
        }
        catch (e) {
            raiseError(`DCC: Failed to load state: ${e}`);
        }
        defineDCC(hostElement, shadowRoot, state);
        this._dcc = true;
        this._initialized = true;
        this._rootNode = null; // disconnectedCallbackでのstate参照を防止
        this._resolveInitialize?.();
        this._resolveConnectedCallback?.();
    }
    _callStateDisconnectedCallback() {
        this.createState("writable", (state) => {
            // stateに"$disconnectedCallback"があるか確認し、disconnectedCallbackAPIを呼び出す
            if (STATE_DISCONNECTED_CALLBACK_NAME in state) {
                state[disconnectedCallbackSymbol]();
            }
        });
    }
    async connectedCallback() {
        this._rootNode = this.getRootNode();
        // connect 世代を進めて冒頭で捕捉する（末尾の startStreams 前に照合し、
        // $connectedCallback の await 中に「切断 → 即再接続」された陳腐 connect の
        // 再開からの起動を防ぐ）。前回接続中の再 set（S13）で立った
        // _streamsStartedGeneration も世代不一致となり自然に無効化される。
        const connectGeneration = ++this._connectGeneration;
        if (!this._initialized) {
            // DCC 検出: ShadowRoot 内かつホストに data-wc-definition がある場合
            const parentNode = this.parentNode;
            if (parentNode instanceof ShadowRoot &&
                parentNode.host.hasAttribute(DCC_DEFINITION_ATTRIBUTE)) {
                await this._initializeDCC(parentNode.host, parentNode);
                return;
            }
            await this._initializeBindWebComponent();
            await this._initialize();
            this._initialized = true;
            this._resolveInitialize?.();
        }
        else if (!this._dcc && getStateElementByName(this._rootNode, this._name) !== this) {
            // 再接続（disconnect で名前登録が解除された後の再 connect）: 登録を復元する。
            // createState が rootNode 経由でこの要素を解決できるようにするために必要
            // （$connectedCallback の再実行と $streams の initial からの再起動が依存する、設計書 §2-3）。
            setStateElementByName(this._rootNode, this._name, this);
        }
        // enable-ssr (クライアント側): SSR で $connectedCallback 済みなのでスキップ
        // inSsr() (サーバー側): レンダリング中なので実行する
        if (!this.hasAttribute('enable-ssr') || inSsr()) {
            await this._callStateConnectedCallback();
        }
        // サーバーモード + enable-ssr: バインディング完了後に <wcs-ssr> を生成
        if (inSsr() && this.hasAttribute('enable-ssr')) {
            await getBindingsReady(this.rootNode);
            const name = this.getAttribute('name') || 'default';
            const stateData = Ssr.extractStateData(this);
            const ssrEl = document.createElement(config.tagNames.ssr);
            ssrEl.setAttribute('name', name);
            ssrEl.setAttribute('version', VERSION);
            Ssr.buildContent(ssrEl, stateData);
            this.parentNode?.insertBefore(ssrEl, this);
        }
        // $streams の eager 起動（$connectedCallback 完了後、設計書 §2-3）。
        // inSsr() 時は起動しない（SSR 出力には initial が乗る、§7-1）。
        // enable-ssr のクライアント側は $connectedCallback をスキップしても起動する
        // （stream はシリアライズ不能なランタイム副作用のため）。
        // _rootNode ガード: $connectedCallback の await 中に切断された場合は起動しない。
        // ガードなしだと startStream 内の createState が rootNode 解決（disconnectedCallback
        // で null 化済み）の raiseError で throw し、connectedCallbackPromise が永遠に
        // 未解決になる。「未接続の entry は restart しない」設計書 §3-2 とも整合し、
        // _state セッター側の startStreams 前ガード（_rootNode !== null）と対称。
        // 世代ガード（connectGeneration 照合）: await 中に「切断 → 即再接続」された場合、
        // 新 connect が _rootNode を再設定済みで上のガードを素通りするため、世代不一致で
        // 陳腐化した connect の再開を検出して skip する。起動点が新 connect の末尾に
        // 一本化され、「$connectedCallback 完了後に起動」（S1）の順序保証も保たれる。
        // _streamsStartedGeneration ガード: $connectedCallback 内の setInitialState
        // （接続中の再 set）で _state セッター側が新宣言を起動済みの場合は skip する
        // （skip しないと同一 connect サイクルで source が 2 回起動する、設計書 §2-3）。
        if (!inSsr() &&
            this._rootNode !== null &&
            connectGeneration === this._connectGeneration &&
            this._streamsStartedGeneration !== connectGeneration) {
            startStreams(this);
        }
        this._resolveConnectedCallback?.();
    }
    disconnectedCallback() {
        if (this._rootNode !== null) {
            // try/finally: ユーザーの $disconnectedCallback が throw しても後続の後始末を
            // 必ず実行する。特に abortAllStreams が飛ぶと stream が消費を続け（ゾンビ I/O）、
            // activeStateElements の強参照残留で GC が妨げられ、切断済み要素が依存駆動
            // restart の対象にも残る（設計書 §3-2 / §5-1 違反）。throw 自体は従来どおり
            // 呼び出し元へ伝播させる（変わるのは後始末の保証のみ）。
            try {
                this._callStateDisconnectedCallback();
            }
            finally {
                setStateElementByName(this.rootNode, this._name, null);
                clearCommandTokenRegistry(this);
                clearCommandNamespace(this);
                clearEventTokenRegistry(this);
                // stream は abort のみで registry は保持する（再接続時に同じ宣言から
                // initial で再起動できる、設計書 §5-1 / §5-2）。
                // namespace proxy の memo は破棄する（clearCommandNamespace と対称。
                // registry は残るため再接続後の初回アクセスで同内容の proxy が再生成される）。
                abortAllStreams(this);
                clearStreamNamespace(this);
                this._rootNode = null;
            }
        }
    }
    get initializePromise() {
        return this._initializePromise;
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    get listPaths() {
        return this._listPaths;
    }
    get elementPaths() {
        return this._elementPaths;
    }
    get getterPaths() {
        return this._getterPaths;
    }
    get setterPaths() {
        return this._setterPaths;
    }
    get loopContextStack() {
        return this._loopContextStack;
    }
    get dynamicDependency() {
        return this._dynamicDependency;
    }
    get staticDependency() {
        return this._staticDependency;
    }
    get version() {
        return this._version;
    }
    get rootNode() {
        if (this._rootNode === null) {
            raiseError('State rootNode is not available.');
        }
        return this._rootNode;
    }
    get boundComponentStateProp() {
        return this._boundComponentStateProp;
    }
    get bindableEventMap() {
        return this._bindableEventMap;
    }
    get commandTokenNames() {
        return this._commandTokenNames;
    }
    get eventTokenNames() {
        return this._eventTokenNames;
    }
    setBindableEventMap(map) {
        this._bindableEventMap = map;
    }
    _addDependency(map, sourcePath, targetPath) {
        const deps = map.get(sourcePath);
        if (deps === undefined) {
            map.set(sourcePath, [targetPath]);
            return true;
        }
        else if (!deps.includes(targetPath)) {
            deps.push(targetPath);
            return true;
        }
        return false;
    }
    /**
     * source,           target
     *
     * products.*.price => products.*.tax
     * get "products.*.tax"() { return this["products.*.price"] * 0.1; }
     *
     * products.*.price => products.summary
     * get "products.summary"() { return this.$getAll("products.*.price", []).reduce(sum); }
     *
     * categories.*.name => categories.*.products.*.categoryName
     * get "categories.*.products.*.categoryName"() { return this["categories.*.name"]; }
     *
     * @param sourcePath
     * @param targetPath
     */
    addDynamicDependency(sourcePath, targetPath) {
        return this._addDependency(this._dynamicDependency, sourcePath, targetPath);
    }
    /**
     * source,      target
     * products => products.*
     * products.* => products.*.price
     * products.* => products.*.name
     *
     * @param sourcePath
     * @param targetPath
     */
    addStaticDependency(sourcePath, targetPath) {
        return this._addDependency(this._staticDependency, sourcePath, targetPath);
    }
    setPathInfo(path, bindingType) {
        if (bindingType === "for") {
            this._listPaths.add(path);
            this._elementPaths.add(path + '.' + WILDCARD);
        }
        if (!this._pathSet.has(path)) {
            const pathInfo = getPathInfo(path);
            this._pathSet.add(path);
            if (pathInfo.parentPath !== null) {
                let currentPathInfo = pathInfo;
                while (currentPathInfo.parentPath !== null) {
                    if (!this.addStaticDependency(currentPathInfo.parentPath, currentPathInfo.path)) {
                        break;
                    }
                    currentPathInfo = getPathInfo(currentPathInfo.parentPath);
                }
            }
        }
    }
    _createState(rootNode, mutability, callback) {
        try {
            const stateProxy = createStateProxy(rootNode, this._state, this._name, mutability);
            return callback(stateProxy);
        }
        finally {
            // cleanup if needed
        }
    }
    async createStateAsync(mutability, callback) {
        return await this._createState(this.rootNode, mutability, callback);
    }
    createState(mutability, callback) {
        this._createState(this.rootNode, mutability, callback);
    }
    nextVersion() {
        this._version++;
        return this._version;
    }
    get hasUpdatedCallback() {
        return this._hasUpdatedCallback;
    }
    get crossRowListPaths() {
        return this._crossRowListPaths;
    }
    addCrossRowListPath(path) {
        this._crossRowListPaths.add(path);
    }
    get indexDependentGetterPaths() {
        return this._indexDependentGetterPaths;
    }
    addIndexDependentGetterPath(path) {
        this._indexDependentGetterPaths.add(path);
    }
    bindProperty(prop, desc) {
        Object.defineProperty(this._state, prop, desc);
        if (prop === STATE_UPDATED_CALLBACK_NAME) {
            this._hasUpdatedCallback = true;
        }
    }
    setInitialState(state) {
        if (!this._initialized) {
            this._resolveSetState?.(state);
        }
        else {
            this._state = state;
        }
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.ssr)) {
        customElements.define(config.tagNames.ssr, Ssr);
    }
    if (!customElements.get(config.tagNames.state)) {
        customElements.define(config.tagNames.state, State);
    }
}

function bootstrapState(config) {
    if (config) {
        setConfig(config);
    }
    registerComponents();
    // DevTools Hook Protocol への source 登録（SSR では no-op・冪等）
    registerDevtoolsSource();
}

/**
 * defineState.ts
 *
 * 状態オブジェクトに型付けを提供するためのユーティリティ。
 * defineState() はアイデンティティ関数で、ThisType<> を付与することで
 * メソッド・computed getter 内の this に型補完を提供する。
 *
 * テンプレートリテラル型によるドットパスの型解決:
 * - WcsPaths<T>      : T から生成される全ドットパスの union
 * - WcsPathValue<T,P>: パス P に対応する値の型
 * - WcsPathAccessor<T>: ブラケットアクセス用マップ型
 */
// ============================================================
// defineState — 型付き状態定義関数
// ============================================================
/**
 * `<wcs-state>` 用の型付き状態オブジェクトを定義する。
 *
 * ランタイムではアイデンティティ関数（引数をそのまま返す）として動作し、
 * コストはゼロ。TypeScript の `ThisType<>` を利用して、メソッド・getter 内の
 * `this` に型補完を提供する。
 *
 * ### 基本的な使い方 (TypeScript)
 * ```ts
 * import { defineState } from '@wcstack/state';
 *
 * export default defineState({
 *   count: 0,
 *   users: [] as { name: string; age: number }[],
 *
 *   increment() {
 *     this.count++;            // ✅ number
 *     this["users.*.name"];    // ✅ string (ドットパス型解決)
 *   },
 *
 *   get "users.*.ageCategory"() {
 *     return this["users.*.age"] < 25 ? "Young" : "Adult";
 *   }
 * });
 * ```
 *
 * ### JavaScript (JSDoc)
 * ```js
 * import { defineState } from '@wcstack/state';
 *
 * export default defineState({
 *   count: 0,
 *   increment() {
 *     this.count++;  // ✅ JSDoc + tsconfig checkJs で型補完
 *   }
 * });
 * ```
 *
 * ### HTML インラインスクリプト
 * ```html
 * <wcs-state>
 *   <script type="module">
 *     import { defineState } from '@wcstack/state';
 *     export default defineState({
 *       count: 0,
 *       increment() { this.count++; }
 *     });
 *   </script>
 * </wcs-state>
 * ```
 *
 * ### ライフサイクルコールバック
 * ```ts
 * export default defineState({
 *   data: null,
 *   async $connectedCallback() {
 *     this.data = await fetch('/api/data').then(r => r.json());
 *   },
 *   $disconnectedCallback() {
 *     // cleanup
 *   },
 *   $updatedCallback() {
 *     // called after DOM update
 *   }
 * });
 * ```
 */
function defineState(definition) {
    return definition;
}

/**
 * filterMeta.ts — 組み込みフィルタの構造化メタデータ（単一正本・route-a A2-1）。
 *
 * これまで vscode-wcs（completionData.ts BUILTIN_FILTERS）が手で持っていたフィルタの
 * 引数仕様・型・説明を、実装側（@wcstack/state）に**正本として移設**したもの。
 * manifest.ts がこれを公開し、vscode-wcs はそれを消費して手リストを撤去できる。
 *
 * 完全性は __tests__/manifest.test.ts のドリフト検出が保証する
 * （filterMeta のキー集合 == builtinFilters のキー集合）。フィルタを追加して meta を
 * 書き忘れると CI が落ちる。
 */
/** 組み込みフィルタ名 → 構造化メタデータ。キー集合は builtinFilters と一致しなければならない。 */
const builtinFilterMeta = {
    // 比較・論理
    eq: { description: "等しいか比較", hasArgs: true, resultType: "boolean", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
    ne: { description: "異なるか比較", hasArgs: true, resultType: "boolean", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
    not: { description: "ブール値を反転", hasArgs: false, resultType: "boolean", acceptTypes: ["boolean"], minArgs: 0, maxArgs: 0 },
    lt: { description: "より小さいか", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
    le: { description: "以下か", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
    gt: { description: "より大きいか", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
    ge: { description: "以上か", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
    // 算術
    inc: { description: "加算", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
    dec: { description: "減算", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
    mul: { description: "乗算", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
    div: { description: "除算", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
    mod: { description: "剰余", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
    // 数値フォーマット
    fix: { description: "固定小数点表記", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
    locale: { description: "ロケール形式で数値フォーマット", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["string"] },
    // 文字列
    uc: { description: "大文字に変換", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
    lc: { description: "小文字に変換", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
    cap: { description: "先頭文字を大文字に", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
    trim: { description: "前後の空白を削除", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
    slice: { description: "部分文字列 (start[,end])", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "number"] },
    substr: { description: "部分文字列 (pos,len)", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "number"] },
    pad: { description: "パディング (length[,char])", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "string"] },
    rep: { description: "繰り返し (count)", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
    rev: { description: "文字順を反転", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
    // 数値パース・丸め
    int: { description: "整数にパース", hasArgs: false, resultType: "number", acceptTypes: ["string", "number"], minArgs: 0, maxArgs: 0 },
    float: { description: "浮動小数点数にパース", hasArgs: false, resultType: "number", acceptTypes: ["string", "number"], minArgs: 0, maxArgs: 0 },
    round: { description: "四捨五入", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
    floor: { description: "切り下げ", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
    ceil: { description: "切り上げ", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
    percent: { description: "パーセンテージ形式", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
    // 日付・時刻
    date: { description: "ロケール形式の日付", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
    time: { description: "ロケール形式の時刻", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
    datetime: { description: "ロケール形式の日時", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
    ymd: { description: "YYYY-MM-DD 形式", hasArgs: true, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
    // 真偽値・変換
    falsy: { description: "偽値か判定", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
    truthy: { description: "真値か判定", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
    defaults: { description: "偽値の場合デフォルト値", hasArgs: true, resultType: "passthrough", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
    boolean: { description: "ブール値に変換", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
    number: { description: "数値に変換", hasArgs: false, resultType: "number", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
    string: { description: "文字列に変換", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
    null: { description: "空文字列をnullに変換", hasArgs: false, resultType: "passthrough", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
};

/**
 * manifest.ts — `<wcs-state>` の構文・フィルタ・予約名を機械可読な単一正本として公開する。
 *
 * 目的（route-a A2-1）: vscode-wcs（wcstack-intellisense）が現在ハードコードで二重実装している
 * 「フィルタ一覧・構文区切り・予約名」を、state 側の実装から導出した manifest に一本化し、
 * 手作業同期によるドリフトを構造的に断つための土台。
 *
 * 設計:
 * - `filters` は実装（builtinFilters の Record キー）から **自動導出**＝実装が唯一の正本。
 * - 構文・予約名は config / define.ts の定数から導出。
 * - 将来 `dist/wcs-manifest.json` としてビルド時に書き出し、vscode-wcs がそれを読む形に発展させる。
 * - ドリフト検出テスト（__tests__/manifest.test.ts）が、フィルタ集合の golden と実装の一致を CI で保証する。
 */
/** マニフェストのバージョン（構造を変えたら上げる）。 */
const WCS_MANIFEST_VERSION = 1;
/** 機械可読な単一正本を返す。vscode-wcs はこれを消費する想定。 */
function getWcsManifest() {
    return {
        version: WCS_MANIFEST_VERSION,
        syntax: {
            bindAttribute: config.bindAttributeName,
            tagName: config.tagNames.state,
            pathDelimiter: DELIMITER,
            wildcard: WILDCARD,
            delimiters: {
                binding: BINDING_SEPARATOR,
                propValue: PROP_VALUE_SEPARATOR,
                modifier: MODIFIER_SEPARATOR,
                stateName: STATE_NAME_SEPARATOR,
                filter: FILTER_SEPARATOR,
            },
            // 正本 STRUCTURAL_BINDING_TYPE_SET から導出（手書きの二重定義を排除）。
            structuralDirectives: Array.from(STRUCTURAL_BINDING_TYPE_SET),
        },
        // 実装（Record のキー）から自動導出。手リストを持たない＝ドリフトの構造的排除。
        filters: Object.keys(outputBuiltinFilters),
        filterMeta: builtinFilterMeta,
        reservedLifecycle: [
            STATE_CONNECTED_CALLBACK_NAME,
            STATE_DISCONNECTED_CALLBACK_NAME,
            STATE_UPDATED_CALLBACK_NAME,
            WEBCOMPONENT_STATE_READY_CALLBACK_NAME,
        ],
        reservedStateApi: [
            STATE_BINDABLES_NAME,
            STATE_COMMAND_TOKENS_NAME,
            STATE_COMMAND_NAMESPACE_NAME,
            STATE_EVENT_TOKENS_NAME,
            STATE_ON_NAME,
            STATE_STREAMS_NAME,
            STATE_STREAM_STATUS_NAMESPACE_NAME,
            STATE_STREAM_ERROR_NAMESPACE_NAME,
        ],
    };
}

/**
 * contract/contractAnalyzer.ts
 *
 * Phase 5b(09-remediation-design.md §5b / §7.1 dev runtime / §6 contract trace)の
 * opt-in dev-time analyzer。実際に登録済みの custom element の `static wcBindable`
 * 宣言(= 実行時の正本)を、利用者が渡した sidecar manifest と突き合わせ、drift を
 * DevTools trace(`contract:*`)へ流す。
 *
 * 完了条件「無効時の runtime 挙動・cost が不変」: `analyzeContract` は
 * `config.enableContractAnalyzer` が false のとき即 return し、manifest を一切走査
 * しない(hot path には一切フックしない — 純粋な on-demand API)。
 *
 * pure な core(`analyzeManifestContract`)は宣言解決と emit を注入で受けるためテスト可能。
 */
/** runtime analyzer が解釈する manifest namespace。これ以外は unsupported-extension。 */
const KNOWN_NAMESPACES = new Set([
    "wcstack.types",
    "wcstack.async",
    "wcstack.platformCapabilities",
    "wcstack.application",
]);
const EMPTY = Object.freeze([]);
/**
 * opt-in dev-time contract analysis。無効時はゼロコスト(即 return・manifest 非走査)。
 * 有効時は live 宣言と manifest を突き合わせ、`contract:*` trace を返しつつ、DevTools
 * sink が接続されていれば同時に流す。
 */
function analyzeContract(manifest) {
    if (!config.enableContractAnalyzer)
        return EMPTY;
    const events = [];
    const emit = (event) => {
        events.push(event);
        if (devtoolsSink !== null)
            devtoolsSink(event);
    };
    analyzeManifestContract(manifest, resolveLiveDeclaration, emit);
    return events;
}
/**
 * pure core。`resolveDeclaration(tag)` は該当タグの live 宣言(未登録なら null)を返す。
 * emit は生成した trace を受ける。config フラグは見ない(呼び出し側が guard 済み)。
 */
function analyzeManifestContract(manifest, resolveDeclaration, emit) {
    const extensions = manifest.manifestExtensions;
    if (extensions === null || typeof extensions !== "object")
        return;
    // 未知 namespace は runtime が解釈しない → unsupported-extension。
    for (const namespace of Object.keys(extensions)) {
        if (!KNOWN_NAMESPACES.has(namespace)) {
            emit({ type: "contract:unsupported-extension", namespace });
        }
    }
    const components = extensions["wcstack.types"]?.components;
    if (components === undefined || components === null)
        return;
    for (const [tag, component] of Object.entries(components)) {
        const live = resolveDeclaration(tag);
        emit({ type: "contract:manifest-read", tag, loaded: live !== null });
        if (live === null) {
            // manifest が宣言するタグが実行時に登録されていない = component-not-loaded drift。
            emit({ type: "contract:drift", reason: "component-not-loaded", tag });
            continue;
        }
        checkComponentDrift(tag, component, live, emit);
    }
}
function checkComponentDrift(tag, rawComponent, live, emit) {
    // 壊れた manifest(component が null / primitive)でも analyzer 全体を落とさない。
    const component = rawComponent !== null && typeof rawComponent === "object" ? rawComponent : {};
    for (const [member, observable] of Object.entries(component.observables ?? {})) {
        if (!live.propertyEvents.has(member)) {
            emit({ type: "contract:drift", reason: "missing-member", tag, member });
            continue;
        }
        const liveEvent = live.propertyEvents.get(member);
        const sidecarEvent = observable?.event;
        if (typeof sidecarEvent === "string" && sidecarEvent !== liveEvent) {
            emit({ type: "contract:drift", reason: "event-mismatch", tag, member, sidecarEvent, liveEvent });
        }
    }
    for (const member of Object.keys(component.inputs ?? {})) {
        if (!live.inputs.has(member)) {
            emit({ type: "contract:drift", reason: "missing-member", tag, member });
        }
    }
    for (const member of Object.keys(component.commands ?? {})) {
        if (!live.commands.has(member)) {
            emit({ type: "contract:drift", reason: "missing-member", tag, member });
        }
    }
}
/**
 * 登録済み custom element の `static wcBindable` を drift 照合用に索引化する。
 * 未登録・非 wc-bindable は null(= component-not-loaded)。
 */
function resolveLiveDeclaration(tag) {
    const registry = getCustomElementRegistry();
    const ctor = registry?.get(tag);
    if (ctor === undefined)
        return null;
    const declaration = ctor.wcBindable;
    if (declaration === null
        || typeof declaration !== "object"
        || declaration.protocol !== "wc-bindable") {
        return null;
    }
    const decl = declaration;
    // 各配列は非配列(object 等)でも落ちないよう Array.isArray で container を守る。
    const propertyEvents = new Map();
    for (const property of Array.isArray(decl.properties) ? decl.properties : []) {
        if (typeof property?.name === "string" && typeof property.event === "string") {
            propertyEvents.set(property.name, property.event);
        }
    }
    const inputs = new Set();
    for (const input of Array.isArray(decl.inputs) ? decl.inputs : []) {
        if (typeof input?.name === "string")
            inputs.add(input.name);
    }
    const commands = new Set();
    for (const command of Array.isArray(decl.commands) ? decl.commands : []) {
        if (typeof command?.name === "string")
            commands.add(command.name);
    }
    return { propertyEvents, inputs, commands };
}

export { Ssr, VERSION, WCS_MANIFEST_VERSION, analyzeContract, bootstrapState, buildBindings, builtinFilterMeta, defineState, getBindingsReady, getConfig, getWcsManifest };
//# sourceMappingURL=index.esm.js.map
