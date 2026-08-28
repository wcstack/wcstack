import { Window } from 'happy-dom';

/**
 * globalThis を差し替える renderToString の並列実行を防止する Mutex。
 * 同一 Node プロセス内で複数リクエストが同時に renderToString を呼んでも
 * シリアライズされ、グローバル状態の衝突を防ぐ。
 */
class Mutex {
  private _queue: (() => void)[] = [];
  private _locked = false;

  async acquire(): Promise<() => void> {
    if (this._locked) {
      await new Promise<void>(resolve => this._queue.push(resolve));
    }
    this._locked = true;
    return () => {
      this._locked = false;
      this._queue.shift()?.();
    };
  }
}

const renderMutex = new Mutex();

export const GLOBALS_KEYS = [
  'document', 'customElements', 'HTMLElement',
  'DocumentFragment', 'Node', 'NodeFilter', 'Comment', 'Text',
  'MutationObserver', 'ShadowRoot', 'Element', 'HTMLTemplateElement',
  // URL を持つコンポーネント（@wcstack/router 等）が window.location /
  // history を読めるようにする（docs/ssr-router-design.md §3.1）。
  'window', 'location', 'history',
];

export function installGlobals(window: Window): () => void {
  const saved: Record<string, any> = {};
  for (const key of GLOBALS_KEYS) {
    saved[key] = (globalThis as any)[key];
    (globalThis as any)[key] = (window as any)[key];
  }
  // URL.createObjectURL を無効化して、
  // loadFromInnerScript が base64 data: URL フォールバックを使うようにする
  const origCreateObjectURL = URL.createObjectURL;
  (URL as any).createObjectURL = undefined;
  return () => {
    URL.createObjectURL = origCreateObjectURL;
    for (const key of GLOBALS_KEYS) {
      (globalThis as any)[key] = saved[key];
    }
  };
}

export function installBaseUrl(baseUrl: string): () => void {
  const OrigURL = globalThis.URL;
  const base = baseUrl;
  globalThis.URL = class extends OrigURL {
    constructor(input: string | URL, inputBase?: string | URL) {
      if (typeof input === 'string' && input.startsWith('/') && inputBase === undefined) {
        super(input, base);
      } else {
        super(input as string, inputBase);
      }
    }
  } as typeof URL;
  // 静的メソッドを引き継ぐ
  globalThis.URL.createObjectURL = OrigURL.createObjectURL;
  globalThis.URL.revokeObjectURL = OrigURL.revokeObjectURL;
  return () => { globalThis.URL = OrigURL; };
}

/** @deprecated Use Ssr.extractStateData() from @wcstack/state instead */
export function extractStateData(stateEl: any): Record<string, any> {
  const raw = (stateEl as any).__state;
  if (!raw || typeof raw !== 'object') return {};
  const data: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('$') && typeof value !== 'function') {
      data[key] = value;
    }
  }
  return data;
}

/**
 * 同期の bootstrap 関数、または非同期ローダー。
 * `HTMLElement` を継承するクラスはモジュール評価時にグローバルの `HTMLElement` を
 * 参照するため、純 Node 環境ではトップレベル import できないパッケージがある。
 * その場合は `async () => (await import('@wcstack/router')).bootstrapRouter()` の
 * ように非同期ローダーを渡す — 呼び出しは installGlobals の後なので、モジュール
 * 評価時にはグローバルが揃っている（docs/ssr-router-design.md §3.1）。
 */
export type BootstrapFunction = () => void | Promise<void>;

export interface RenderOptions {
  /** 相対 URL を解決するベース URL (例: "http://localhost:3001")。省略時は `url` の origin */
  baseUrl?: string;
  /** bootstrap 関数の配列。省略時は @wcstack/state を自動ロード */
  bootstraps?: BootstrapFunction[];
  /**
   * このリクエストの完全 URL (例: "http://localhost:3000/products/1")。
   * `window.location` / `document.baseURI` に反映される。ルーティングする
   * コンポーネント（@wcstack/router 等）のサーバーレンダリングに必要
   * （docs/ssr-router-design.md §3.1）。
   */
  url?: string;
  /**
   * `<head>` へ注入する `<base href>` の値。`url` 指定時の既定は "/"。
   * ブラウザで `<base>` を置く SPA と同じ条件をサーバー内に再現する
   * （深い URL での basename 誤認を防ぐ）。サブパス配備では明示する。
   */
  baseHref?: string;
}

