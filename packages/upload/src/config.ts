import { IConfig, IWritableConfig } from "./types.js";

interface IInternalConfig extends IConfig {
  autoTrigger: boolean;
  triggerAttribute: string;
  tagNames: {
    upload: string;
  };
}

const _config: IInternalConfig = {
  autoTrigger: true,
  triggerAttribute: "data-uploadtarget",
  tagNames: {
    upload: "wcs-upload",
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

// `config` は内部用のライブビュー（live view）。setConfig() の更新が即座に反映される
// 実体 `_config` をそのまま公開しており、凍結もクローンもしていない。autoTrigger /
// components など同パッケージ内のモジュールが最新値を読むための窓口であり、
// 「変更不可なスナップショット」が必要な外部利用には getConfig()（凍結クローンを返す）
// を使うこと。型が readonly なのは内部からの誤書き換えを抑止するための表明にすぎない。
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
