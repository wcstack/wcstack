import { setConfig } from "./config";
import { registerComponents } from "./registerComponents";
export function bootstrapState(config) {
    if (config) {
        setConfig(config);
    }
    registerComponents();
}
//# sourceMappingURL=bootstrapState.js.map