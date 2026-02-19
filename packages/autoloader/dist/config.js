import { load } from "./vanilla.js";
export const DEFAULT_KEY = "*";
export const VANILLA_KEY = "vanilla";
export const VANILLA_LOADER = {
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
export const config = _config;
export function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
export function setConfig(partialConfig) {
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
//# sourceMappingURL=config.js.map