async function loadDefaultBootstraps(): Promise<BootstrapFunction[]> {
  const { bootstrapState } = await import('@wcstack/state');
  return [bootstrapState];
}


/**
 * HTML 文字列を SSR レンダリングして返す。
 *
 * ## 入力 HTML のルール
 * - `<body>` の中身だけを渡す（`<html>`, `<head>`, `<body>` タグは含めない）
 * - `<script>` / `<link>` による外部リソース読み込みは実行されない
 *   → 必要なパッケージは `options.bootstraps` で明示的に渡す
 *
 * ## SSR でできること
 *
 * ### 状態の初期化とデータ取得
 * - `<wcs-state>` の状態ロード（json 属性, src 属性, inline `<script type="module">`）
 * - `$connectedCallback` でのサーバーサイド fetch（API 呼び出し、DB 問い合わせ等）
 *
 * ```html
 * <!-- JSON 直接指定 -->
 * <wcs-state enable-ssr json='{"title":"Hello"}'></wcs-state>
 *
 * <!-- $connectedCallback で API からデータ取得 -->
 * <!-- $connectedCallback は状態オブジェクトのメソッドとして定義し、this が state proxy -->
 * <wcs-state enable-ssr>
 *   <script type="module">
 *     export default {
 *       async $connectedCallback() {
 *         const res = await fetch('/api/users');
 *         this.users = await res.json();
 *       }
 *     };
 *   </script>
 * </wcs-state>
 * ```
 *
 * ### wcs-fetch を使ったサーバー通信
 * - `<wcs-fetch>` の auto-fetch（`manual` なし）はサーバーでも実行される
 * - `manual` + `$connectedCallback` で明示的に制御する場合:
 *
 * ```html
 * <wcs-fetch id="api" url="/api/users" manual></wcs-fetch>
 * <wcs-state enable-ssr>
 *   <script type="module">
 *     export default {
 *       async $connectedCallback() {
 *         const el = document.getElementById('api');
 *         this.users = await el.fetch();
 *       }
 *     };
 *   </script>
 * </wcs-state>
 * ```
 * ※ `bootstraps` に `bootstrapFetch` を含める必要あり
 *
 * ### バインディングと構造レンダリング
 * - `data-wcs` バインディングの適用（text, attribute, class, style, property）
 * - `<template data-wcs="for:">` / `if:` / `elseif:` / `else:` の構造レンダリング
 *
 * ```html
 * <ul>
 *   <template data-wcs="for: users">
 *     <li data-wcs="textContent: .name"></li>
 *   </template>
 * </ul>
 * <template data-wcs="if: isAdmin">
 *   <div class="admin-panel">...</div>
 * </template>
 * ```
 *
 * ### ハイドレーション
 * - `enable-ssr` 付き `<wcs-state>` の `<wcs-ssr>` メタデータ自動生成
 * - クライアント側でのハイドレーション（再レンダリングなしでバインディング復元）
 * - `enable-ssr` を外した `<wcs-state>` はクライアントのみで動作（部分 CSR）
 *
 * ### カスタム要素の待機
 * - `static hasConnectedCallbackPromise = true` プロトコル準拠の全カスタム要素を自動待機
 * - `$connectedCallback` 中に動的追加されたカスタム要素も安定化ループで検出・待機（最大 10 回）
 *
 * ## SSR でできないこと
 * - `<wcs-router>` SSR の完全保証（サーバー描画 + クライアント採用は動作するが、
 *   スナップショット順序レース等の残フェーズ完了まで実験的。
 *   docs/ssr-router-design.md 参照）
 * - `<head>` 内の `<script src="...">` や `<link>` の自動実行
 * - ブラウザ固有 API（localStorage, sessionStorage, navigator 等）
 * - Shadow DOM のレンダリング（Declarative Shadow DOM 非対応）
 * - イベントハンドラの登録（クライアント側のハイドレーションで復元）
 * - `<wcs-autoloader>` による動的コンポーネント読み込み
 *
 * ## HTML の分割パターン
 * ```
 * // server.js
 * const ssrBody = await renderToString(template, { ... });
 * const page = `<!DOCTYPE html>
 * <html lang="ja">
 * <head>
 *   <script type="module" src="/packages/state/dist/auto.min.js"></script>
 * </head>
 * <body>${ssrBody}</body>
 * </html>`;
 * ```
 * `renderToString` には `<body>` の中身だけを渡し、
 * `<head>` や `<script>` タグは外側のテンプレートで囲む。
 */
