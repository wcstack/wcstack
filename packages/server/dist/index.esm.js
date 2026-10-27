import { pathToFileURL } from 'node:url';
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
 * Global key the renderer installs a module resolver under, for the length of one render:
 * `(url: string) => string | null`, the specifier to import instead of `url` for a
 * `<wcs-state src>` module (Node's loader reads `file:` and `data:` URLs, not the `http:` URL a
 * page names), or null to import `url` as it is. It may throw to say why the URL cannot be
 * rendered. The renderer maps the URL to a local file and makes each render's module its own, so
 * a state object is not shared between requests. A provider reads it where it imports a `src`
 * module; with no resolver installed (the browser), it imports `url`.
 */
const SSR_MODULE_RESOLVER_KEY = Symbol.for("wcstack.ssr.resolveModule");
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
/** 既定のレンダリング上限（ms）。`RenderOptions.timeoutMs` で変えられる。 */
const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
/**
 * `setTimeout` が受け付ける最大 delay（2^31−1）。これを超える値は Node が 1 ms に丸めるので、
 * 「上限を上げたつもりが即時タイムアウト」になる前に無制限へ倒す。
 */
const MAX_RENDER_TIMEOUT_MS = 2_147_483_647;
/** `finally` の後始末に必ず与える最低の上限（ms）。予算を使い切っていても mutex は解放する。 */
const CLEANUP_MIN_TIMEOUT_MS = 1_000;
/**
 * `RenderOptions.timeoutMs` を内部表現（`0` = 無制限、それ以外は有効な delay）へ畳む。
 * 無効値（`NaN` / 負 / 2^31−1 超 / `Infinity`）はすべて無制限に倒す。
 */
function normalizeRenderTimeout(value) {
    const ms = value ?? DEFAULT_RENDER_TIMEOUT_MS;
    return Number.isFinite(ms) && ms > 0 && ms <= MAX_RENDER_TIMEOUT_MS ? ms : 0;
}
/**
 * `promise` を上限つきで待つ。時間切れは `onTimeout()` の値で決着させる
 * （`reject` を渡せば reject、`resolve` を渡せば「諦めて先へ進む」）。
 * 勝敗にかかわらずタイマーは必ず解除する（サーバープロセスを生かし続けない）。
 * `ms` は `normalizeRenderTimeout` を通した値（`0` = 無制限）であること。
 */
function withDeadline(promise, ms, onTimeout) {
    if (!(ms > 0)) {
        return promise;
    }
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            try {
                resolve(onTimeout());
            }
            catch (error) {
                reject(error);
            }
        }, ms);
        // Node のイベントループをこのタイマーだけで生かし続けない
        timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer !== undefined)
            clearTimeout(timer);
    });
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
 * 要素が接続の後に始めた仕事を待つ（readiness プロトコルの任意の段）。`static hasPendingPromise = true`
 * を持つ要素の `pendingPromise`（実行中の仕事。無ければ null）— state が束縛で `url` を書いた
 * `<wcs-fetch>` の要求など。その結果は状態へ届き、それが描いたもの（行と、その中の要素）も続けて待つ
 * （waitForReady をもう一度）。以前は待たず、ページは値の無いまま（「Loading…」で）直列化された
 * （docs/seam-apps.md、ssr-news。著者の決定は docs/v4-direction-2026-10.md §5.1）。仕事の失敗は待ち終わりと
 * して扱う（要素が自分の error に出す）。
 */
async function settlePendingWork(root, maxIterations = 10) {
    for (let i = 0; i < maxIterations; i++) {
        const pending = [];
        for (const el of root.querySelectorAll('*-*')) {
            if (!el.constructor.hasPendingPromise)
                continue;
            const p = el.pendingPromise;
            if (p)
                pending.push(Promise.resolve(p).catch(() => undefined));
        }
        if (pending.length === 0)
            return;
        await Promise.all(pending);
        await waitForReady(root, { maxIterations });
    }
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
 * - `<wcs-state>` の状態ロード（json 属性, src 属性 — `resolveModule` でローカルのファイルへ写す —, inline `<script type="module">`）
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
    const timeoutMs = normalizeRenderTimeout(options?.timeoutMs);
    // globalThis を差し替えるため、同時に1つしか実行できない
    const releaseMutex = await renderMutex.acquire();
    // **acquire() と releaseMutex() の間に、try の外で throw しうる文を 1 つも置かないこと。**
    // ここは 2 文（呼び出しと try）だけで、レンダリングの本体も後始末も内側に閉じている。
    // 以前は `new Window({ url })` と `installGlobals()` が try の前にあり、不正な `url`
    // （オリジンを付け忘れた `"/products/1"`）の `TypeError: Invalid URL` が mutex を握ったまま
    // 抜けて、**以後そのプロセスの全レンダリングが永久 pending** になっていた（実測・サイクル 5 指摘 2）。
    // 番人は __tests__/render.test.ts の「mutex を try の外で漏らさない」。
    try {
        return await renderInWindow(html, options, timeoutMs);
    }
    finally {
        releaseMutex();
    }
}
/**
 * 1 回分のレンダリング（window の生成・globals の差し替え・後始末）。mutex の外側から
 * 呼ばれ、**この関数から抜けた時点でグローバルは必ず元に戻っている**。
 */
