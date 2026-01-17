import { buildMap, loadImportmap } from "./importmap.js";
import { config } from "./config.js";
import { eagerLoad } from "./eagerload.js";
import { handlerForLazyLoad } from "./lazyLoad.js";
export async function registerHandler() {
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
//# sourceMappingURL=handler.js.map