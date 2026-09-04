import { Window } from 'happy-dom';

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/ssr-snapshot.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
// ssr-snapshot protocol — how the SSR renderer asks whoever owns reactive
// state to build hydration snapshots (<wcs-ssr>) as a final pass, after every
// DOM inserter (router route content, late custom elements) has settled.
//
// Without this, the snapshot is built inside <wcs-state>'s connectedCallback
// and races DOM inserted by other packages: whether a route's structural
// templates make it into the snapshot depends on document order and state's
// load mechanism (docs/ssr-router-design.md §5).
//
// The provider (@wcstack/state) installs itself on a well-known global symbol
// at bootstrap. The renderer (@wcstack/server) looks the builder up after
// running bootstraps: if present it announces orchestration by setting
// `data-wcs-server="orchestrated"` on the document element BEFORE parsing, and
// calls build() right before serialization. The provider keeps its inline
// per-element fallback whenever the attribute value is anything else, so:
//   - old renderer + new provider  -> inline build, yesterday's behavior
//   - new renderer + old provider  -> no builder found, attribute stays "",
//     the old provider builds inline as before
//   - new renderer + new provider  -> orchestrated: snapshots are built last
//     and therefore always see settled DOM
//
// The symbol (rather than a package import) also pins the builder to the state
// copy that actually runs on the page — its module-scoped fragment registries
// are the ones the snapshot must read.
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/ssr-snapshot.ts), then
// run `node scripts/sync-protocol-types.mjs` to regenerate the per-package
// copies (packages/<pkg>/src/protocol/ssrSnapshot.ts). Those copies are
// generated — do not edit them.
/**
 * Global key the snapshot builder installs itself under. `Symbol.for` so
 * independently loaded copies of this file (state's and server's) still agree.
 */
const SSR_SNAPSHOT_BUILDER_KEY = Symbol.for("wcstack.ssr.snapshotBuilder");
/**
 * `data-wcs-server` attribute value announcing that the renderer will call the
 * builder as a final pass. Providers must skip their inline per-element build
 * when they see this value, and keep it for any other value (including "").
 */
const SSR_ORCHESTRATED_VALUE = "orchestrated";
/**
 * The installed builder, or null when there is none or it speaks a shape this
 * reader does not.
 */
function getSsrSnapshotBuilder() {
    const candidate = globalThis[SSR_SNAPSHOT_BUILDER_KEY];
    if (candidate === undefined || candidate === null)
        return null;
    if (candidate.protocol !== "wcs-ssr-snapshot")
        return null;
    if (typeof candidate.version !== "number" || candidate.version < 1)
        return null;
    if (typeof candidate.build !== "function")
        return null;
    return candidate;
}

/**
 * globalThis を差し替える renderToString の並列実行を防止する Mutex。
 * 同一 Node プロセス内で複数リクエストが同時に renderToString を呼んでも
 * シリアライズされ、グローバル状態の衝突を防ぐ。
 */
