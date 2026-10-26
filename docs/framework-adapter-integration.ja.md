# framework アプリへの wcstack 要素の組み込み手順

- **作成日**: 2026-08-01
- **更新**: 2026-10-20 — §2・§3・§4・§5 と §6〜§10 を継ぎ目アプリ fw-inventory（React 19 と Vue 3 から
  I/O ノードを使う、[seam-apps.md](./seam-apps.md)）から
- **状態**: 利用手順（normative ではない。規範は各 SPEC と
  [非同期 I/O ノード作成ガイドライン](./async-io-node-guidelines.ja.md)）
- **対象読者**: React / Vue / Svelte / Solid / Angular / Qwik などのアプリから `<wcs-*>` を使う人
- **位置づけ**: [framework adapter のバインド成立制約](./architecture-hardening/13-framework-adapter-binding-constraints.ja.md)
  の Phase A2 / A4 の成果物。設計判断の記録は doc 13、値の意味分類は
  [observable 棚卸し](./architecture-hardening/12-wc-bindable-observable-inventory.ja.md) を参照。
- **English**: [framework-adapter-integration.md](./framework-adapter-integration.md)

## 0. 3つの規則

1. **`@wc-bindable` 0.9 以降を使うか、bind の前に定義を待つ。** 0.9 からは adapter が遅れた定義を
   自分で待つ。それより古い adapter は、render より後に定義された要素について沈黙したまま何も
   配送しない（§1）。
2. **object を渡す input は「プロパティとして渡す」構文を明示する。** 既定のままだと framework に
   よっては属性へ文字列化される（§2）。
3. **reactive store の値は深い素の写しにして渡す。** Proxy のままだと structured clone 境界で失敗し、
   Vue の `toRaw()` は 1 段しか剥がさない（§3）。

静的 import（`import "@wcstack/websocket/auto"`）でバンドルする通常構成なら、adapter の版によらず
規則 1 は自動的に満たされる。規則 2 と 3 は構成によらず必要になる。

§5〜§10 は、framework が `@wcstack/state` と違うふるまいをする所を扱う: イベントである出力、`trigger`
でなく命令、props の順、framework が取る名前、Vite の開発サーバー、lint。

## 1. 定義タイミング

### 1.1 何が起きるか

