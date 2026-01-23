import { setConfig } from "./config.js";
import { registerHandler } from "./registerHandler.js";
export async function bootstrapAutoloader(config) {
    if (config) {
        setConfig(config);
    }
    await registerHandler();
}
//# sourceMappingURL=bootstrapAutoloader.js.map