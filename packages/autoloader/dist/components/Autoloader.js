import { config } from "../config.js";
import { buildMap, loadImportmap } from "../importmap.js";
import { eagerLoad } from "../eagerload.js";
import { handlerForLazyLoad } from "../lazyLoad.js";
export class Autoloader extends HTMLElement {
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
//# sourceMappingURL=Autoloader.js.map