**`@wc-bindable` 0.9 以降**（[wc-bindable-protocol#22](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/22)）:
どの adapter も既定で `bind()` に `syncOn: "define"` を渡す（命令的な binder の `vanjs` / `mobx` /
`rxjs` / `signals` は `["define", "connect"]`）。宣言がまだ読めず、タグ名に `-` を含むとき、`bind()` は
`customElements.whenDefined(tagName)` を待ち、要素を upgrade し、宣言をもう一度読んでからバインドする。
render より後に定義された要素も、定義が届いた時点でバインドされるので、この節の手当ては要らない。
自分で `syncOn` を渡すと既定は置き換わるので、`"define"` を残すこと。`@wc-bindable/core` の `bind()` を
直接呼ぶときの既定は今も `"call"` なので、`syncOn: "define"` を自分で渡す。

**0.8 以前**: adapter は、いずれも mount 時に一度だけ `isWcBindable(el)` を判定し、偽なら
**再試行せずに諦める**。要素参照は upgrade 後も同一なので、React の依存配列も Qwik の `track()` も
再発火しない。結果としてエラーもログも出ないまま、その要素からは初期値も後続イベントも永久に届かない。

```ts
// 0.8 までの全 adapter に共通する形
if (!isWcBindable(el)) return;   // ← まだ upgrade していないだけでも、ここで終わる
unbind = bind(el, onUpdate);
```

`@wc-bindable/core` の `bind()` 自体も、宣言が読めず `"define"` も指定されていないときは no-op を返して
静かに終わる。`syncOn: "connect"` は**接続**の遅延を扱うオプションであって、**定義**の遅延には効かない。

### 1.2 起きる構成・起きない構成（0.8 以前）

| 構成 | 定義のタイミング | 影響 |
| --- | --- | --- |
| バンドラで `@wcstack/<pkg>/auto` を静的 import | render より前 | 影響なし（推奨） |
| `@wcstack/autoloader` による動的 import | DOM 走査後 | **影響あり** |
| CDN の `<script type="module">` | ネットワーク次第 | **影響あり** |
| 動的 import / code-split で遅延ロード | ロード完了時 | **影響あり** |

0.9 以降では、どの構成も影響を受けない。

wcstack のタグそのものを autoloader で読み込むには、パッケージごとに、その `/auto` を読み込む包みを作る
（[autoloader の README](../packages/autoloader/README.ja.md#wcstack-自身のタグを読み込む)）。クラスを 1 つだけ
出し直す包みでは `<wcs-fetch-header>` / `<wcs-fetch-body>` が定義されず、要求はそのヘッダーや本文なしで出る。

### 1.3 ゲートの書き方（0.8 以前）

最も確実なのは静的 import で、どの版でもいちばん簡単である。

```ts
// main.tsx / main.js — アプリのエントリで一度だけ
import "@wcstack/websocket/auto";
```

遅延ロードが避けられない場合は、`customElements.whenDefined()` で待ってから mount する。

```tsx
// React
function ChatGate() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    customElements.whenDefined("wcs-ws").then(() => setReady(true));
  }, []);
  return ready ? <Chat /> : null;   // Chat の中で useWcBindable を呼ぶ
}
```

```vue
<!-- Vue -->
<script setup>
const ready = ref(false);
onMounted(() => customElements.whenDefined("wcs-ws").then(() => (ready.value = true)));
</script>
<template>
  <Chat v-if="ready" />
</template>
```

Svelte / Solid / Qwik / Angular も同じ形になる。**`whenDefined` を待つのは、adapter を呼ぶ
コンポーネントがマウントされる前**でなければ意味がない。同じコンポーネント内で待っても、
adapter は既に諦めた後である。

動的な `import("@wcstack/sse/auto")` は 4.6 から型検査を通る。各パッケージが `/auto` の入口の
`dist/auto.d.ts` を出すようになった。4.5 以前では TypeScript が `TS7016` を出すので、
`declare module "@wcstack/*/auto";` を一度宣言する。

### 1.4 代用にならないもの

- **`connectedCallbackPromise` / `hasConnectedCallbackPromise`** — 接続後に初期スナップショットを
  取るためのもので、定義前の待機には使えない。未定義の要素にはその getter 自体が存在しない。
- **`<wcs-defined>`** — 「指定タグが定義済みか」を観測するゲートで、複数タグの readiness を
  宣言的に扱うときは有用だが、`<wcs-defined>` 自身の定義が先に必要である。
- **`setTimeout` での遅延** — 定義完了と無関係なので、速いネットワークでたまたま通るだけになる。

### 1.5 入力側は救済される

upgrade 前に `el.url = "..."` のようにプロパティ代入していた場合、その値は
`connectedCallback` で取り込み直されるので失われない（`wcBindable.inputs` に宣言された入力のみ。
wc-bindable 0.10 の producer ガイダンス P4）。これは**入力**の話であり、§1.1 の**観測**の欠落は
救済しないので、0.8 の adapter では bind のゲートが依然として必要である。

## 2. object を渡す input

DOM 属性は文字列しか持てないため、object / array を渡す input は DOM プロパティとして渡す必要がある。
ところが React 19 / Vue / Svelte / Preact は「その名前のプロパティが要素に存在するか」を見て
プロパティか属性かを決めるため、**要素が未 upgrade だと属性側にフォールバックし、`[object Object]` に
文字列化される**。

wcstack の scalar 入力（`url` / `type` / `manual` など）は属性バックの accessor なので、
フォールバックしても意味は保たれる。壊れるのは object を取る入力（`post` / `options` / `files` など）だけである。

| framework | プロパティとして渡す書き方 |
| --- | --- |
| Vue | `:post.prop="payload"` または `.post="payload"` |
| React 19 | `ref` 経由で `el.post = payload`（JSX の値は property 判定に依存する） |
| Angular | `[post]="payload"`（Angular の property binding は常にプロパティ代入） |
| Lit | `.post=${payload}` |
| Solid | `prop:post={payload}` |
| Svelte | `bind:this` で取得して代入 |

確実なのは、どの framework でも **ref で要素を掴んでプロパティに代入する**ことである。
4.6 から、接続したときに自分の属性にオブジェクトが書かれているのを見つけた要素
（`files="[object File]"`・`body="[object Object]"`）は、1 回警告する: `[wcs/input-as-attribute]`。

**オブジェクトはその場で変えず、新しいものを代入する。** framework は値が変わったときに入力を書き、
その場で変えたオブジェクトは同じ値である。`files={files}` で渡した配列への `files.push(file)` や、
`:body.prop` で束ねたオブジェクトへの `payload.rows.push(row)` は何も書かず、要素には何も伝わらない。
自動送信の `<wcs-upload>` は代入で送り、`<wcs-fetch>` の `body` と `<wcs-upload>` の `files` は要求で
使い切られるので、次の要求はそれなしで出る。新しい配列やオブジェクトを代入する（`setFiles([...files, file])`）。

**adapter と並べて要素を持つ（React）。** `useWcBindable` の ref はコールバックなので、それも呼ぶ自分の ref で
要素を持つ — 命令を呼ぶ、オブジェクトの入力を代入する、イベントを聴く（§5）ために:

```tsx
const [bindRef, values] = useWcBindable<WcsSse, WcsSseValues<Stock>>();
const el = useRef<WcsSse | null>(null);
const ref = useCallback((node: WcsSse | null) => { el.current = node; bindRef(node); }, [bindRef]);
// <wcs-sse ref={ref} url="/api/stock/stream" /> の後で el.current?.close()
```

**Vue では、テンプレート ref を静的に名前で書く。** `const { ref: stock, values } = useWcBindable()` と
`<wcs-sse ref="stock">` なら束縛され、`stock.value` が要素になる。`:ref="ref"` の束縛 — `@wc-bindable/vue` の
README が示す形 — は、`<script setup>` では ref が剥がされて `null` を渡す: アダプターは束縛せず、`values` は
何も言わずに空のまま。

**TypeScript と JSX。** パッケージはタグの JSX 宣言を出していないので、使うタグを宣言する。React 19 では:

```ts
// wcs-jsx.d.ts
import "react";
type Base = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "wcs-sse": Base & { url?: string | null; events?: string; manual?: boolean };
      "wcs-storage": Base & { "storage-key"?: string; type?: "local" | "session"; manual?: boolean };
    }
  }
}
```

[`examples/websocket-chat/react/src/wcs-ws.d.ts`](../examples/websocket-chat/react/src/wcs-ws.d.ts) が
`<wcs-ws>` を同じように宣言している。

## 3. reactive store の値は raw で渡す

Vue の `reactive`、Svelte 5 の `$state`、Solid の store、Alpine、MobX、Qwik の `useStore` は
値を Proxy で包む。包まれるのは plain object / array / Map / Set で、`MediaStream` / `Error` /
`Blob` / `ArrayBuffer` などの platform object は対象外である。

Proxy は structured clone できないため、そのまま渡すと `<wcs-worker>` の `post` や
`<wcs-broadcast>` の送信で **`DataCloneError`** になる。wcstack は never-throw なので例外は飛ばず、
`error` / `errorInfo` に落ちる。4.6 からは、要素が 1 回警告もする: `[wcs/post-uncloneable]`。

渡すのは**深い**素の写しである。Vue の `toRaw()` は 1 段しか剥がさない。リアクティブな一覧の行もプロキシで、
`filter` やスプレッドで作り直した一覧（`picked.value.filter(…)`・`[...picked.value, item]`）の行もそうなので、
`toRaw(list)` でもまだ失敗する。

| framework | raw 化 |
| --- | --- |
| Vue | `JSON.parse(JSON.stringify(state.payload))`、または段ごとの `toRaw()`（`toRaw(state.payload)` だけでは足りない） |
| Svelte 5 | `$state.snapshot(payload)` |
| Solid（store） | `unwrap(payload)` |
| MobX | `toJS(payload)` |
| Qwik | `JSON.parse(JSON.stringify(payload))` など明示的な複製 |

wcstack 側は framework 固有の unwrap を実装しない（依存を持ち込めず、どの framework の Proxy かを
判定する一般的手段も無い）。規範は
[ガイドライン §3.3.2](./async-io-node-guidelines.ja.md) を参照。

## 4. コロンを含むイベント名を直接聴く

wcstack のイベント名は `wcs-camera:stream-ready` のようにコロンを含む。

**adapter 経由なら意識しなくてよい。** `bind()` が `addEventListener` を使うため、イベント名の
表記法は関係しない。問題になるのは、adapter を使わずテンプレートで直接聴きたい場合である。

| framework | テンプレートでの直接束縛 |
| --- | --- |
| Angular | **できない**。`(wcs-camera:stream-ready)` は `target:event` と解釈され `Unsupported event target` になる（[angular/angular#28491](https://github.com/angular/angular/issues/28491)・未解決） |
| React | **JSX の変換しだいで、その先は大文字小文字しだい**。コロンがあると属性は JSX の名前空間名になる: Babel は既定で拒み、Vite 8 の変換は通す。React 19 は `on` の後に書かれたとおりの名前のイベントを聴く: `onwcs-fetch:response` は動くが、`onWcs-fetch:response` はコンパイルが通って一度も発火しない（`Wcs-fetch:response` は発火しない）。警告も無い |
| Vue / Svelte / Solid | 書ける場合があるが、コロンを含む名前の扱いは framework とバージョンに依存する |

**どの framework でも確実なのは、要素参照を取って `addEventListener` する経路**である。

```ts
// Angular
constructor(private el: ElementRef, private renderer: Renderer2) {}
ngAfterViewInit() {
  this.renderer.listen(this.cameraEl.nativeElement, "wcs-camera:stream-ready", (e: CustomEvent) => {
    this.video.nativeElement.srcObject = e.detail;   // live MediaStream
  });
}
```

```tsx
// React
const cameraRef = useRef<HTMLElement>(null);
useEffect(() => {
  const el = cameraRef.current;
  if (!el) return;
  const onReady = (e: Event) => { videoRef.current!.srcObject = (e as CustomEvent).detail; };
  el.addEventListener("wcs-camera:stream-ready", onReady);
  return () => el.removeEventListener("wcs-camera:stream-ready", onReady);
}, []);
```

この経路が必要になる代表例は `handle` に分類された observable である。`<wcs-camera>` の
`streamReady` は live な `MediaStream` で、snapshot state に入れてはならない値なので、
adapter の values ではなく直接受け取るのが正しい（[棚卸し §5.6](./architecture-hardening/12-wc-bindable-observable-inventory.ja.md)）。

## 5. 値の意味を adapter に伝える

`wcBindable.properties[].semantics` が `state` / `event` / `handle` を宣言する。adapter が
これを解釈すれば、occurrence の取りこぼし（同値 dedupe）や live handle の誤った snapshot 化を
避けられる。現時点でこの宣言を解釈するのは `@wcstack/state` だけで、`@wc-bindable` の
各 adapter は未対応である。したがって現状は次を前提にすること。

- **`event` の出力を adapter の values で読まない。** `<wcs-sse>` / `<wcs-ws>` / `<wcs-broadcast>` /
  `<wcs-worker>` の `message` は出来事であって状態ではない。adapter はイベントごとに呼び返すが、値を
  framework の状態に持ち、framework は続けて来た更新を 1 回の描画にまとめ（React は続くタスクの更新を
  まとめる）、前と等しい値を捨てる（React の `useState`、Vue のリアクティビティ）。1 つのかたまりで届いた
  5 件の SSE メッセージのうち、`values.message` の `useEffect` が見たのは 1 件で、等しい 2 回の ping は 1 回と
  数えられた。イベントは要素で聴き、adapter は `state` の出力（`connected`・`loading`・`error`）に使う:

  ```tsx
  useEffect(() => {
    const node = el.current;   // §2 のように持った要素
    if (!node) return;
    const onMessage = (e: Event) => apply((e as CustomEvent).detail);
    node.addEventListener("wcs-sse:message", onMessage);
    return () => node.removeEventListener("wcs-sse:message", onMessage);
  }, []);
  ```

- `handle`（`streamReady`）は values に入れず、§4 の経路で受ける。

## 6. `trigger` でなく命令

`trigger`（`<wcs-fetch>`・`<wcs-upload>`・`<wcs-storage>` など）は `@wcstack/state` の書き方である。`true` を
書くと命令が走り、要素がそれを `false` に戻す。state は代入のたびに書くので、次の `true` でまた走る。
framework は変化しか書かない。`trigger={refresh}` でクリックごとに `setRefresh(true)` すると、最初の
クリックで命令が走って要素が `trigger` を戻すが、React はまだ `true` を持っている。2 回目のクリックは
何も書かず、何も送られず、何も言われない。framework からは、要素の命令を呼ぶ（§2）: `el.fetch()`・
`el.upload()`・`el.save()`。

## 7. props の順

framework は JSX 要素の props も Vue テンプレートの束縛も書いた順に当て、React 19 は要素を文書に入れる前に
それをする。ある入力が書かれたときに別の入力を読む要素では、1 つの `data-wcs` と同じく順が効く:
`trigger` より前に `url` を書く。4.6 から、`url` より先に `files` を渡された自動送信の
`<wcs-upload>` はそれを持っておき、url が来たときに送る。4.5 以前では `files={files} url=…` は何も送らず、
`[wcs/command-not-ready]` で警告していた。

## 8. framework が取る名前と、要素の寿命

React と Vue は `key`（と `ref`）を自分のものとして取り、要素に渡さない。JSX や Vue のテンプレートの
`<wcs-storage key="…">` には key が無く、何も読み込まず何も保存しない: `storage-key` を書く（4.6
から。key の無いままの最初の保存で、要素が `[wcs/command-not-ready]` で警告する）。4.5 以前では、ref を通して
`el.key` を代入する。

コンポーネントの `key` は、その寿命も決める。変わる `key` はコンポーネントを付け直し、その中の I/O ノードは
みな最初からやり直す: `<wcs-sse>` や `<wcs-ws>` はそのたびに新しい接続を開き、前の接続の `Last-Event-ID` を
持たないので、その間のイベントは失われる。I/O ノードは、`key` が変わるコンポーネントの外に置く。

prop を外すと `undefined` が書かれ（React 19）、マークアップに書かれた属性に戻る。接続は閉じない:
`<wcs-sse>` や `<wcs-ws>` を止めるには、その `close()` を呼ぶか、要素を外す。

## 9. Vite の開発サーバー

- 開発で最初に読み込んだとき、Vite は `@wcstack/*/auto` の import を見つけて最適化し直す: いくつかの
  `504 (Outdated Optimize Dep)` と再読み込みが 1 回起きる。避けるには、入口を `optimizeDeps.include` に並べる。
- Vite の proxy は、背後のサーバーが落ちてもブラウザへの応答を開いたままにするので、そこを通る
  `EventSource` は再接続しない: サーバーが再起動した後も `<wcs-sse>` は `connected` のまま何も受け取らない。
  proxy のエラーで応答を終わらせる:

  ```js
  // vite.config.js
  const endOnError = (proxy) => proxy.on("error", (_err, _req, res) => res.destroy());
  export default defineConfig({
    server: { proxy: { "/api": { target: "http://localhost:3000", configure: endOnError } } },
  });
  ```

## 10. lint

`wcs-validate` は HTML のページを読む: `data-wcs` の束縛、`<wcs-*>` のタグ、wcstack の script。framework の
アプリのページにはそのどれも無く、コンポーネント（`.jsx`・`.tsx`・`.vue`・`.svelte`）は読まないので、問題なしの
結果は framework のアプリを覆わない。4.6 から、CLI は件数の後にそれを言う: `not read:` が
コンポーネントを、`nothing to check:` が何も無いページを挙げる。

## 参照

- [framework adapter のバインド成立制約](./architecture-hardening/13-framework-adapter-binding-constraints.ja.md)
- [wc-bindable observable 棚卸し](./architecture-hardening/12-wc-bindable-observable-inventory.ja.md)
- [非同期 I/O ノード作成ガイドライン](./async-io-node-guidelines.ja.md)
- [`bind()` の定義待ち提案](./spec-proposal-bind-definition-timing.md)
- [websocket-chat の React / Vue 実装](../examples/websocket-chat/README.ja.md)
- [継ぎ目アプリ](./seam-apps.md) — §2〜§10 を見つけた fw-inventory
