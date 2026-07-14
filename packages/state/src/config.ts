import { IConfig, IWritableConfig } from "./types.js";

export function inSsr(): boolean {
  // キャッシュしない: SSR モードはプロセスの属性ではなく「現在の document」の
  // 属性。@wcstack/server はグローバル document を差し替えてサーバーレンダリング
  // した後、同一プロセスでクライアント側ハイドレーションが走る（SSR→hydrate の
  // e2e が該当）。サーバーフェーズの判定をキャッシュするとクライアントフェーズが
  // SSR モード扱いになり、hydrateBindings の代わりに buildBindings が選ばれて
  // connectedCallbackPromise が永久に未解決になる。
  const html = document.documentElement;
  return html ? html.hasAttribute('data-wcs-server') : false;
}

interface IInternalConfig {
  bindAttributeName: string;
  commentTextPrefix: string;
  commentForPrefix: string;
  commentIfPrefix: string;
  commentElseIfPrefix: string;
  commentElsePrefix: string;
  tagNames: {
    state: string;
    ssr: string;
  };
  locale: string;
  debug: boolean;
  enableMustache: boolean;
  enableDirectionalInitialSync: boolean;
  sameValueGuard: boolean;
}

const _config: IInternalConfig = {
  bindAttributeName: 'data-wcs',
  commentTextPrefix: 'wcs-text',
  commentForPrefix: 'wcs-for',
  commentIfPrefix: 'wcs-if',
  commentElseIfPrefix: 'wcs-elseif',
  commentElsePrefix: 'wcs-else',
  tagNames: {
    state: 'wcs-state',
    ssr: 'wcs-ssr',
  },
  locale: 'en',
  debug: false,
  enableMustache: true,
  enableDirectionalInitialSync: false,
  sameValueGuard: true,
};

// backward compatible export (read-only usage)
export const config: IConfig = _config as IConfig;

export function getConfig(): IConfig {
  return config;
}

export function setConfig(partialConfig: IWritableConfig): void {
  if (partialConfig.tagNames) {
    Object.assign(_config.tagNames, partialConfig.tagNames);
  }
  if (typeof partialConfig.bindAttributeName === "string") {
    _config.bindAttributeName = partialConfig.bindAttributeName;
  }
  if (typeof partialConfig.commentTextPrefix === "string") {
    _config.commentTextPrefix = partialConfig.commentTextPrefix;
  }
  if (typeof partialConfig.commentForPrefix === "string") {
    _config.commentForPrefix = partialConfig.commentForPrefix;
  }
  if (typeof partialConfig.commentIfPrefix === "string") {
    _config.commentIfPrefix = partialConfig.commentIfPrefix;
  }
  if (typeof partialConfig.commentElseIfPrefix === "string") {
    _config.commentElseIfPrefix = partialConfig.commentElseIfPrefix;
  }
  if (typeof partialConfig.commentElsePrefix === "string") {
    _config.commentElsePrefix = partialConfig.commentElsePrefix;
  }
  if (typeof partialConfig.locale === "string") {
    _config.locale = partialConfig.locale;
  }
  if (typeof partialConfig.debug === "boolean") {
    _config.debug = partialConfig.debug;
  }
  if (typeof partialConfig.enableMustache === "boolean") {
    _config.enableMustache = partialConfig.enableMustache;
  }
  if (typeof partialConfig.enableDirectionalInitialSync === "boolean") {
    _config.enableDirectionalInitialSync = partialConfig.enableDirectionalInitialSync;
  }
  if (typeof partialConfig.sameValueGuard === "boolean") {
    _config.sameValueGuard = partialConfig.sameValueGuard;
  }
}
