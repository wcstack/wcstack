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

async function load(path) {
    const module = await import(path);
    return module.default;
}

const DEFAULT_KEY = "*";
const VANILLA_KEY = "vanilla";
const VANILLA_LOADER = {
    postfix: ".js",
    loader: load
};
const DEFAULT_CONFIG = {
    scanImportmap: true,
    loaders: {
        [VANILLA_KEY]: VANILLA_LOADER,
        [DEFAULT_KEY]: VANILLA_KEY
    },
    observable: true
};
const config = DEFAULT_CONFIG;

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
const loadingTags = new Set();

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
async function tagLoad(tagInfo, config, prefixMap) {
    const info = matchNameSpace(tagInfo.name, prefixMap);
    if (info === null) {
        throw new Error("No matching namespace found for lazy loaded component: " + tagInfo.name);
    }
    if (loadingTags.has(tagInfo.name)) {
        await customElements.whenDefined(tagInfo.name);
        return;
    }
    loadingTags.add(tagInfo.name);
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
        if (customElements.get(tagInfo.name)) {
            // すでに定義済み
            return;
        }
        const componentConstructor = await loader.loader(path);
        if (componentConstructor !== null) {
            if (customElements.get(tagInfo.name)) {
                // すでに定義済み
                return;
            }
            if (tagInfo.extends === null) {
                customElements.define(tagInfo.name, componentConstructor);
            }
            else {
                customElements.define(tagInfo.name, componentConstructor, { extends: tagInfo.extends });
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
    finally {
        loadingTags.delete(tagInfo.name);
    }
}
//
async function lazyLoad(root, config, prefixMap) {
    const elements = [];
    // Create TreeWalker (target element and comment nodes)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, (node) => {
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
        const customClass = customElements.get(tagInfo.name);
        if (customClass === undefined) {
            // undefined
            customElements.whenDefined(tagInfo.name).then(async () => {
                // upgraded
                await checkObserveShadowRoot(element, config, prefixMap);
            });
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
        await tagLoad(tagInfo, config, prefixMap);
        tagCount++;
    }
    return tagCount;
}
async function lazyLoads(root, config, prefixMap) {
    while (await lazyLoad(root, config, prefixMap) > 0) {
        // Repeat until no more tags to load
    }
}
async function handlerForLazyLoad(root, config, prefixMap) {
    if (Object.keys(prefixMap).length === 0) {
        return;
    }
    try {
        await lazyLoads(root, config, prefixMap);
    }
    catch (e) {
        throw new Error("Failed to lazy load components: " + e);
    }
    if (!config.observable) {
        return;
    }
    const mo = new MutationObserver(async () => {
        try {
            await lazyLoads(root, config, prefixMap);
        }
        catch (e) {
            console.error("Failed to lazy load components: " + e);
        }
    });
    mo.observe(root, { childList: true, subtree: true });
}

async function registerHandler() {
    const importmap = loadImportmap(); // 事前に importmap を読み込んでおく
    if (importmap === null) {
        return;
    }
    const { prefixMap, loadMap } = buildMap(importmap);
    // 先にeager loadを実行すると、DOMContentLoadedイベントが発生しないことがあるため、後に実行する
    document.addEventListener("DOMContentLoaded", async () => {
        await handlerForLazyLoad(document, config, prefixMap);
    });
    try {
        await eagerLoad(loadMap, config.loaders);
    }
    catch (e) {
        throw new Error("Failed to eager load components: " + e);
    }
}

function addLoader(key, loader) {
    config.loaders[key] = loader;
}

export { DEFAULT_KEY, VANILLA_KEY, VANILLA_LOADER, addLoader, config, registerHandler };
//# sourceMappingURL=index.esm.js.map
