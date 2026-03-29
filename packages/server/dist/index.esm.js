import { Window } from 'happy-dom';

const GLOBALS_KEYS = [
    'document', 'customElements', 'HTMLElement',
    'DocumentFragment', 'Node', 'NodeFilter', 'Comment', 'Text',
    'MutationObserver', 'ShadowRoot', 'Element', 'HTMLTemplateElement',
];
function installGlobals(window) {
    const saved = {};
    for (const key of GLOBALS_KEYS) {
        saved[key] = globalThis[key];
        globalThis[key] = window[key];
    }
    // URL.createObjectURL を無効化して、
    // loadFromInnerScript が base64 data: URL フォールバックを使うようにする
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = undefined;
    return () => {
        URL.createObjectURL = origCreateObjectURL;
        for (const key of GLOBALS_KEYS) {
            globalThis[key] = saved[key];
        }
    };
}
function installBaseUrl(baseUrl) {
    const OrigURL = globalThis.URL;
    const base = baseUrl;
    globalThis.URL = class extends OrigURL {
        constructor(input, inputBase) {
            if (typeof input === 'string' && input.startsWith('/') && inputBase === undefined) {
                super(input, base);
            }
            else {
                super(input, inputBase);
            }
        }
    };
    // 静的メソッドを引き継ぐ
    globalThis.URL.createObjectURL = OrigURL.createObjectURL;
    globalThis.URL.revokeObjectURL = OrigURL.revokeObjectURL;
    return () => { globalThis.URL = OrigURL; };
}
/** @deprecated Use Ssr.extractStateData() from @wcstack/state instead */
function extractStateData(stateEl) {
    const raw = stateEl.__state;
    if (!raw || typeof raw !== 'object')
        return {};
    const data = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!key.startsWith('$') && typeof value !== 'function') {
            data[key] = value;
        }
    }
    return data;
}
async function loadDefaultBootstraps() {
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
 *
 * ## SSR でできないこと
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
 *   <script type="module" src="/packages/state/dist/auto.js"></script>
 * </head>
 * <body>${ssrBody}</body>
 * </html>`;
 * ```
 * `renderToString` には `<body>` の中身だけを渡し、
 * `<head>` や `<script>` タグは外側のテンプレートで囲む。
 */
async function renderToString(html, options) {
    const window = new Window();
    const restoreGlobals = installGlobals(window);
    const document = window.document;
    // 相対 URL を baseUrl で解決する URL コンストラクタパッチをインストール
    const restoreBaseUrl = options?.baseUrl
        ? installBaseUrl(options.baseUrl)
        : null;
    // bootstrap の解決
    const bootstraps = options?.bootstraps ?? await loadDefaultBootstraps();
    for (const bootstrap of bootstraps) {
        bootstrap();
    }
    try {
        // SSR モードを html 要素に設定
        document.documentElement.setAttribute('data-wcs-server', '');
        // HTML をパース
        // connectedCallback が自動発火 → state ロード → $connectedCallback 実行
        document.body.innerHTML = html;
        // connectedCallbackPromise / getBindingsReady プロトコルを自動検出
        const connectedPromises = [];
        const readyPromises = [];
        const readyCtors = new Set();
        for (const el of document.querySelectorAll('*-*')) {
            const ctor = el.constructor;
            if (ctor.hasConnectedCallbackPromise) {
                connectedPromises.push(el.connectedCallbackPromise);
            }
            if (!readyCtors.has(ctor) && typeof ctor.getBindingsReady === 'function') {
                readyCtors.add(ctor);
                readyPromises.push(ctor.getBindingsReady(document));
            }
        }
        await Promise.all(connectedPromises);
        // 非同期初期化の完了を待機
        await Promise.all(readyPromises);
        return document.body.innerHTML;
    }
    finally {
        restoreBaseUrl?.();
        restoreGlobals();
        await window.close();
    }
}

var version = "0.2.4";
var pkg = {
	version: version};

const VERSION = pkg.version;

class RenderCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "html", event: "wcs-render:html-changed" },
            { name: "loading", event: "wcs-render:loading-changed" },
            { name: "error", event: "wcs-render:error" },
        ],
    };
    _html = null;
    _loading = false;
    _error = null;
    get html() {
        return this._html;
    }
    get loading() {
        return this._loading;
    }
    get error() {
        return this._error;
    }
    _setLoading(loading) {
        this._loading = loading;
        this.dispatchEvent(new CustomEvent("wcs-render:loading-changed", {
            detail: loading,
        }));
    }
    _setHtml(html) {
        this._html = html;
        this.dispatchEvent(new CustomEvent("wcs-render:html-changed", {
            detail: html,
        }));
    }
    _setError(error) {
        this._error = error;
        this.dispatchEvent(new CustomEvent("wcs-render:error", {
            detail: error,
        }));
    }
    async render(html) {
        this._setLoading(true);
        this._error = null;
        try {
            const result = await renderToString(html);
            this._setHtml(result);
            this._setLoading(false);
            return this._html;
        }
        catch (e) {
            this._setError(e instanceof Error ? e : new Error(String(e)));
            this._setLoading(false);
            return null;
        }
    }
}

export { GLOBALS_KEYS, RenderCore, VERSION, extractStateData, installBaseUrl, installGlobals, renderToString };
//# sourceMappingURL=index.esm.js.map
