const _config = {
    bindAttributeName: 'data-wcs',
    commentTextPrefix: 'wcs-text',
    commentForPrefix: 'wcs-for',
    commentIfPrefix: 'wcs-if',
    commentElseIfPrefix: 'wcs-elseif',
    commentElsePrefix: 'wcs-else',
    tagNames: {
        state: 'wcs-state',
    },
    locale: 'en',
    debug: false,
    enableMustache: true,
};
// backward compatible export (read-only usage)
export const config = _config;
export function setConfig(partialConfig) {
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
}
//# sourceMappingURL=config.js.map