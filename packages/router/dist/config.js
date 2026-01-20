const _config = {
    tagNames: {
        route: "wcs-route",
        router: "wcs-router",
        outlet: "wcs-outlet",
        layout: "wcs-layout",
        layoutOutlet: "wcs-layout-outlet",
        link: "wcs-link",
        head: "wcs-head"
    },
    enableShadowRoot: false,
    basenameFileExtensions: [".html"]
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
let frozenConfig = null;
// 後方互換のため config もエクスポート（読み取り専用として使用）
export const config = _config;
export function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(_config);
    }
    return frozenConfig;
}
export function setConfig(partialConfig) {
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    if (typeof partialConfig.enableShadowRoot === "boolean") {
        _config.enableShadowRoot = partialConfig.enableShadowRoot;
    }
    if (Array.isArray(partialConfig.basenameFileExtensions)) {
        _config.basenameFileExtensions = partialConfig.basenameFileExtensions;
    }
    frozenConfig = null;
}
//# sourceMappingURL=config.js.map