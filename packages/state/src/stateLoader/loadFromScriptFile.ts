import { raiseError } from "../raiseError";
import { IState } from "../types";

export async function loadFromScriptFile(url: string): Promise<IState> {
  try {
    const module = await import(/* @vite-ignore */ url);
    return module.default || {};
  } catch (e) {
    raiseError(`Failed to load script file: ${e}`);
  }
}
