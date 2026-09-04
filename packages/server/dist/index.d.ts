import { Window } from 'happy-dom';

declare const GLOBALS_KEYS: string[];
declare function installGlobals(window: Window): () => void;
declare function installBaseUrl(baseUrl: string): () => void;
/** @deprecated Use Ssr.extractStateData() from @wcstack/state instead */
declare function extractStateData(stateEl: any): Record<string, any>;
/**
 * 同期の bootstrap 関数、または非同期ローダー。
 * `HTMLElement` を継承するクラスはモジュール評価時にグローバルの `HTMLElement` を
 * 参照するため、純 Node 環境ではトップレベル import できないパッケージがある。
 * その場合は `async () => (await import('@wcstack/router')).bootstrapRouter()` の
 * ように非同期ローダーを渡す — 呼び出しは installGlobals の後なので、モジュール
 * 評価時にはグローバルが揃っている（docs/ssr-router-design.md §3.1）。
 */
type BootstrapFunction = () => void | Promise<void>;
interface RenderOptions {
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
interface WaitForReadyOptions {
    /**
     * 安定化ループの上限。`$connectedCallback` が動的に追加した要素を拾うため、
     * 新しい要素が見つからなくなるまで走査を繰り返す（既定 10）。
     */
    maxIterations?: number;
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
declare function waitForReady(root: ParentNode & Node, options?: WaitForReadyOptions): Promise<void>;
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
declare function renderToString(html: string, options?: RenderOptions): Promise<string>;

declare const VERSION: string;

/**
 * Observation semantics of a `properties` entry.
 *
 *   "state"  — current value. A snapshot may cache it, and equality-based dedupe is safe.
 *   "event"  — occurrence. Repeated identical payloads are distinct occurrences; never dedupe.
 *   "handle" — live / opaque resource with its own lifecycle (e.g. MediaStream). Not
 *              snapshot-safe and not necessarily serializable; consumers need an explicit
 *              ref / callback surface rather than a value slot.
 */
type WcBindableSemantics = "state" | "event" | "handle";
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
    /**
     * Optional, additive, forward-compatible. An absent value means **unspecified**, NOT
     * "state": a reader that finds no `semantics` MUST keep the behavior it had before this
     * field existed (deliver the update as-is; do not start deduping, caching or serializing
     * on assumption). Only an explicit value licenses a reader to change its handling.
     */
    readonly semantics?: WcBindableSemantics;
}
interface IWcBindableInput {
    readonly name: string;
    readonly attribute?: string;
}
interface IWcBindableCommand {
    readonly name: string;
    readonly async?: boolean;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    /** Integer protocol version. All versions >= 1 are core-compatible. */
    readonly version: number;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

/**
 * Value types for RenderCore (headless) — the 3 async state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new RenderCore();
 * bind(core, (name: keyof WcsRenderValues, value) => { ... });
 * ```
 */
interface WcsRenderValues {
    html: string | null;
    loading: boolean;
    error: Error | null;
}

declare class RenderCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _html;
    private _loading;
    private _error;
    get html(): string | null;
    get loading(): boolean;
    get error(): Error | null;
    private _setLoading;
    private _setHtml;
    private _setError;
    render(html: string): Promise<string | null>;
}

export { GLOBALS_KEYS, RenderCore, VERSION, extractStateData, installBaseUrl, installGlobals, renderToString, waitForReady };
export type { BootstrapFunction, IWcBindable, IWcBindableProperty, RenderOptions, WaitForReadyOptions, WcsRenderValues };
