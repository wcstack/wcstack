import { DEFAULT_KEY } from "./config.js";
export function resolveLoader(path, loaderKey, loaders) {
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
//# sourceMappingURL=resolveLoader.js.map