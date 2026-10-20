# @wc-bindable アダプター改善提案: 出来事を落とさない・要素を返す・README を直す

- **提案先**: wc-bindable-protocol リポジトリ（`packages/react`・`packages/vue` のアダプターと、その README）
- **提案元の文脈**: wcstack の継ぎ目アプリ fw-inventory。React 19.3 と Vue 3.5 のアプリから、@wcstack/* 4.5.0 の I/O ノードを `@wc-bindable/react` / `vue` 0.10.0 で使った（[seam-apps.md](./seam-apps.md)）
- **状態**: 上流に [wc-bindable-protocol#42](https://github.com/wc-bindable-protocol/wc-bindable-protocol/issues/42) として提案した（2026-10-21、英語）。wcstack 側でできること — 手引き・README・例の直し — は 4.6 に入れた（§6）
- **TL;DR**:
  1. `semantics: "event"` の出力（`message` など）は `values` に最後の値しか残らない。React は続けて来た更新を 1 回の描画にまとめ、等しい値では描画しない。Vue も等しい値では反応しない。core の `bind()` は出来事ごとに呼び返すのに、アダプターの先で出来事が落ちる。**出来事ごとに呼ばれるコールバック**を hook のオプションに足すことを提案する（追加的）
  2. React の hook は ref をコールバックで返し、要素を返さない。命令（`fetch()`）やオブジェクトの入力（`files`）のために、利用者は ref を合成するコールバックを毎回書いている。**要素を 3 つ目の戻り値として返す**ことを提案する（追加的）
  3. Vue の README の例 `<my-input :ref="ref" />` は、`<script setup>` では束縛しない。テンプレートが ref を剥がして `null` を渡すため。**`ref="名前"` の形に直す**
  4. npm の README が `../../SPEC.md` へ相対でリンクしていて、npm の上でもインストール先でも辿れない。**絶対 URL にする**
  5. README は出力だけを扱い、入力（プロパティへの代入）と命令（メソッドの呼び出し）に触れていない。**一節足す**

---

## 1. 出来事が `values` で落ちる

### 1.1 起きたこと

| 場面 | 書いたもの | 起きたこと |
|---|---|---|
| React: SSE が 1 つのかたまりで 5 件の `stock` を送る | `useEffect(() => apply(sse.message), [sse.message])` | 要素は `wcs-sse:message` を 5 回出した。effect は 1 回だけ走り、5 件のうち 4 件の在庫が古いまま。エラーも警告も無い |
| React: 同じ文字列 `"ping"` が 2 回届く（`<wcs-broadcast>`） | `useEffect(…, [bc.message])` で数える | 2 回届いて、effect は 1 回。`useState` は `Object.is` で等しい値では描画しない |
| Vue: worker が同じ文字列 `"pong"` を 2 回返す | `watch(() => worker.message, …)` | 2 回届いて、watch は 1 回 |
| React: wcstack の例 `examples/websocket-chat/react`（旧版） | `useEffect(…, [ws.message])` | 5 件のブロードキャストをまとめて送ると、記録に出たのは 2 件 |

切断の後に取り逃した分をまとめて送り直す SSE の再接続（`Last-Event-ID`）でも、同じことが起きる。

### 1.2 なぜ起きるか

SPEC の「Repeated Events」は「イベントのたびにコールバックが呼ばれる」と定めていて、core の `bind()` はそのとおり出来事ごとに `onUpdate` を呼ぶ。落ちるのはアダプターの先である。

```js
// @wc-bindable/react 0.10.0
const onUpdate = useCallback((name, value) => {
  setValues((prev) => ({ ...prev, [name]: value }));
}, []);
```

React は続くタスクの `setValues` を 1 回の描画にまとめるので、描画のときの `values.message` は最後の 1 件になる。前と `Object.is` で等しい値なら描画そのものが起きない。Vue の `values[name] = value` も、等しい値では依存を起こさない。`values` は「状態」の形で、出来事を数える形ではない。

宣言には `semantics: "event"` があり、出来事であることは分かっている。アダプターは今これを読まない。

### 1.3 提案

**A（推奨）: 出来事ごとのコールバックをオプションに足す。**

```tsx
const [ref, values] = useWcBindable<WcsSse, WcsSseValues<Stock>>(
  { connected: false, loading: false, error: null },
  { onUpdate: (name, value) => { if (name === "message") apply(value); } },
);
```

- `bind()` が呼び返すたびに、`values` を更新するのと同じ所で同期に呼ぶ。描画やまとめとは無関係
- 名前は Svelte の action がすでに取る `onUpdate` にそろえる
- React では最新の関数を ref に持ち、渡し直しで束縛し直さない
- `values` の意味は変わらない。追加的で、今のコードはそのまま動く
- Vue の `useWcBindable` にも同じオプションを足す

**B: `semantics: "event"` の出力を `values` で扱わない**（コールバックでだけ渡す）。意味としては正しいが、今 `values.message` を読んでいるコードが壊れる。

**C: 文書だけにする。** wcstack の手引きは今、要素に `addEventListener` するよう書いている（§6）。動くが、アダプターを使う意味の半分が無くなり、イベント名（`wcs-sse:message`）を利用者が知らなければならない。宣言から分かることを、もう一度手で書かせることになる。

### 1.4 互換

A は追加的。B は `values` の形を変える。

## 2. React の hook が要素を返さない

```js
// @wc-bindable/react 0.10.0
const [el, setEl] = useState(null);
const ref = useCallback((node) => setEl(node), []);
// …
return [ref, values];
```

hook は要素を state に持っているのに返さない。命令を呼ぶ（`el.fetch()`・`el.close()`）、オブジェクトの入力を代入する（`el.files = …`、定義の前の React 19 は属性に書いてしまう）、イベントを聴く — どれも要素が要る。wcstack の例は ref を合成するコールバックを書いている:

```tsx
const [bindRef, values] = useWcBindable<WcsSse, WcsSseValues<Stock>>();
const el = useRef<WcsSse | null>(null);
const ref = useCallback((node: WcsSse | null) => { el.current = node; bindRef(node); }, [bindRef]);
```

fw-inventory の著者は、これを例から写し、コンポーネントごとに繰り返した。README はこの形にも、要素の取り方にも触れていない。

**提案: `[ref, values, el]` を返す**（`el` は `T | null`。すでにある state をそのまま）。追加的で、分割代入の 2 つまでを使う今のコードは変わらない。

Vue の `ref` はすでに `Ref<T | null>` なので、`ref.value` が要素だと README に書けば足りる。

## 3. Vue の README の `:ref="ref"` は `<script setup>` で束縛しない

README の例:

```vue
<script setup lang="ts">
const { ref, values } = useWcBindable<HTMLElement>({ value: "" });
</script>
<template>
  <my-input :ref="ref" />
</template>
```

`<script setup>` の最上位の束縛は、テンプレートの式の中で ref が剥がされる。`:ref="ref"` の式は `ref.value`、つまり描画の時点の `null` になり、テンプレート ref は付かない。`onMounted` で `templateRef.value` は `null` のままで、`bind()` は呼ばれない。`values` は初期値のまま、警告も無い。

Vue 3.5.44 で 3 つの形を並べて確かめた（`<wcs-storage>` が保存済みの値を読み込んだ後の `values.value`）:

| 形 | 結果 |
|---|---|
| `const { ref, values } = useWcBindable()` と `<x :ref="ref">` | 空のまま |
| `const { ref: el, values } = useWcBindable()` と `<x ref="el">` | 値が届く |
| `const { ref: el, values } = useWcBindable()` と `<x :ref="el">` | 空のまま |

名前ではなく、動的な `:ref` で ref オブジェクトを渡すことが原因である。**提案: README の例を `ref="名前"` の形にする。**

```vue
<script setup lang="ts">
const { ref: input, values } = useWcBindable<HTMLElement>({ value: "" });
</script>
<template>
  <my-input ref="input" />
</template>
```

wcstack の 3 つの README（fetch・storage・websocket）もこの例を写していて、同じく束縛していなかった。4.6 で直した。

## 4. npm の README の相対リンク

`@wc-bindable/react` と `vue` の README は「[SPEC.md § Deferring Discovery Until Definition](../../SPEC.md#…)」「[SPEC-extensions.md](../../SPEC-extensions.md)」「[CONFORMANCE.md](../../CONFORMANCE.md)」と相対でリンクしている。npm のパッケージには入っていないので、`node_modules/` の中でも npmjs.com の上でも辿れない。fw-inventory の著者は GitHub のリポジトリを手で探した。**提案: `https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/…` の絶対 URL にする。**

## 5. README に入力と命令が無い

README の API の節は、`[ref, values]` / `{ ref, values }` と出力の同期だけを書いている。宣言の `inputs` と `commands` — プロパティに代入する、メソッドを呼ぶ — はアダプターの外の話だが、利用者はそこで迷う。

- 入力は要素のプロパティに代入する。オブジェクトの入力は、定義の前の要素では属性に書かれてしまう（React 19 は `in` で判定する）ので、要素を取って代入する
- 命令は要素のメソッドを呼ぶ。`trigger` のような「`true` を書くと走り、要素が `false` に戻す」入力は、フレームワークの状態から書くと 1 回しか走らない（2 回目の `true` は変化ではないので書かれない）。命令を呼ぶ

**提案: README に「入力と命令」の一節を足す。** §2 の要素の取り方と組みにする。

## 6. wcstack 側で済ませたこと（4.6）

- [framework-adapter-integration.md](./framework-adapter-integration.md) §5: `event` の出力はアダプターの `values` で読まず、要素のイベントを聴く。§2: React で要素を持つ合成 ref、Vue の静的な `ref="名前"`。§6: フレームワークからは `trigger` でなく命令
- fetch・storage・websocket の README の Vue の例を `ref="名前"` に直した
- `examples/websocket-chat` の React と Vue の例は、`wcs-ws:message` を要素で聴く。React の例は、まとめて送った 5 件のうち 2 件しか記録していなかったのが、5 件とも記録するようになった

§1 の A が入れば、手引きと例は「要素で聴く」から「`onUpdate` で受ける」に書き換えられる。

## 7. 再現の手順

- **§1**: `<wcs-sse>`（や `message` を `semantics: "event"` で宣言した任意の要素）を `useWcBindable` で束ね、`useEffect(…, [values.message])` で数える。サーバーから 5 件を 1 回の書き込みで送る（`res.write("data: 1\n\ndata: 2\n\n…")`）。要素のイベントは 5 回、effect は 1〜2 回
- **§3**: 値を持って接続する要素（`<wcs-storage storage-key="k">` と `localStorage.k`）を `<script setup>` で `:ref="ref"` と `ref="el"` の 2 通りに束ね、`values.value` を表示する
