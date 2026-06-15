import { IConfig, IWritableConfig } from "./types.js";

interface IInternalConfig extends IConfig {
  tagNames: {
    defined: string;
  };
}

const _config: IInternalConfig = {
  tagNames: {
    defined: "wcs-defined",
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

// NOTE: arrays are intentionally NOT special-cased. The config shape is fixed and
// array-free (`{ tagNames: { defined: string } }`), so an array branch would be
// dead code that the 100% coverage gate could never exercise. If a future config
// field becomes an array, add `Array.isArray(obj)` handling here (and a test).
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone((obj as Record<string, unknown>)[key]);
  }
  return clone as T;
}

let frozenConfig: IConfig | null = null;

// Two views of the SAME `_config` object, by design:
//  - `config` (live, internal): bootstrapDefined reads the current tag name at
//    registration time, after any setConfig() override. Not exported.
//  - `getConfig()` (frozen, public): hands callers a deep-frozen snapshot they
//    cannot mutate; the cache is invalidated by setConfig() so the next read
//    re-freezes the updated values. There is no divergence — both project the
//    same underlying `_config`.
export const config: IConfig = _config as IConfig;

export function getConfig(): IConfig {
  if (!frozenConfig) {
    frozenConfig = deepFreeze(deepClone(_config));
  }
  return frozenConfig;
}

export function setConfig(partialConfig: IWritableConfig): void {
  if (partialConfig.tagNames) {
    Object.assign(_config.tagNames, partialConfig.tagNames);
  }
  frozenConfig = null;
}
