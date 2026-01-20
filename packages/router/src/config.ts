import { IConfig } from "./types";

interface IWritableConfig {
  tagNames: {
    route: string;
    router: string;
    outlet: string;
    layout: string;
    layoutOutlet: string;
    link: string;
  };
  enableShadowRoot: boolean;
  basenameFileExtensions: string[];
}

const _config: IWritableConfig = {
  tagNames: {
    route: "wcs-route",
    router: "wcs-router",
    outlet: "wcs-outlet",
    layout: "wcs-layout",
    layoutOutlet: "wcs-layout-outlet",
    link: "wcs-link"
  },
  enableShadowRoot: false,
  basenameFileExtensions: [".html"]
};

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze((obj as Record<string, unknown>)[key]);
  }
  return obj;
}

let frozenConfig: IConfig | null = null;

// 後方互換のため config もエクスポート（読み取り専用として使用）
export const config: IConfig = _config as IConfig;

export function getConfig(): IConfig {
  if (!frozenConfig) {
    frozenConfig = deepFreeze(_config);
  }
  return frozenConfig;
}

export function setConfig(partialConfig: Partial<IConfig>): void {
  if (partialConfig.tagNames) {
    Object.assign(_config.tagNames, partialConfig.tagNames);
  }
  if (typeof partialConfig.enableShadowRoot === "boolean") {
    _config.enableShadowRoot = partialConfig.enableShadowRoot;
  }
  if (Array.isArray(partialConfig.basenameFileExtensions)) {
    _config.basenameFileExtensions = partialConfig.basenameFileExtensions;
  }
  frozenConfig = null;
}