export async function renderToString(html: string, options?: RenderOptions): Promise<string> {
  // globalThis を差し替えるため、同時に1つしか実行できない
  const releaseMutex = await renderMutex.acquire();

  const window = options?.url ? new Window({ url: options.url }) : new Window();
  const restoreGlobals = installGlobals(window);
  const document = window.document;

  let restoreBaseUrl: (() => void) | null = null;

  try {
    // url 指定時は <base href> を注入する（既定 "/"）。ブラウザで <base> を置く
    // SPA と同じ条件を再現し、深い URL での basename 誤認を防ぐ
    // （docs/ssr-router-design.md §3.1）。
    if (options?.url !== undefined || options?.baseHref !== undefined) {
      const base = document.createElement('base');
      base.setAttribute('href', options.baseHref ?? '/');
      document.head.appendChild(base);
    }

    // 相対 URL を baseUrl で解決する URL コンストラクタパッチをインストール。
    // baseUrl 省略時は url の origin を既定にする。
    const effectiveBaseUrl =
      options?.baseUrl ?? (options?.url ? new URL(options.url).origin : undefined);
    restoreBaseUrl = effectiveBaseUrl
      ? installBaseUrl(effectiveBaseUrl)
      : null;

    // bootstrap の解決。非同期ローダー（BootstrapFunction 参照）を許容するため
    // await する。try 内で行うのは、throw 時にもグローバル復元を保証するため。
    const bootstraps = options?.bootstraps ?? await loadDefaultBootstraps();

    for (const bootstrap of bootstraps) {
      await bootstrap();
    }

    // SSR モードを html 要素に設定
    document.documentElement.setAttribute('data-wcs-server', '');

    // HTML をパース
    // connectedCallback が自動発火 → state ロード → $connectedCallback 実行
    document.body.innerHTML = html;

    // connectedCallbackPromise / getBindingsReady プロトコルを自動検出
    // $connectedCallback が動的にカスタム要素を追加する場合があるため、
    // 新しい要素が見つからなくなるまで走査を繰り返す（安定化ループ）
    const MAX_ITERATIONS = 10;
    const awaitedElements = new WeakSet();
    const readyCtors = new Set<any>();
    const readyPromises: Promise<void>[] = [];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const connectedPromises: Promise<void>[] = [];

      for (const el of document.querySelectorAll('*-*')) {
        if (awaitedElements.has(el)) continue;
        const ctor = el.constructor as any;
        if (ctor.hasConnectedCallbackPromise) {
          awaitedElements.add(el);
          connectedPromises.push((el as any).connectedCallbackPromise);
        }
        if (!readyCtors.has(ctor) && typeof ctor.getBindingsReady === 'function') {
          readyCtors.add(ctor);
          readyPromises.push(ctor.getBindingsReady(document));
        }
      }

      if (connectedPromises.length === 0) break;
      await Promise.all(connectedPromises);
    }

    // 非同期初期化の完了を待機
    await Promise.all(readyPromises);

    return document.body.innerHTML;
  } finally {
    // binder プロトコルの保留キュー（Symbol.for なので installGlobals の restore
    // 対象外＝プロセス寿命）を空にする。state を読み込まないページで挿入側
    // （router 等）が差し出したノードは引き取り手が現れないまま蓄積するため、
    // レンダリングごとに後始末する（docs/ssr-router-design.md §3.1）。
    // これはプロトコルの公開シンボル面であり、パッケージ内部への依存ではない。
    const pendingBinds = (globalThis as Record<symbol, unknown>)[
      Symbol.for('wcstack.binder.pending')
    ];
    if (Array.isArray(pendingBinds)) {
      pendingBinds.length = 0;
    }
    restoreBaseUrl?.();
    restoreGlobals();
    await window.close();
    releaseMutex();
  }
}
