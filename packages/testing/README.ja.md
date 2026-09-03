# @wcstack/testing

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**もし、ページのテストが import 1 つで済んだら？**

`<wcs-state>` のページは素の DOM なので、happy-dom で既にヘッドレスにテストできます — レシピは [state README](../state/README.ja.md#ページをテストする) にあり、テスト専用 API は要りません。`@wcstack/testing` はそのレシピをパッケージにしたもの: HTML をマウントし、全要素と全バインドを待ち、state を読み書きし、settle して assert する。便利であって必須ではなく、素のレシピはこのパッケージ無しでも動き続けます。

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
| `bootstrap` | 先に走らせる登録関数。既定 `[bootstrapState]`（`@wcstack/state` から遅延 import）。ページが使うもの — `bootstrapRouter`・`bootstrapFetch` … — を関数か非同期ローダー `async () => (await import("@wcstack/router")).bootstrapRouter()` で足す。wcstack の bootstrap は全て冪等 |
| `stateTagName` | `bootstrapState({ tagNames })` で state タグを改名したときの名前（既定 `wcs-state`） |
| `maxIterations` | 待機中に挿入された要素を拾う安定化ループの回数（既定 10） |

返る `MountedApp`:

| メンバー | 説明 |
|---|---|
| `root` | `document` か ShadowRoot — ここに query する |
| `container` | `document.body` か shadow host |
| `state()` | ルートの `<wcs-state>` のアクセサ — v2 は 1 root 1 ツリーで名前は無い。ボリューム（`mount=`）はそのツリーの一部（パス接頭辞で読む）。（`mount()` は DOM のマウント・`mount=` は state のマウント）。無ければ throw |
| `state().read(fn)` | readonly プロキシに対して `fn` を走らせ結果を返す |
| `state().write(fn)` | writable プロキシに対して `fn`（同期 / 非同期）を走らせる — ハンドラと同じ。後に `await settle()` |
| `state().element` | 要素そのもの |
| `unmount()` | マウントした HTML を取り除く |

`mount()` は happy-dom の 2 つの角も均して、ページがブラウザと同じに振る舞うようにします:

- ブラウザ風の `URL.createObjectURL` があればプロセスにつき 1 回それを無効化する — Node は `blob:` URL を import できず、これが無いとインライン `<script type="module">` の state が永久に読み込み中になる（ローダーは SSR と同じく `data:` URL 経路に倒れる）。
- happy-dom の `textContent` / `innerText` setter を DOM 仕様どおりに文字列化するよう包む — happy-dom は数値 `0` を空文字にし（`innerText` は数値で throw する）、`textContent: count` のバインドが 0 で消えるのは happy-dom 下だけになるため。

### `settle() → Promise<void>`

マイクロタスク 2 段とマクロタスク 1 段 — 書き込みが DOM に届くのに十分な待ち。`write()`・`fire()`・任意の DOM イベントの後に使います。

### `fire(target, type, init?) → boolean`

`Event`（`init.detail` があれば `CustomEvent`）を既定で bubbling させて dispatch します。ハンドラが `preventDefault()` を呼ぶと `false`。

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

## 死角

happy-dom が再現できない 2 点。実ブラウザの e2e（Playwright）を 1 本残してください:

- `customElements.define` は既存ノードを**差し替えて**アップグレードするので、「遅れて define された同一ノードに値が届く」はヘッドレスでは検証できない。
- イベントのタイミングが実ブラウザと違う。

## 実例

[`examples/state-testing-todo/`](../../examples/state-testing-todo/) — todo ページと、それを `mount` / `fire` / `settle` で動かす vitest スイート。

## License

MIT