class Mutex {
    _queue = [];
    _locked = false;
    async acquire() {
        if (this._locked) {
            await new Promise(resolve => this._queue.push(resolve));
        }
        this._locked = true;
        return () => {
            this._locked = false;
            this._queue.shift()?.();
        };
    }
}
const renderMutex = new Mutex();
const GLOBALS_KEYS = [
    'document', 'customElements', 'HTMLElement',
    'DocumentFragment', 'Node', 'NodeFilter', 'Comment', 'Text',
    'MutationObserver', 'ShadowRoot', 'Element', 'HTMLTemplateElement',
    // URL を持つコンポーネント（@wcstack/router 等）が window.location /
    // history を読めるようにする（docs/ssr-router-design.md §3.1）。
    'window', 'location', 'history',
    // コンポーネントが発火するイベントをレンダリングウィンドウの realm に揃える。
    // Node ネイティブの CustomEvent は happy-dom の EventTarget に拒否される
    // （"parameter 1 is not of type 'Event'"）。vitest の happy-dom 環境では
    // グローバルが happy-dom 側なので隠れ、素の Node サーバーでだけ顕在化する
    'Event', 'CustomEvent',
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
 * `root`（document / ShadowRoot）配下のカスタム要素が readiness プロトコルに従って
 * 初期化を終えるまで待つ。renderToString がシリアライズ前に行う待機と同じ手順で、
 * `@wcstack/testing` の `mount()` もこれを呼ぶ（docs/app-testing-and-typescript-impl-plan.md D11）。
 *
 * 1. `static hasConnectedCallbackPromise = true` を持つ全要素の `connectedCallbackPromise`
 *    を待つ。待っている間に追加された要素も拾う（安定化ループ）。
 *    `<wcs-router>` の初期ルート適用・`<wcs-state>` の状態ロードはここで完了する。
 * 2. `static getBindingsReady(root)` を持つクラス（`<wcs-state>`）の、この root に対する
 *    バインディング構築完了を待つ。Promise の取得はループの後 — 実体は各要素の
 *    connectedCallback 内・最初の await より後に登録されるため、先に掴むと「まだ
 *    登録前」の即時解決 Promise を取り逃す。
 *
 * バインディング初期化の失敗は reject として伝わる（state v1.26+）。
 */
async function waitForReady(root, options) {
    const maxIterations = options?.maxIterations ?? 10;
    const awaitedElements = new WeakSet();
    const readyCtors = new Set();
    for (let i = 0; i < maxIterations; i++) {
        const connectedPromises = [];
        for (const el of root.querySelectorAll('*-*')) {
            if (awaitedElements.has(el))
                continue;
            const ctor = el.constructor;
            if (ctor.hasConnectedCallbackPromise) {
                awaitedElements.add(el);
                connectedPromises.push(el.connectedCallbackPromise);
            }
            if (typeof ctor.getBindingsReady === 'function') {
                readyCtors.add(ctor);
            }
        }
        if (connectedPromises.length === 0)
            break;
        await Promise.all(connectedPromises);
    }
    await Promise.all(Array.from(readyCtors, (ctor) => ctor.getBindingsReady(root)));
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
 * ### router SSR
 * - `<wcs-router enable-ssr>` + `url` オプションで初期ルートをサーバー描画。
 *   クライアント側 router は描画済み DOM を採用（adopt）する。
 *   詳細は README「Router SSR」/ docs/ssr-router-design.md
 *
 * ## SSR でできないこと
 * - `<head>` 内の `<script src="...">` や `<link>` の自動実行
 * - ブラウザ固有 API（localStorage, sessionStorage, navigator 等）
 * - Shadow DOM のレンダリング（Declarative Shadow DOM 非対応）
 * - イベントハンドラの登録（クライアント側のハイドレーションで復元）
 * - `<wcs-autoloader>` による動的コンポーネント読み込み
 * - guard 付きルートのサーバー描画（設計上・クライアントで guard 実行）、
 *   `<wcs-layout>` ルートの採用（クライアント描画へフォールバック）、
 *   `<wcs-head>` のサーバー反映（body のみの出力に head は載らない）
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
async function renderToString(html, options) {
    // globalThis を差し替えるため、同時に1つしか実行できない
    const releaseMutex = await renderMutex.acquire();
    const window = options?.url ? new Window({ url: options.url }) : new Window();
    const restoreGlobals = installGlobals(window);
    const document = window.document;
    let restoreBaseUrl = null;
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
        const effectiveBaseUrl = options?.baseUrl ?? (options?.url ? new URL(options.url).origin : undefined);
        restoreBaseUrl = effectiveBaseUrl
            ? installBaseUrl(effectiveBaseUrl)
            : null;
        // bootstrap の解決。非同期ローダー（BootstrapFunction 参照）を許容するため
        // await する。try 内で行うのは、throw 時にもグローバル復元を保証するため。
        const bootstraps = options?.bootstraps ?? await loadDefaultBootstraps();
        for (const bootstrap of bootstraps) {
            await bootstrap();
        }
        // SSR モードを html 要素に設定。snapshot builder（bootstraps の実行が
        // 登録し得る — ssr-snapshot プロトコル）が居れば orchestrated を宣言し、
        // <wcs-ssr> 生成をサーバー主導の最終パスへ回す（docs/ssr-router-design.md §5）。
        // 値の宣言はパースより前 — 各要素は connectedCallback で値を読むため
        const snapshotBuilder = getSsrSnapshotBuilder();
        document.documentElement.setAttribute('data-wcs-server', snapshotBuilder !== null ? SSR_ORCHESTRATED_VALUE : '');
        // HTML をパース
        // connectedCallback が自動発火 → state ロード → $connectedCallback 実行
        document.body.innerHTML = html;
        // connectedCallbackPromise / getBindingsReady プロトコルを自動検出して待つ
        // （安定化ループ + バインディング構築。取り逃すと構築の続きがグローバル復元後に
        // 走り、document 消失でクラッシュする — 手順の詳細は waitForReady 参照）
        await waitForReady(document);
        // スナップショット最終パス（orchestrated）: 全要素の完了とバインディング構築の
        // 後に <wcs-ssr> を生成する。inline 生成（connectedCallback 内）が取り逃がす
        // 「後から挿入されたルート内容の構造テンプレート」も、この時点なら確定している
        snapshotBuilder?.build(document);
        return document.body.innerHTML;
    }
    finally {
        // エラー経路でも進行中のバインディング構築を待ってから globals を戻す。
        // 構築は要素の connectedCallback とは独立した microtask 連鎖で走るため、
        // 待たずに戻すと続きが document 消失で unhandled になりプロセスを落とす。
        // 後始末はベストエフォート（rejected も含めて待つだけ待つ）
        try {
            const readyPending = [];
            for (const el of document.querySelectorAll('*-*')) {
                const ctor = el.constructor;
                if (typeof ctor.getBindingsReady === 'function') {
                    readyPending.push(ctor.getBindingsReady(document));
                }
            }
            await Promise.allSettled(readyPending);
        }
        catch { /* best effort */ }
        // binder プロトコルの保留キュー（Symbol.for なので installGlobals の restore
        // 対象外＝プロセス寿命）を空にする。state を読み込まないページで挿入側
        // （router 等）が差し出したノードは引き取り手が現れないまま蓄積するため、
        // レンダリングごとに後始末する（docs/ssr-router-design.md §3.1）。
        // これはプロトコルの公開シンボル面であり、パッケージ内部への依存ではない。
        const pendingBinds = globalThis[Symbol.for('wcstack.binder.pending')];
        if (Array.isArray(pendingBinds)) {
            pendingBinds.length = 0;
        }
        restoreBaseUrl?.();
        restoreGlobals();
        await window.close();
        releaseMutex();
    }
}

var version = "1.33.0";
var pkg = {
	version: version};

const VERSION = pkg.version;

class RenderCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "html", event: "wcs-render:html-changed", semantics: "state" },
            { name: "loading", event: "wcs-render:loading-changed", semantics: "state" },
            { name: "error", event: "wcs-render:error", semantics: "state" },
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
        this._setError(null);
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

export { GLOBALS_KEYS, RenderCore, VERSION, extractStateData, installBaseUrl, installGlobals, renderToString, waitForReady };
//# sourceMappingURL=index.esm.js.map
