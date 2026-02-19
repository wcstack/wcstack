import { setConfig } from "./config.js";
import { registerComponents } from "./registerComponents.js";
export function bootstrapAutoloader(config) {
    if (config) {
        setConfig(config);
    }
    registerComponents();
}
//# sourceMappingURL=bootstrapAutoloader.js.map