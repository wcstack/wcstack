const _config = {
    tagNames: {
        route: "wcs-route",
        router: "wcs-router",
        outlet: "wcs-outlet",
        layout: "wcs-layout",
        layoutOutlet: "wcs-layout-outlet",
        link: "wcs-link"
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
// 後方互換のため config もエクスポート（読み取り専用として使用）
export const config = _config;
export function getConfig() {
    return deepFreeze(_config);
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
}
//# sourceMappingURL=config.js.map