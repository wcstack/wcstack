import { raiseError } from "../raiseError";
export async function loadFromScriptFile(url) {
    try {
        const module = await import(/* @vite-ignore */ url);
        return module.default || {};
    }
    catch (e) {
        raiseError(`Failed to load script file: ${e}`);
    }
}
//# sourceMappingURL=loadFromScriptFile.js.map