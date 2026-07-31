# framework アプリへの wcstack 要素の組み込み手順

- **作成日**: 2026-08-01
- **状態**: 利用手順（normative ではない。規範は各 SPEC と
  [非同期 I/O ノード作成ガイドライン](./async-io-node-guidelines.md)）
- **対象読者**: React / Vue / Svelte / Solid / Angular / Qwik などのアプリから `<wcs-*>` を使う人
- **位置づけ**: [framework adapter のバインド成立制約](./architecture-hardening/13-framework-adapter-binding-constraints.md)
  の Phase A2 / A4 の成果物。設計判断の記録は doc 13、値の意味分類は
  [observable 棚卸し](./architecture-hardening/12-wc-bindable-observable-inventory.md) を参照。

## 0. 3つの規則

1. **要素の定義が render より後になる構成では、bind の前に定義を待つ。** 待たないと adapter は
   沈黙したまま何も配送しない（§1）。
2. **object を渡す input は「プロパティとして渡す」構文を明示する。** 既定のままだと framework に
   よっては属性へ文字列化される（§2）。
3. **reactive store の値は raw にしてから渡す。** Proxy のままだと structured clone 境界で失敗する（§3）。

静的 import（`import "@wcstack/websocket/auto"`）でバンドルする通常構成なら、規則 1 は自動的に満たされる。
規則 2 と 3 は構成によらず必要になる。

## 1. 定義タイミング

### 1.1 何が起きるか

`@wc-bindable` の adapter は、いずれも mount 時に一度だけ `isWcBindable(el)` を判定し、偽なら
**再試行せずに諦める**。要素参照は upgrade 後も同一なので、React の依存配列も Qwik の `track()` も
再発火しない。結果としてエラーもログも出ないまま、その要素からは初期値も後続イベントも永久に届かない。

```ts
// 全 adapter に共通する形
if (!isWcBindable(el)) return;   // ← まだ upgrade していないだけでも、ここで終わる
unbind = bind(el, onUpdate);
```

`@wc-bindable/core` の `bind()` 自体も、宣言が読めないときは no-op を返して静かに終わる。
`syncOn: "connect"` は**接続**の遅延を扱うオプションであって、**定義**の遅延には効かない。

### 1.2 起きる構成・起きない構成

| 構成 | 定義のタイミング | 影響 |
| --- | --- | --- |
| バンドラで `@wcstack/<pkg>/auto` を静的 import | render より前 | 影響なし（推奨） |
| `@wcstack/autoloader` による動的 import | DOM 走査後 | **影響あり** |
| CDN の `<script type="module">` | ネットワーク次第 | **影響あり** |
| 動的 import / code-split で遅延ロード | ロード完了時 | **影響あり** |

### 1.3 ゲートの書き方

最も確実なのは静的 import である。

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

### 1.4 代用にならないもの

- **`connectedCallbackPromise` / `hasConnectedCallbackPromise`** — 接続後に初期スナップショットを
  取るためのもので、定義前の待機には使えない。未定義の要素にはその getter 自体が存在しない。
- **`<wcs-defined>`** — 「指定タグが定義済みか」を観測するゲートで、複数タグの readiness を
  宣言的に扱うときは有用だが、`<wcs-defined>` 自身の定義が先に必要である。
- **`setTimeout` での遅延** — 定義完了と無関係なので、速いネットワークでたまたま通るだけになる。

### 1.5 入力側は救済される（次回リリース以降）

upgrade 前に `el.url = "..."` のようにプロパティ代入していた場合、その値は
`connectedCallback` で取り込み直されるので失われない（`wcBindable.inputs` に宣言された入力のみ）。
これは**入力**の話であり、§1.1 の**観測**の欠落は救済しない。bind のゲートは依然として必要である。

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

## 3. reactive store の値は raw で渡す

Vue の `reactive`、Svelte 5 の `$state`、Solid の store、Alpine、MobX、Qwik の `useStore` は
値を Proxy で包む。包まれるのは plain object / array / Map / Set で、`MediaStream` / `Error` /
`Blob` / `ArrayBuffer` などの platform object は対象外である。

Proxy は structured clone できないため、そのまま渡すと `<wcs-worker>` の `post` や
`<wcs-broadcast>` の送信で **`DataCloneError`** になる。wcstack は never-throw なので例外は飛ばず、
`error` / `errorInfo` に落ちるだけで原因が見えにくい。

| framework | raw 化 |
| --- | --- |
| Vue | `toRaw(state.payload)` |
| Svelte 5 | `$state.snapshot(payload)` |
| Solid（store） | `unwrap(payload)` |
| MobX | `toJS(payload)` |
| Qwik | `JSON.parse(JSON.stringify(payload))` など明示的な複製 |

wcstack 側は framework 固有の unwrap を実装しない（依存を持ち込めず、どの framework の Proxy かを
判定する一般的手段も無い）。規範は
[ガイドライン §3.3.2](./async-io-node-guidelines.md) を参照。

## 4. コロンを含むイベント名を直接聴く

wcstack のイベント名は `wcs-camera:stream-ready` のようにコロンを含む。

**adapter 経由なら意識しなくてよい。** `bind()` が `addEventListener` を使うため、イベント名の
表記法は関係しない。問題になるのは、adapter を使わずテンプレートで直接聴きたい場合である。

| framework | テンプレートでの直接束縛 |
| --- | --- |
| Angular | **できない**。`(wcs-camera:stream-ready)` は `target:event` と解釈され `Unsupported event target` になる（[angular/angular#28491](https://github.com/angular/angular/issues/28491)・未解決） |
| React | **できない**。`on<name>` はダッシュを含む名前を扱えるが、コロンは JSX の名前空間名として解釈される |
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
adapter の values ではなく直接受け取るのが正しい（[棚卸し §5.6](./architecture-hardening/12-wc-bindable-observable-inventory.md)）。

## 5. 値の意味を adapter に伝える

`wcBindable.properties[].semantics` が `state` / `event` / `handle` を宣言する。adapter が
これを解釈すれば、occurrence の取りこぼし（同値 dedupe）や live handle の誤った snapshot 化を
避けられる。現時点でこの宣言を解釈するのは `@wcstack/state` だけで、`@wc-bindable` の
各 adapter は未対応である。したがって現状は次を前提にすること。

- 同じ payload が連続する `event`（`message` / `fired` / `clicked` など）は、値ベースの store に
  そのまま入れると落ちうる。イベントとして受けるか、連番などで区別する。
- `handle`（`streamReady`）は values に入れず、§4 の経路で受ける。

## 参照

- [framework adapter のバインド成立制約](./architecture-hardening/13-framework-adapter-binding-constraints.md)
- [wc-bindable observable 棚卸し](./architecture-hardening/12-wc-bindable-observable-inventory.md)
- [非同期 I/O ノード作成ガイドライン](./async-io-node-guidelines.md)
- [`bind()` の定義待ち提案](./spec-proposal-bind-definition-timing.md)
- [websocket-chat の React / Vue 実装](../examples/websocket-chat/README.md)
