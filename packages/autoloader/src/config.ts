
import { IConfig, ILoader, IWritableConfig } from "./types.js"
import { load } from "./vanilla.js"

interface IInternalConfig extends IConfig {
  scanImportmap: boolean;
  loaders: Record<string, ILoader | string>;
  observable: boolean;
  tagNames: {
    autoloader: string;
  };
}

export const DEFAULT_KEY = "*";

export const VANILLA_KEY = "vanilla";

export const VANILLA_LOADER = {
  postfix: ".js",
  loader: load
}

const _config: IInternalConfig = {
  scanImportmap: true,
  loaders: {
    [VANILLA_KEY]: VANILLA_LOADER,
    [DEFAULT_KEY]: VANILLA_KEY
  },
  observable: true,
  tagNames: {
    autoloader: "wcs-autoloader"
  }
}

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

// 後方互換のため config もエクスポート（読み取り専用として使用）
export const config: IConfig = _config as IConfig;

export function getConfig(): IConfig {
  if (!frozenConfig) {
    frozenConfig = deepFreeze(deepClone(_config));
  }
  return frozenConfig;
}

export function setConfig(partialConfig: IWritableConfig): void {
  if (typeof partialConfig.scanImportmap === "boolean") {
    _config.scanImportmap = partialConfig.scanImportmap;
  }
  if (partialConfig.loaders) {
    Object.assign(_config.loaders, partialConfig.loaders);
  }
  if (typeof partialConfig.observable === "boolean") {
    _config.observable = partialConfig.observable;
  }
  if (partialConfig.tagNames) {
    Object.assign(_config.tagNames, partialConfig.tagNames);
  }
  frozenConfig = null;
}
