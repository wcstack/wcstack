# @wcstack/testing

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**もし、ページのテストが import 1 つで済んだら？**

`<wcs-state>` のページは素の DOM なので、happy-dom で既にヘッドレスにテストできます — レシピは [state README](../state/README.ja.md#ページをテストする) にあり、テスト専用 API は要りません。`@wcstack/testing` はそのレシピをパッケージにしたもの: HTML をマウントし、全要素と全バインドを待ち、state を読み書きし、settle して assert する。便利であって必須ではなく、素のレシピはこのパッケージ無しでも動き続けます。

対象は `<wcs-state>` のページです。`@wcstack/signals` で作ったページには `state()` が返す状態の木がありません: その signal・コンポーネント・`bindNode` の配線を、vitest + happy-dom で直接テストします。

```ts
import { mount, settle, fire } from "@wcstack/testing";

const app = await mount(`
  <wcs-state json='{"count": 1}'></wcs-state>
  <p data-wcs="textContent: count"></p>
  <button data-wcs="onclick: up">+1</button>
`);
expect(app.root.querySelector("p")!.textContent).toBe("1");

await app.state().write((s) => { s.count = 42; });   // ハンドラがやっていること
await settle();
expect(app.root.querySelector("p")!.textContent).toBe("42");

fire(app.root.querySelector("button")!, "click");       // ユーザーがやること
await settle();
app.unmount();
```

```bash
npm install -D @wcstack/testing @wcstack/state @wcstack/server vitest happy-dom
```

`@wcstack/state` と `@wcstack/server` は peer です: `mount()` は state で要素を登録し、server の `waitForReady` で待ちます — `renderToString` がシリアライズ前に使う安定化ループそのものなので、`<wcs-router>` の初回ルート、要素を追加する `$connectedCallback`、`<wcs-state>` のバインディング構築が 1 呼び出しで揃います。vitest なら `environment: 'happy-dom'` を設定するだけ。素の Node では `installDom()` を使います。

## API

### `mount(html, options?) → Promise<MountedApp>`

要素を登録し、`html` を挿入し、root 配下の全てが ready になったら resolve します。

| オプション | 説明 |
|---|---|
| `root` | `"document"`（既定）— HTML は `document.body` の中身になる。`"shadow"` — `document.body` に追加した host の open ShadowRoot に入り、バインドはその root に閉じる |
| `bootstrap` | 先に走らせる登録関数。既定 `[bootstrapState]`（`@wcstack/state` から遅延 import）。並べると既定を置き換える: ページが使うものを全部 — `bootstrapRouter`・`bootstrapFetch` … に加えて `bootstrapState` も — 関数か非同期ローダー `async () => (await import("@wcstack/router")).bootstrapRouter()` で並べる。4.31（未リリース）から、`<wcs-state>` のあるページで、並べた登録がそのタグを定義しなければ、そう言って reject する（以前は何も束ねずに resolve した）。wcstack の bootstrap は全て冪等 |
| `stateTagName` | `bootstrapState({ tagNames })` で state タグを改名したときの名前（既定 `wcs-state`） |
| `maxIterations` | 待機中に挿入された要素を拾う安定化ループの回数（既定 10） |
| `resolveModule` | 4.9 から。`(url: URL) => string \| URL \| null` — `<wcs-state src>` のモジュールを読むローカルのファイル。`@wcstack/server` の `renderToString` と同じオプションで、ページが名指す URL（`document.baseURI` で解決したもの — happy-dom の下では `http:` の URL）を受け取り、パスか `file:` URL を返す。Node のモジュールローダは `file:` と `data:` の URL しか読まない。mount の間だけ置かれ、モジュールは mount ごとに読み直すので、テストの間で状態のオブジェクトは共有されない。これが無いか何も返さないと、状態の初期化はそう言って失敗する — ルートの `<wcs-state>` なら `mount()` がそれで reject する。`.json` の `src` は従来どおり fetch で読む。[自分のファイルにある状態](#自分のファイルにある状態) を参照 |

4.11 から、`mount()` が持たないオプションや、オプションの型と違う値は、文書に触れる前にその場で reject します — どのパッケージの `bootstrapXxx()` とも同じく、オプションの名前を言い、オプションの一覧を添えます。綴り違いの `resolveModul` は無視され、テストは後で Node の `ERR_UNSUPPORTED_ESM_URL_SCHEME` で落ちていました。値が `undefined` のオプションは飛ばします。`fire()` の `init` と `installDom()` のオプションも同じに検査します。

**ページの中の宣言的カスタムコンポーネント。** 4.28 から、マウントする HTML の `<template shadowrootmode>` は、ブラウザのパーサがするとおり、親の shadow root になります — happy-dom は子のまま残します。だから、HTML に書いた（または部品のファイルから読んでページのマークアップの前に置いた）DCC の定義がタグを定義し、`mount()` は定義とそのインスタンスを待ちます: 最初の検証の前に `settle()` は要りません。4.27 までは、定義は shadow root を持たず、タグは定義されず、`mount()` は何も言わずに解決していました。失敗する定義の報告は `@wcstack/state` がします（happy-dom の下では `console.error`）。`mount()` は解決します。

```ts
const pager = readFileSync("parts/midori-pager.html", "utf8");
const app = await mount(`${pager}
  <wcs-state json='{"total": 120, "page": 2}'></wcs-state>
  <midori-pager id="pager" data-wcs="total: total; page: page"></midori-pager>`);
expect(app.root.querySelector("#pager")!.shadowRoot!.querySelector(".info")!.textContent).toBe("2 / 6");
```

返る `MountedApp`:

| メンバー | 説明 |
|---|---|
| `root` | `document` か ShadowRoot — ここに query する |
| `container` | `document.body` か shadow host |
| `state()` | ルートの `<wcs-state>` のアクセサ — v2 は 1 root 1 ツリーで名前は無い。ボリューム（`mount=`）はそのツリーの一部（パス接頭辞で読む）。（`mount()` は DOM のマウント・`mount=` は state のマウント）。無ければ throw。`state<typeof appState>()` で `read` / `write` が渡す状態に型が付く — [状態の型](#状態の型) を参照 |
| `state().read(fn)` | readonly プロキシに対して `fn` を走らせ結果を返す |
| `state().write(fn)` | writable プロキシに対して `fn`（同期 / 非同期）を走らせる — ハンドラと同じ。後に `await settle()` |
| `state().element` | 要素そのもの |
| `unmount()` | マウントした HTML を取り除く |

`mount()` は happy-dom の 4 つの角も均して、ページがブラウザと同じに振る舞うようにします:

- ブラウザ風の `URL.createObjectURL` があればプロセスにつき 1 回それを無効化する — Node は `blob:` URL を import できず、これが無いとインライン `<script type="module">` の state が永久に読み込み中になる（ローダーは SSR と同じく `data:` URL 経路に倒れる）。
- happy-dom の `textContent` / `innerText` setter を DOM 仕様どおりに文字列化するよう包む — happy-dom は数値 `0` を空文字にし（`innerText` は数値で throw する）、`textContent: count` のバインドが 0 で消えるのは happy-dom 下だけになるため。
- 4.26 から、HTML を `@wcstack/server` の `setInnerHTML` で挿入する。表の中に書いた `<template>` を、ブラウザと同じ所に置く。happy-dom のパーサは `<table>`・`<thead>`・`<tbody>`・`<tfoot>`・`<tr>`・`<colgroup>` の中の `<template>` を表の外へ追い出し、その行やセルを表の中に残すので、`<tbody><template data-wcs="for: rows"><tr>…` のページ（`<tr>` のセルの `for:` も）は `[wcs/wildcard-rank] ".name" is relative: it needs an enclosing "for" template` で mount できなかった — 4.25 までは、そうしたページをヘッドレスでテストできなかった。
- 4.31（未リリース）から、ページを文書の外で組み立ててから入れる。要素は子のそろった木として接続する — ブラウザのパーサが、モジュールのスクリプトが upgrade する前に残すページと同じ。happy-dom は開始タグの時点で要素を接続し、子はまだ無い: `<wcs-link>` は `<a>` へ移す文字を持たず、ルーターが basename を読む前に `href` を作っていた（`/app/next` が `/next`）。

#### 状態の型

4.26 から、`state<S>()` はページの状態の定義の型を受け取ります。すると `read` と `write` は、コールバックに `defineState()` の定義の中の `this` と同じ型の状態 — キー・getter・メソッド・ドットパス（`"items.*.price"`）・`$` の API — を渡すので、綴りを誤ったキーや違う型の引数は型の誤りになり、メソッドはキャスト無しで呼べます。`read` の状態は、そのプロキシと同じく readonly です。型引数が無ければ、これまでどおり `any` です。

```ts
import { mount, settle } from "@wcstack/testing";
import type appState from "../public/state"; // export default defineState({ cartCount: 0, add(name: string) { … }, … })

const app = await mount(html, { resolveModule });
const state = app.state<typeof appState>();
await state.write((s) => s.add("apple"));      // 型が付く: s.add(1) は誤り
await settle();
expect(state.read((s) => s.cartCount)).toBe(1);   // number。s.cartCont は誤り
```

読み込むものの無い `<wcs-state>` — `state` / `src` / `json` 属性もインライン `<script type="module">` も無いもの — は `setInitialState()` を待ちますが、テストは `mount()` が返る前にそれを呼べません。4.9 から、`mount()` は待たずに reject し、代わりに何を書けばよいか（`json=`、インラインスクリプト、または `src` と `resolveModule`）を言います。以前は resolve せず、テストは何も言わずにタイムアウトしました。ボリューム（`mount=`）も調べます。`bind-component` の要素と `<template>` の中の要素は調べません。

#### 自分のファイルにある状態

4.9 から、状態をファイルに置くページ — `<wcs-state src="./state.js">`、厳しい CSP の下で文書が勧める形 — は `resolveModule` で mount します。ページが名指す URL をそのファイルへ写します:

```ts
import { mount } from "@wcstack/testing";

// public/index.html に <wcs-state src="./state.js"> があり、このテストは tests/ にある
const resolveModule = (url: URL) => new URL("../public" + url.pathname, import.meta.url);

const app = await mount(`
  <wcs-state src="./state.js"></wcs-state>
  <p data-wcs="textContent: total"></p>
`, { resolveModule });
```

`(url) => join(publicDir, url.pathname)` でも構いません。URL は上のように連結で書いてください: Vite（したがって vitest）は文字列リテラルやテンプレートリテラルで書いた `new URL("…", import.meta.url)` を、そのファイルではない資産の URL に書き換えます。状態は自分の補助モジュール（`./lib.js`）を `import` してよく、それはファイルの隣で解決されます。インライン `<script type="module">` の状態は、Node の下では相対モジュールを `import` できません: `data:` URL から評価されるので、`./lib.js` を解決する基底がありません（そのときのエラーは CSP の文書を指しますが、テストには当てはまりません）。そうした状態は自分のファイルに置き、`resolveModule` を使ってください。

### `settle() → Promise<void>`

マイクロタスク 2 段とマクロタスク 1 段 — 書き込みが DOM に届くのに十分な待ち。`write()`・`fire()`・任意の DOM イベントの後に使います。

### `fire(target, type, init?) → boolean`

`Event`（`init.detail` があれば `CustomEvent`）を既定で bubbling させて dispatch します。ハンドラが `preventDefault()` を呼ぶと `false`。4.11 から、`init` の `bubbles`・`cancelable`・`composed`・`detail` 以外のキーは throw します: イベントに届いていませんでした — `{ key: "Enter" }` は `KeyboardEvent` を作らない。別のイベントクラスは `target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))` と自分で送ってください。

### `installDom(options?) → Promise<() => Promise<void>>`

DOM 環境の無いランナー向け: happy-dom の `Window`（`options.url`・既定 `http://localhost/`）を作るか `options.window` を受け取り、server の `installGlobals` でグローバルを差し替えます。返る関数がグローバルを戻して window を close します。`@wcstack/state`（他の wcstack パッケージも）はこれを呼んだ**後に** import してください — 要素クラスはモジュール評価時に基底クラスを決めます。`happy-dom` は optional peer で、ここでだけ必要です。

```js
import { installDom, mount, settle } from "@wcstack/testing";

const restore = await installDom();
try {
  const app = await mount(html);          // @wcstack/state は DOM ができた後に遅延 import される
  // ...
} finally {
  await restore();
}
```

4.28 から、返る関数は window を閉じてからグローバルを戻します: 閉じるとページの要素が取り外され、その後片付けはまだ `document` を読みます。4.27 までは、`<wcs-state>` を 1 つでもマウントしていると `Cannot read properties of undefined (reading 'documentElement')` を投げていました — そして素の Node では、4.12 から `mount()` そのものが `addEventListener is not defined` で reject していました。

## 死角

happy-dom が再現できない 2 点。実ブラウザの e2e（Playwright）を 1 本残してください:

- `customElements.define` は既存ノードを**差し替えて**アップグレードするので、「遅れて define された同一ノードに値が届く」はヘッドレスでは検証できない。そうしてアップグレードされた、`id` のある要素 — 宣言的カスタムコンポーネントのインスタンスはいつもそう — は、ページから外れた後も happy-dom の id の索引に残る: `document.getElementById("pager")` は外した要素を返し、同じファイルの後の `mount()` でもそうなる（happy-dom 21）。マウントしたルートから読む: `app.root.querySelector("#pager")`。
- イベントのタイミングが実ブラウザと違う。

表の中の `<template>` は 4.26 から扱えます: `mount()` がブラウザと同じ所に置きます（上記）。テストが自分で `innerHTML` で挿入する HTML は対象外です — `@wcstack/server` の `setInnerHTML(element, html)` で挿入してください。

## 実例

[`examples/state-testing-todo/`](../../examples/state-testing-todo/) — todo ページと、それを `mount` / `fire` / `settle` で動かす vitest スイート。

## License

MIT
