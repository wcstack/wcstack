async function load(path) {
    const module = await import(`${path}`);
    return module.default;
}

const DEFAULT_KEY = "*";
const VANILLA_KEY = "vanilla";
const VANILLA_LOADER = {
    postfix: ".js",
    loader: load
};
const _config = {
    scanImportmap: true,
    loaders: {
        [VANILLA_KEY]: VANILLA_LOADER,
        [DEFAULT_KEY]: VANILLA_KEY
    },
    observable: true,
    tagNames: {
        autoloader: "wcs-autoloader"
    }
};
function deepFreeze(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        deepFreeze(obj[key]);
    }
    return obj;
}
function deepClone(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    const clone = {};
    for (const key of Object.keys(obj)) {
        clone[key] = deepClone(obj[key]);
    }
    return clone;
}
let frozenConfig = null;
// 後方互換のため config もエクスポート（読み取り専用として使用）
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
function setConfig(partialConfig) {
    if (typeof partialConfig.scanImportmap === "boolean") {
        _config.scanImportmap = partialConfig.scanImportmap;
    }
    if (partialConfig.loaders) {
        Object.assign(_config.loaders, partialConfig.loaders);
    }
    if (typeof partialConfig.observable === "boolean") {
        _config.observable = partialConfig.observable;
    }
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

const COMPONENT_KEYWORD = "@components/";
function loadImportmap() {
    const importmap = { imports: {} };
    document.querySelectorAll('script[type="importmap"]').forEach((script) => {
        try {
            const json = JSON.parse(script.innerHTML);
            if (json.imports) {
                importmap.imports = Object.assign(importmap.imports, json.imports);
            }
        }
        catch (e) {
            throw new Error("Failed to parse importmap JSON: " + e);
        }
    });
    return Object.keys(importmap.imports).length > 0
        ? importmap
        : null;
}
function getKeyInfoFromImportmapKey(key) {
    if (key.startsWith(COMPONENT_KEYWORD)) {
        if (key.endsWith("/")) {
            const prefixWithLoader = key.slice(COMPONENT_KEYWORD.length, key.length - 1);
            const [prefix, loaderKey] = prefixWithLoader.split("|", 2);
            if (prefix === "") {
                throw new Error("Invalid importmap key: " + key);
            }
            return {
                key,
                prefix: prefix.replaceAll("/", "-").toLowerCase(),
                loaderKey: loaderKey ?? null,
                isNameSpaced: true
            };
        }
        else {
            const tagNamePart = key.slice(COMPONENT_KEYWORD.length);
            const [tagName, loaderKeyPart] = tagNamePart.split("|", 2);
            const [loaderKey, extendsText] = (loaderKeyPart ?? "").split(",", 2);
            if (tagName === "") {
                throw new Error("Invalid importmap key: " + key);
            }
            return {
                key,
                tagName: tagName.replaceAll("/", "-").toLowerCase(),
                loaderKey: loaderKey || null,
                extends: extendsText || null,
                isNameSpaced: false
            };
        }
    }
    return null;
}
function buildMap(importmap) {
    const prefixMap = {};
    const loadMap = {};
    for (const [key, _value] of Object.entries(importmap.imports)) {
        const keyInfo = getKeyInfoFromImportmapKey(key);
        if (keyInfo === null) {
            continue;
        }
        if (keyInfo.isNameSpaced) {
            prefixMap[keyInfo.prefix] = keyInfo;
        }
        else {
            loadMap[keyInfo.tagName] = keyInfo;
        }
    }
    return { prefixMap, loadMap };
}

function resolveLoader(path, loaderKey, loaders) {
    let loader;
    if (loaderKey === null || loaderKey === DEFAULT_KEY || loaderKey === "") {
        // Try to resolve by postfix
        let resolvedLoader = null;
        const candidates = [];
        for (const [key, l] of Object.entries(loaders)) {
            if (key === DEFAULT_KEY)
                continue;
            const currentLoader = typeof l === "string" ? loaders[l] : l;
            if (typeof currentLoader === "string")
                continue; // Should not happen if config is correct
            candidates.push(currentLoader);
        }
        // Sort by postfix length descending to match longest extension first
        candidates.sort((a, b) => b.postfix.length - a.postfix.length);
        for (const currentLoader of candidates) {
            if (path.endsWith(currentLoader.postfix)) {
                resolvedLoader = currentLoader;
                break;
            }
        }
        if (resolvedLoader) {
            loader = resolvedLoader;
        }
        else {
            loader = loaders[DEFAULT_KEY];
            if (typeof loader === "string") {
                loader = loaders[loader];
            }
        }
    }
    else {
        loader = loaders[loaderKey];
        if (!loader) {
            throw new Error("Loader not found: " + loaderKey);
        }
    }
    if (typeof loader === "string") {
        throw new Error("Loader redirection is not supported here");
    }
    return loader;
}

const failedTags = new Set();
// The in-flight load per tag, so a second caller can await the load itself
// rather than the definition. A load that fails never defines its tag, so
// waiting on whenDefined() instead would wait forever.
const loadingTags = new Map();
// Scoped registries each need their own define() call for the same tag, so an
// in-flight load in one registry must not make another registry skip its own.
// The module import itself is shared by the loader's own cache. The global
// registry keeps using the exported `loadingTags` so direct inspection works.
let loadingTagsByRegistry = new WeakMap();
function getLoadingTags(registry) {
    if (registry === globalThis.customElements) {
        return loadingTags;
    }
    let tags = loadingTagsByRegistry.get(registry);
    if (tags === undefined) {
        tags = new Map();
        loadingTagsByRegistry.set(registry, tags);
    }
    return tags;
}

const EXTENDS_MAP = new Map();
if (typeof window !== "undefined") {
    const map = [
        [HTMLButtonElement, "button"],
        [HTMLInputElement, "input"],
        [HTMLAnchorElement, "a"],
        [HTMLImageElement, "img"],
        [HTMLDivElement, "div"],
        [HTMLSpanElement, "span"],
        [HTMLParagraphElement, "p"],
        [HTMLUListElement, "ul"],
        [HTMLOListElement, "ol"],
        [HTMLLIElement, "li"],
        [HTMLTableElement, "table"],
        [HTMLFormElement, "form"],
        [HTMLLabelElement, "label"],
        [HTMLSelectElement, "select"],
        [HTMLTextAreaElement, "textarea"],
        [HTMLHeadingElement, "h1"],
        [HTMLQuoteElement, "blockquote"],
        [HTMLPreElement, "pre"],
        [HTMLBRElement, "br"],
        [HTMLHRElement, "hr"],
        [HTMLModElement, "ins"],
        [HTMLTableCaptionElement, "caption"],
        [HTMLTableColElement, "col"],
        [HTMLTableSectionElement, "tbody"],
        [HTMLTableRowElement, "tr"],
        [HTMLTableCellElement, "td"],
        [HTMLFieldSetElement, "fieldset"],
        [HTMLLegendElement, "legend"],
        [HTMLDListElement, "dl"],
        [HTMLOptGroupElement, "optgroup"],
        [HTMLOptionElement, "option"],
        [HTMLStyleElement, "style"],
        [HTMLScriptElement, "script"],
        [HTMLTemplateElement, "template"],
        [HTMLCanvasElement, "canvas"],
        [HTMLIFrameElement, "iframe"],
        [HTMLObjectElement, "object"],
        [HTMLEmbedElement, "embed"],
        [HTMLVideoElement, "video"],
        [HTMLAudioElement, "audio"],
        [HTMLTrackElement, "track"],
        [HTMLMapElement, "map"],
        [HTMLAreaElement, "area"],
        [HTMLSourceElement, "source"],
        [HTMLParamElement, "param"],
        [HTMLMeterElement, "meter"],
        [HTMLProgressElement, "progress"],
        [HTMLOutputElement, "output"],
        [HTMLDetailsElement, "details"],
        [HTMLDialogElement, "dialog"],
        [HTMLMenuElement, "menu"],
        [HTMLSlotElement, "slot"],
        [HTMLTimeElement, "time"],
        [HTMLDataElement, "data"],
        [HTMLPictureElement, "picture"],
    ];
    map.forEach(([cls, tag]) => {
        /* istanbul ignore next */
        if (typeof cls !== "undefined") {
            EXTENDS_MAP.set(cls, tag);
        }
    });
}
function resolveExtends(componentConstructor) {
    for (const [cls, tag] of EXTENDS_MAP) {
        if (componentConstructor.prototype instanceof cls) {
            return tag;
        }
    }
    return null;
}
async function eagerLoadItem(info, tagName, loader) {
    try {
        if (customElements.get(tagName)) {
            // すでに定義済み
            return;
        }
        const componentConstructor = await loader.loader(info.key);
        if (componentConstructor !== null) {
            let extendsName = info.extends;
            if (extendsName === null) {
                extendsName = resolveExtends(componentConstructor);
            }
            if (customElements.get(tagName)) {
                // すでに定義済み
                return;
            }
            if (extendsName === null) {
                customElements.define(tagName, componentConstructor);
            }
            else {
                customElements.define(tagName, componentConstructor, { extends: extendsName });
            }
        }
    }
    catch (e) {
        if (!failedTags.has(tagName)) {
            console.error(`Failed to eager load component '${tagName}':`, e);
            failedTags.add(tagName);
        }
    }
}
async function eagerLoad(loadMap, loaders) {
    const promises = [];
    for (const [tagName, info] of Object.entries(loadMap)) {
        let loader;
        try {
            loader = resolveLoader(info.key, info.loaderKey, loaders);
        }
        catch (_e) {
            throw new Error("Loader redirection is not supported for eager loaded components: " + tagName);
        }
        promises.push(eagerLoadItem(info, tagName, loader));
    }
    await Promise.all(promises);
}

function toAdapter(registry) {
    if (typeof registry !== "object" || registry === null)
        return null;
    const candidate = registry;
    if (typeof candidate.get !== "function"
        || typeof candidate.whenDefined !== "function"
        || typeof candidate.define !== "function") {
        return null;
    }
    return candidate;
}
/**
 * Resolve the registry that governs `root`.
 *
 * Scoped registries do not inherit from the global one, so defining a lazily
 * loaded tag globally leaves a scoped subtree's elements un-upgraded forever --
 * and the `whenDefined` used to chase their shadow content never resolves.
 * Autoloading therefore has to define into the registry the scanned root itself
 * resolves against. Roots on platforms without scoped registries report
 * `undefined` and fall back to the global registry.
 */
function getCustomElementRegistry(root = null) {
    if (root !== null && typeof root !== "undefined") {
        const scoped = root.customElementRegistry;
        if (scoped === null)
            return null;
        if (typeof scoped !== "undefined")
            return toAdapter(scoped);
    }
    return toAdapter(globalThis.customElements);
}

const isCustomElement = (node) => {
    return (node instanceof Element && (node.tagName.includes("-") || node.getAttribute("is")?.includes("-"))) ?? false;
};
function getCustomTagInfo(e) {
    const elementTagName = e.tagName.toLowerCase();
    let name;
    let extendsName;
    if (elementTagName.includes("-")) {
        name = elementTagName;
        extendsName = null;
    }
    else {
        const tagName = e.getAttribute("is");
        if (tagName === null) {
            throw new Error("Custom element without a dash or 'is' attribute found: " + elementTagName);
        }
        if (!tagName.includes("-")) {
            throw new Error("Custom element 'is' attribute without a dash found: " + elementTagName);
        }
        name = tagName;
        extendsName = elementTagName;
    }
    return { name, extends: extendsName };
}
const observedCustomElements = new WeakSet();
// Elements that already carry a whenDefined() follow-up. `lazyLoads` rescans
// until nothing more loads, and the MutationObserver reruns it on every DOM
// change, so without this an element whose tag never gets defined collects one
// never-settling continuation per scan.
const upgradeWatchedElements = new WeakSet();
async function observeShadowRoot(element, config, prefixMap) {
    observedCustomElements.add(element);
    await handlerForLazyLoad(element.shadowRoot, config, prefixMap);
}
async function checkObserveShadowRoot(element, config, prefixMap) {
    if (element.shadowRoot) {
        if (!observedCustomElements.has(element)) {
            await observeShadowRoot(element, config, prefixMap);
        }
    }
}
function matchNameSpace(tagName, prefixMap) {
    for (const [prefix, info] of Object.entries(prefixMap)) {
        if (tagName.startsWith(prefix + "-")) {
            return info;
        }
    }
    return null;
}
async function tagLoad(tagInfo, config, prefixMap, registry) {
    const info = matchNameSpace(tagInfo.name, prefixMap);
    if (info === null) {
        throw new Error("No matching namespace found for lazy loaded component: " + tagInfo.name);
    }
    const loadingTags = getLoadingTags(registry);
    const inFlight = loadingTags.get(tagInfo.name);
    if (inFlight !== undefined) {
        // Wait on the load itself, never on the definition: a load that fails never
        // defines the tag, so whenDefined() would stay pending forever and wedge
        // every caller above — including the one that installs the MutationObserver,
        // which stops all further lazy loading on the page.
        await inFlight;
        return;
    }
    const load = performTagLoad(tagInfo, config, info, registry);
    loadingTags.set(tagInfo.name, load);
    try {
        await load;
    }
    finally {
        loadingTags.delete(tagInfo.name);
    }
}
// Never rejects: a failure is reported and recorded in `failedTags`, which keeps
// the tag out of later scans.
async function performTagLoad(tagInfo, config, info, registry) {
    try {
        let loader;
        try {
            loader = resolveLoader("", info.loaderKey, config.loaders);
        }
        catch (_e) {
            throw new Error("Loader redirection is not supported for lazy loaded components: " + tagInfo.name);
        }
        const file = tagInfo.name.slice(info.prefix.length + 1);
        if (file === "") {
            throw new Error("Invalid component name for lazy loaded component: " + tagInfo.name);
        }
        const path = info.key + file + loader.postfix;
        if (registry.get(tagInfo.name)) {
            // すでに定義済み
            return;
        }
        const componentConstructor = await loader.loader(path);
        if (componentConstructor !== null) {
            if (registry.get(tagInfo.name)) {
                // すでに定義済み
                return;
            }
            if (tagInfo.extends === null) {
                registry.define(tagInfo.name, componentConstructor);
            }
            else {
                registry.define(tagInfo.name, componentConstructor, { extends: tagInfo.extends });
            }
        }
        else {
            throw new Error("Loader returned null for component: " + tagInfo.name);
        }
    }
    catch (e) {
        console.error(`Failed to lazy load component '${tagInfo.name}':`, e);
        failedTags.add(tagInfo.name);
    }
}
//
async function lazyLoad(root, config, prefixMap, registry) {
    const elements = [];
    // Create TreeWalker (target element and comment nodes)
    const walker = (root.ownerDocument ?? root).createTreeWalker(root, NodeFilter.SHOW_ELEMENT, (node) => {
        return isCustomElement(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    });
    // Move to next node with TreeWalker and add matching nodes to array
    while (walker.nextNode()) {
        elements.push(walker.currentNode);
    }
    const tagInfos = [];
    const tagNames = new Set();
    for (const element of elements) {
        const tagInfo = getCustomTagInfo(element);
        const customClass = registry.get(tagInfo.name);
        if (customClass === undefined) {
            // undefined
            if (!upgradeWatchedElements.has(element)) {
                upgradeWatchedElements.add(element);
                registry.whenDefined(tagInfo.name).then(async () => {
                    // upgraded
                    await checkObserveShadowRoot(element, config, prefixMap);
                });
            }
            if (!tagNames.has(tagInfo.name) && !failedTags.has(tagInfo.name)) {
                tagNames.add(tagInfo.name);
                tagInfos.push(tagInfo);
            }
        }
        else {
            // upgraded
            await checkObserveShadowRoot(element, config, prefixMap);
        }
    }
    let tagCount = 0;
    for (const tagInfo of tagInfos) {
        await tagLoad(tagInfo, config, prefixMap, registry);
        tagCount++;
    }
    return tagCount;
}
async function lazyLoads(root, config, prefixMap, registry) {
    while (await lazyLoad(root, config, prefixMap, registry) > 0) {
        // Repeat until no more tags to load
    }
}
async function handlerForLazyLoad(root, config, prefixMap) {
    if (Object.keys(prefixMap).length === 0) {
        return null;
    }
    // Definitions must land in the registry this root resolves against: a scoped
    // registry does not see global definitions, so defining globally would leave
    // these elements un-upgraded and the whenDefined below pending forever.
    const registry = getCustomElementRegistry(root);
    if (registry === null) {
        // A null-registry root cannot receive definitions at all until someone calls
        // registry.initialize() on it, so there is nothing autoloading can do here.
        console.error("Cannot autoload components: the root has a null custom element registry.");
        return null;
    }
    try {
        await lazyLoads(root, config, prefixMap, registry);
    }
    catch (e) {
        throw new Error("Failed to lazy load components: " + e);
    }
    if (!config.observable) {
        return null;
    }
    const mo = new MutationObserver(async () => {
        try {
            await lazyLoads(root, config, prefixMap, registry);
        }
        catch (e) {
            console.error("Failed to lazy load components: " + e);
        }
    });
    mo.observe(root, { childList: true, subtree: true });
    return mo;
}

class Autoloader extends HTMLElement {
    static _instance = null;
    _initialized = false;
    _prefixMap = null;
    _observer = null;
    constructor() {
        super();
        if (Autoloader._instance) {
            throw new Error(`${config.tagNames.autoloader} can only be instantiated once.`);
        }
        Autoloader._instance = this;
        const importmap = loadImportmap();
        if (importmap) {
            const { prefixMap, loadMap } = buildMap(importmap);
            this._prefixMap = prefixMap;
            eagerLoad(loadMap, config.loaders).catch((e) => {
                console.error("Failed to eager load components:", e);
            });
        }
    }
    async connectedCallback() {
        if (!this._initialized) {
            this._initialized = true;
            if (this._prefixMap) {
                if (document.readyState === "loading") {
                    await new Promise((r) => document.addEventListener("DOMContentLoaded", () => r(), {
                        once: true,
                    }));
                }
                this._observer = await handlerForLazyLoad(document, config, this._prefixMap);
            }
        }
    }
    disconnectedCallback() {
        this._observer?.disconnect();
        this._observer = null;
        if (Autoloader._instance === this) {
            Autoloader._instance = null;
        }
    }
}

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
function registerComponents(registry = customElements) {
    if (!registry.get(config.tagNames.autoloader)) {
        registry.define(config.tagNames.autoloader, Autoloader);
    }
}

function bootstrapAutoloader(config, registry) {
    if (config) {
        setConfig(config);
    }
    registerComponents(registry);
}

export { bootstrapAutoloader, getConfig };
//# sourceMappingURL=index.esm.js.map