async function renderInWindow(html, options, timeoutMs) {
    // ready 待ちと後始末は同じ予算を共有する（JSDoc 参照）。起点は window を作る前に取る
    const startedAt = Date.now();
    let window = null;
    let restoreGlobals = null;
    let restoreBaseUrl = null;
    let restoreResolver = null;
    let documentOrNull = null;
    try {
        window = options?.url ? new Window({ url: options.url }) : new Window();
        restoreGlobals = installGlobals(window);
        restoreResolver = installModuleResolver(options?.resolveModule);
        const document = window.document;
        documentOrNull = document;
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
        await withDeadline(waitForReady(document), timeoutMs, () => {
            throw new Error(`[@wcstack/server] renderToString timed out after ${timeoutMs} ms waiting for the page to become ready. ` +
                `A custom element's connectedCallbackPromise or getBindingsReady never settled. ` +
                `Raise or disable the limit with the "timeoutMs" option.`);
        });
        // 接続の後に要素が始めた仕事（束縛が url を書いた <wcs-fetch> の要求）も、残りの時間の範囲で待つ。
        // 使い切ったら、それ抜きで描く（初期化と違って、ページはそれが無くても成り立つ）— 黙らずに言う
        await withDeadline(settlePendingWork(document).then(() => true), 
        // （0 は無制限なので、使い切った予算は 0 ではなく 1 ms）
        timeoutMs <= 0 ? 0 : Math.max(1, timeoutMs - (Date.now() - startedAt)), () => {
            console.warn(`[@wcstack/server] [wcs/ssr-pending-timeout] A request an element started during the render (a <wcs-fetch> whose url a binding set) ` +
                `did not finish within ${timeoutMs} ms: the page is rendered without its result, which loads on the client. ` +
                `Raise or disable the limit with the "timeoutMs" option.`);
            return false;
        });
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
            for (const el of documentOrNull?.querySelectorAll('*-*') ?? []) {
                const ctor = el.constructor;
                if (typeof ctor.getBindingsReady === 'function') {
                    readyPending.push(ctor.getBindingsReady(documentOrNull));
                }
            }
            // **必ず上限を付ける**。裸で待つと、ready 待ちが時間切れで抜けてきた経路がそのまま
            // 後始末で止まり、下の restore と（呼び出し元の）mutex 解放に到達しない — 防波堤が
            // 素通しになる。予算は ready 待ちと共有（残り時間）だが、使い切っていても
            // CLEANUP_MIN_TIMEOUT_MS は与える（0 は「上限なし」と同義になってしまう）
            await withDeadline(Promise.allSettled(readyPending), cleanupTimeout(timeoutMs, startedAt), () => []);
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
        // 後始末の各段は**それぞれ独立に**守る。1 本が投げても残りを飛ばさない
        // （飛ばすとグローバルが差し替わったまま残り、次のレンダリングが別 realm の
        // document を掴む）。呼び出し元の releaseMutex はこの finally の外なので、
        // ここから投げても mutex は必ず解放される
        for (const step of [
            // 描画の中で始まった非同期の仕事を、グローバルを戻す**前に**止める。要素が呼ぶ fetch とタイマーは
            // Node のもの（happy-dom のものに差し替えていない）なので、描画の後も生き続け、その続きが Node の
            // グローバルの CustomEvent を happy-dom の要素に dispatch して投げた — state から url を束ねた
            // <wcs-fetch> の要求が描画の後に失敗したとき、描画の中で始まった <wcs-timer> の刻みごとに、捕まらない
            // 例外でプロセスを落とした（seam app ssr-news）。グローバルを差し替えて追跡するのではなく（描画の間も
            // 同じプロセスのほかの処理が走る）、文書の中身を外して各要素に自分の後始末（disconnectedCallback:
            // 要求の中断・タイマーの停止）をさせ、その続きが happy-dom のグローバルのまま走り終えるよう、Node の
            // マクロタスクを 1 つ譲ってから戻す。happy-dom 自身の非同期の仕事は abort() で止める
            () => {
                emptyOut(documentOrNull?.body);
                emptyOut(documentOrNull?.head);
            },
            () => new Promise((resolve) => setImmediate(resolve)),
            () => window?.happyDOM.abort(),
            () => restoreBaseUrl?.(),
            () => restoreResolver?.(),
            () => restoreGlobals?.(),
            () => window?.close(),
            // スナップショット提供側（state）がこのレンダリングのために貯めたモジュール大域を
            // 捨てさせる（ssr-snapshot プロトコルの任意メンバ）。構造テンプレートの台帳は
            // モジュール寿命で削除の口が無く、放っておくと 1 プロセスで描くたびに積み上がる。
            // **ここが最後**なのは、直前の ready 待ちで進行中のバインディング構築がまだその
            // 台帳を読むから — 途中で消すと描画中の for が自分のテンプレートを見失う。
            // 出力の正しさは提供側が文書ごとにスナップショットを閉じることで担保されており、
            // これは純粋にメモリの口。古い提供側には reset が無いので `?.` で素通しする
            () => getSsrSnapshotBuilder()?.reset?.(),
        ]) {
            try {
                await step();
            }
            catch (error) {
                console.error('[@wcstack/server] renderToString cleanup step failed.', error);
            }
        }
    }
}
/** 描画の番号（`resolveModule` のモジュールを描画ごとに分ける） */
let renders = 0;
/**
 * `<wcs-state src>` のモジュールの読み先（ssr-snapshot プロトコルの SSR_MODULE_RESOLVER_KEY）を、この描画の
 * 間だけ置く。`file:` / `data:` はそのまま読ませる。ほかの URL は `resolve` が返すファイルへ — Node は
 * モジュールを URL ごとに持ち続けるので、描画の番号を問い合わせに付けて、その描画だけのモジュールにする
 * （付けないと、状態のオブジェクトがリクエストの間で共有される）。`resolve` が無いか何も返さなければ、
 * 何をすればよいかを言って投げる（以前は Node の ERR_UNSUPPORTED_ESM_URL_SCHEME だけだった）。
 */
