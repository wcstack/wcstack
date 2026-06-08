# @wcstack/debounce

`@wcstack/debounce` は wcstack エコシステム向けのヘッドレスな debounce / throttle コンポーネントです。

これは見た目を持つ UI ウィジェットではありません。
ノイズの多いシグナルの連打を、静止後の1回の発火に集約する **非同期プリミティブノード** です（`@wcstack/timer` が時間経過をリアクティブな状態にするのと同じ発想）。

1つのエンジンの上に2つのカスタム要素を提供します。

- `<wcs-debounce>` — シグナルが `wait` ms 静止したら1回発火。
- `<wcs-throttle>` — 最大で `wait` ms に1回発火（`maxWait === wait`・leading 既定 on の debounce）。

[CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います。

- **Core**（`DebounceCore`）が lodash の debounce アルゴリズム（`leading` / `trailing` / `maxWait`）を移植し、結果をイベントで公開。
- **Shell**（`<wcs-debounce>` / `<wcs-throttle>`）が DOM 属性・ライフサイクル・宣言的コマンドへ接続。
- **Binding Contract**（`static wcBindable`）が観測可能な `properties`・書き込み可能な `inputs`・呼び出し可能な `commands` を宣言。

## 2つのサーフェス

本質は「シグナルのデバウンス」です。シグナルは **値** を運ぶか、**引数付きのパルス** かのどちらかなので、サーフェスは2つあります（1要素につき片方を使う）。

### 値サーフェス — `source` → `value`

`source` に書き込むと、静止後にデバウンス済みの値が `value` プロパティ（イベント `wcs-debounce:settled`）で公開されます。`source: src; value: debounced` と配線すると `value` が state に書き戻ります。

### シグナルサーフェス — `trigger(...args)` → `fired`

`trigger` コマンドを連打すると、静止後に `wcs-debounce:fired` イベント1発が最後の args を載せて発火します。state は一過性のパルスを値として読めないため、中継にはトークンを使います。

```
source →(command-token)→ debounce.trigger →[coalesce]→ fired →(event-token)→ state → target.method
```

state は [command-token プロトコル](../state/)（`command.trigger: $command.X`）で入口を撃ち、[event-token プロトコル](../state/)（`eventToken.fired: Y`）で集約された1発を受け、本来のメソッドへ再配線します。

> 1つの要素インスタンスは **片方** のサーフェス専用です。同じ要素で `source` と `trigger` を両方駆動すると、最後にスケジュールされたシグナルが勝ちます（lodash の last-args セマンティクス）。

## インストール

```bash
npm install @wcstack/debounce
```

## クイックスタート

### 1. 入力値のデバウンス

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/debounce/auto"></script>

<wcs-state>
  <script type="module">
    export default { query: "", debouncedQuery: "" };
  </script>
</wcs-state>

<input data-wcs="value: query">
<wcs-debounce wait="300" data-wcs="source: query; value: debouncedQuery"></wcs-debounce>
<p>検索: {{ debouncedQuery }}</p>
```

### 2. メソッド呼び出しのデバウンス（シグナルサーフェス）

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["search"],
      $eventTokens: ["searchSettled"],
      query: "",
      $on: {
        searchSettled: (state, event) => {
          const [q] = event.detail.args; // 最後のキー入力から 300ms 後に1回だけ
          state.results = doSearch(q);
        }
      }
    };
  </script>
</wcs-state>

<input data-wcs="oninput: $command.search">
<wcs-debounce
  wait="300"
  data-wcs="command.trigger: $command.search; eventToken.fired: searchSettled">
</wcs-debounce>
```

### 3. 高頻度な値ストリームのスロットル

```html
<wcs-throttle wait="100" data-wcs="source: scrollY; value: throttledScrollY"></wcs-throttle>
```

`<wcs-throttle>` は既定で leading（即時発火し、以後は最大 `wait` ms に1回）。

## 属性 / Inputs

| 属性          | 型      | 既定 (`<wcs-debounce>`) | 既定 (`<wcs-throttle>`) | 説明 |
| ------------- | ------- | ----------------------- | ----------------------- | ---- |
| `wait`        | number  | `250`                   | `250`                   | 静止期間 (ms)。不正・負・非数値は既定値にフォールバック。 |
| `leading`     | boolean | off                     | **on**（`no-leading` で無効化） | バースト先頭で発火。 |
| `no-trailing` | boolean | off（trailing 有効）    | off（trailing 有効）    | 末尾発火を無効化。 |
| `max-wait`    | number  | なし                    | `wait`                  | 連続入力中でも最大 `max-wait` ms ごとに発火を強制。`>= wait` にクランプ。 |
| `source`      | any     | —                       | —                       | 値サーフェスの入力。デバウンス結果は `value` に返る。 |

## 観測可能プロパティ（outputs）

| プロパティ | イベント                       | 説明                                       |
| ---------- | ------------------------------ | ------------------------------------------ |
| `value`    | `wcs-debounce:settled`         | 最後の `source` 書き込みのデバウンス済み値。 |
| `fired`    | `wcs-debounce:fired`           | 最後の `trigger()` パルスの集約 args。       |
| `pending`  | `wcs-debounce:pending-changed` | デバウンス進行中は `true`。                  |

`<wcs-throttle>` は同じ形を `wcs-throttle:*` 名前空間で公開します。

## コマンド

| コマンド  | 説明                                                       |
| --------- | ---------------------------------------------------------- |
| `trigger` | シグナルサーフェスの入口。`...args` を載せてパルスを集約。  |
| `cancel`  | 保留中の発火を捨てる（getter は前回値を保持）。            |
| `flush`   | 保留中のペイロードを即発火（保留がなければ no-op）。       |

## 任意の DOM トリガー

`config.autoTrigger` が有効（既定）なら、`data-debouncetarget="<id>"` を持つ要素のクリックで、参照先の `<wcs-debounce>` / `<wcs-throttle>` に対し集約済みの `trigger()` を1発撃ちます（クリックの既定動作は抑制）。

## ヘッドレス利用（`DebounceCore`）

Core は DOM 非依存で、`@wc-bindable/core` の `bind()` から直接利用できます。

```typescript
import { DebounceCore } from "@wcstack/debounce";

const core = new DebounceCore("wcs-debounce", undefined, { wait: 300 });
core.addEventListener("wcs-debounce:settled", (e) => {
  console.log((e as CustomEvent).detail.value);
});
core.setSource("a");
core.setSource("b"); // "b" だけが 300ms 後に settle
```

throttle は prefix と `maxWait === wait` を変えた同じエンジンです。

```typescript
const throttle = new DebounceCore("wcs-throttle", undefined, { wait: 100, leading: true, maxWait: 100 });
```

## ライセンス

MIT
