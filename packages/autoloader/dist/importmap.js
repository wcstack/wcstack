const COMPONENT_KEYWORD = "@components/";
export function loadImportmap() {
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
export function buildMap(importmap) {
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
//# sourceMappingURL=importmap.js.map