function installModuleResolver(resolve) {
    const g = globalThis;
    const had = Object.prototype.hasOwnProperty.call(g, SSR_MODULE_RESOLVER_KEY);
    const previous = g[SSR_MODULE_RESOLVER_KEY];
    const render = ++renders;
    g[SSR_MODULE_RESOLVER_KEY] = (url) => {
        const u = new URL(url);
        if (u.protocol === 'file:' || u.protocol === 'data:')
            return null;
        const local = resolve?.(u);
        if (local === null || local === undefined) {
            throw new Error(`[@wcstack/server] <wcs-state src> names ${url}, which Node cannot import (its loader reads file: and data: URLs). ` +
                (resolve === undefined
                    ? 'Pass renderToString({ resolveModule }) to map it to a local file, or write the state inline.'
                    : 'resolveModule returned no file for it.'));
        }
        const file = local instanceof URL ? new URL(local.href) : /^file:/i.test(local) ? new URL(local) : pathToFileURL(local);
        file.searchParams.set('wcs-render', String(render));
        return file.href;
    };
    return () => {
        if (had)
            g[SSR_MODULE_RESOLVER_KEY] = previous;
        else
            delete g[SSR_MODULE_RESOLVER_KEY];
    };
}
/**
 * 要素を文書順の後ろから 1 つずつ外す（子は親より先、後の兄弟は前の兄弟より先）。各要素の
 * disconnectedCallback が走る。replaceChildren() でまとめて外さないのは、happy-dom が外した部分木を
 * 子の写しで辿る途中で callback を呼ぶため: 切断で兄弟を外す要素（`<wcs-link>` は自分の `<a>` を外す）が
 * あると、外された兄弟を辿って TypeError で止まり、その先の要素は切断されず後始末もされなかった
 * （段落の中のリンク — ナビゲーションの典型の形）。1 つずつなら、外す要素の下には子が無い。
 */
function emptyOut(parent) {
    if (!parent) {
        return;
    }
    for (const el of Array.from(parent.querySelectorAll('*')).reverse()) {
        el.remove();
    }
    parent.replaceChildren();
}
/**
 * `finally` の後始末に与える上限。ready 待ちと予算を共有し（残り時間）、
 * 使い切っていても {@link CLEANUP_MIN_TIMEOUT_MS} は確保する。無制限（`0`）は無制限のまま。
 */
function cleanupTimeout(timeoutMs, startedAt) {
    if (timeoutMs <= 0) {
        return 0;
    }
    return Math.max(CLEANUP_MIN_TIMEOUT_MS, timeoutMs - (Date.now() - startedAt));
}

var version = "4.9.0";
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

export { GLOBALS_KEYS, RenderCore, VERSION, installBaseUrl, installGlobals, renderToString, waitForReady };
//# sourceMappingURL=index.esm.js.map
