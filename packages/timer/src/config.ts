import { IConfig, IWritableConfig } from "./types.js";

interface IInternalConfig extends IConfig {
  autoTrigger: boolean;
  triggerAttribute: string;
  tagNames: {
    timer: string;
  };
}

const _config: IInternalConfig = {
  autoTrigger: true,
  triggerAttribute: "data-timertarget",
  tagNames: {
    timer: "wcs-timer",
  },
};

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze((obj as Record<string, unknown>)[key]);
  }
  return obj;
}

function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone((obj as Record<string, unknown>)[key]);
  }
  return clone as T;
}

let frozenConfig: IConfig | null = null;

// Internal-only live handle to the mutable config. NOT part of the public API
// (deliberately absent from exports.ts) — it is exported solely so sibling
// modules in this package can read current settings cheaply. External consumers
// must use getConfig() (returns a deep-frozen snapshot) / setConfig(). Mutating
// this object directly bypasses the frozenConfig cache and is unsupported.
export const config: IConfig = _config as IConfig;

export function getConfig(): IConfig {
  if (!frozenConfig) {
    frozenConfig = deepFreeze(deepClone(_config));
  }
  return frozenConfig;
}

export function setConfig(partialConfig: IWritableConfig): void {
  if (typeof partialConfig.autoTrigger === "boolean") {
    _config.autoTrigger = partialConfig.autoTrigger;
  }
  if (typeof partialConfig.triggerAttribute === "string") {
    _config.triggerAttribute = partialConfig.triggerAttribute;
  }
  if (partialConfig.tagNames) {
    Object.assign(_config.tagNames, partialConfig.tagNames);
  }
  frozenConfig = null;
}
