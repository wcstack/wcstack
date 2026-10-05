# ネイティブ要素のコマンド（`features/native-commands`）

作成 2026-10-06（branch `research/primitive-dom-commands`、`research/state-engine` から分岐）。

## 0. 要約

- **問い**: `<dialog>`・`<input>`・`<video>` のようなネイティブ要素に `command.<method>:` を効かせ、state の JS から DOM 要素に触れずに `showModal()`・`focus()`・`play()` を呼べるか。
- **答え**: できる。拒否しているのは `attachCommand`（`src/dom/wc.ts`）の 1 か所だけ。ただし「何でも呼べる」形にはできず、呼べるメソッドの表・イベント引数の扱い・描画のタイミングを決める必要がある。
- **決定**: コアにはフック 1 本（`hooks.nativeCommand`）だけを置き、表と呼び出し方は新しい後付け `features/native-commands` に持たせる。完全版の入口（`@wcstack/state`・`/auto`）は全部入りなのでそのまま使える。`/core` のページは後付けを入れたときだけ使える（入れなければ従来どおり `#1202`）。

```html
<button data-wcs="onclick: $command.openEditor">編集</button>
<dialog data-wcs="command.showModal: $command.openEditor; command.close: $command.closeEditor">
  <input data-wcs="command.focus: $command.focusTitle">
</dialog>
```

```js
// state は token を emit するだけ。DOM には触れない
this.$command.closeEditor.emit("saved");   // → dialog.close("saved")
```

## 1. 現状（4.0.0-rc.4）

- `command.<method>:` は wc-bindable の `static wcBindable.commands` に宣言されたメソッドだけを呼ぶ。
- ネイティブ要素には定義を待つ相手がないので、`whenDefined`（`src/dom/wc.ts`）が即座に `attach(null)` を呼び、`attachCommand` が `#1202 [wcs/token-misconfigured] <dialog> declares no static wcBindable (command.showModal).` を投げる。README（「`command.<methodName>:` バインディング」の検証ルール）に「ネイティブ要素はその場で拒否されます」と明記された仕様。
- lint（vscode-wcs）は `command.` の右辺（`$command.<name>`）だけを見ていて、左辺の要素がネイティブかどうかは見ていない。

### 1.1 これまでの回避策と、その不足

| 回避策 | 不足 |
|---|---|
| state メソッドで `e.target`（や `closest`）を操作する | state の JS が DOM に触れる（今回避けたいこと） |
| ラッパーのカスタム要素を書き、`wcBindable.commands` を宣言する | 要素 1 種ごとに JS を書く。focus のような汎用操作のために部品が増える |
| `<dialog data-wcs="open: isOpen">` | 非モーダルしか開けない（`showModal()` の top layer・`::backdrop`・Esc・フォーカス移動が無い） |
| Invoker Commands（`<button commandfor="dlg" command="show-modal">`、Baseline Newly 2025-12） | ボタンのクリックが起点のときだけ。state が起点の操作（fetch の完了後に閉じる、検証後に focus する）は書けない。dialog / popover 以外の操作（focus・play）も無い |

Invoker Commands は wcstack なしで書けるので、ボタンだけで済むなら今後もそちらを勧める。この後付けは「state が起点の操作」と「Invoker Commands に無い操作」を埋める。

## 2. スパイク（2026-10-06）

`attachCommand` を、wcBindable の無いネイティブ要素なら許可表で判定するように書き換え、happy-dom で次を確かめた（5 件とも成功）。

1. state の emit で `<dialog>.showModal()` / `close("cancel")` が呼ばれ、`returnValue` が `"cancel"` になる。
2. `onclick: $command.x` からの emit でも開閉でき、`returnValue` が `"[object PointerEvent]"` にならない（§4.3 の規則）。
3. `<input>.focus()` が state から呼べる。
4. 表に無いメソッド（`remove`・`setAttribute`・`insertAdjacentHTML`）は拒否される。
5. 要素が持たないメソッド（`<div>` の `showModal`）は拒否される。

`dist/core.min.js`（gzip、上限 20,000 B、当時 19,500 B）:

| 方式 | core.min.js | 増分 |
|---|---:|---:|
| 許可表をコアに直接書く | 19,696 B | +196 B（残り 500 B の約 4 割） |
| コアにはフックだけ、表は後付け | 19,537 B | +37 B |

→ フック方式を採る（§3）。

## 3. 配置

### 3.1 コア（`src/dom/wc.ts`・`src/hooks.ts`）

- フック `hooks.nativeCommand(el, method)`: wcBindable の宣言が無い要素の `command.<method>:` で呼ぶ。後付けは呼び出し関数 `(target, args) => unknown` を返す。カスタム要素には null を返し、コアは従来どおり `#1202` を投げる。表に無いメソッドなら後付けが自分で投げる。
- コアは返った呼び出し関数を、購読者の中で `target[method](...args)` の代わりに呼ぶだけ。`WeakRef`・`isConnected`・行の後始末・`Token.emit` の例外処理はカスタム要素と共通のまま。
- 後付けが無い（`/core`）なら挙動は今と同じ。

### 3.2 後付け（`src/native/commands.ts`・`src/features/native-commands.ts`）

- `src/native/commands.ts`: 許可表 `NATIVE_COMMANDS`（§4.1）とフックの中身 `nativeCommand`。ほかの後付けと同じく、後付けのディレクトリと `features/` の入口に分ける（入口は `nativeCommands` と `default` だけを出し、表は公開しない）。
- `src/features/native-commands.ts`: フックを埋める `install()`。
- `scripts/check-state-coupling.mjs` の `FEATURE_DIRS` に `native: "native-commands"` を足した（`src/native/` を後付けのモジュールとして数える）。
- 名前は `native-commands`（`$features`・`<wcs-state features>`・`build.mjs` の `FEATURES`・`load.ts` の `FEATURE_NAMES`・`features/all.ts`）。完全版の入口は全部入りなので、`@wcstack/state` と `/auto` ではそのまま使える。

### 3.3 表の共有（manifest）

lint と VS Code 拡張は、ランタイムが読む表を manifest から読む（`behaviorOptions`・`features` と同じ）。manifest に `nativeCommands`（タグ → メソッド名の配列、`*` は全要素）を足し、`public/manifest.ts` は後付けの表の写しを出す（`public/manifest.ts -> native/commands.ts`。`public/manifest.ts -> filters/formats.ts` と同じ形の、道具の入口から後付けへの import）。写しにするのは、`getWcsManifest()` は `@wcstack/state` からも出ているので、受け取った側の書き換えがランタイムの表に届かないようにするため。

## 4. 仕様

### 4.1 呼べるメソッド

| 要素 | メソッド |
|---|---|
| すべての要素（`*`） | `focus` `blur` `click` `scrollIntoView` `showPopover` `hidePopover` `togglePopover` |
| `dialog` | `show` `showModal` `close` `requestClose` |
| `form` | `requestSubmit` `checkValidity` `reportValidity` |
| `input` | `select` `setSelectionRange` `showPicker` `setCustomValidity` `checkValidity` `reportValidity` |
| `textarea` | `select` `setSelectionRange` `setCustomValidity` `checkValidity` `reportValidity` |
| `select` | `showPicker` `setCustomValidity` `checkValidity` `reportValidity` |
| `audio` `video` | `play` `pause` `load` |

- **判定は表だけで、`typeof el[method]` を見ない。** ブラウザ（や SSR の happy-dom）がメソッドを持つかどうかで束縛の成否が変わると、あるブラウザでだけページの初期化が止まる。表にあって要素が持たないメソッド（古いブラウザの `requestClose`、SVG 要素の `click`）は、呼んだときに `TypeError` になり、`Token.emit` が token 名つきで `console.error` に出す（購読者が投げたときと同じ）。
- タグは `localName` で引く。カスタマイズ済み組み込み要素（`<button is="x-btn">`）はネイティブ要素として扱う。表は自身のプロパティだけを見る（`<constructor>` のような未知の要素名で `Object.prototype` を引かない）。

### 4.2 入れないメソッドとその理由

| メソッド | 理由 |
|---|---|
| `insertAdjacentHTML` `setHTMLUnsafe` `setHTML` | HTML シンク。`html:` 束縛の Trusted Types ポリシーを迂回する |
| `setAttribute` `toggleAttribute` `removeAttribute` | 属性の書き込み。`on*` 属性ならスクリプトが走る。属性は `attr.` 束縛で書く |
| `remove` `append` `prepend` `before` `after` `replaceWith` `replaceChildren` | 木の書き換え。束縛と構造テンプレートの前提が崩れる |
| `reset`（form）`stepUp` `stepDown` `setRangeText` | コントロールの値を `input` イベント無しで変える。双方向束縛の state が変化を知らず、表示と食い違う。値は state を書き換えて戻す |
| `submit`（form） | 入力検証と `submit` イベントを飛ばす。`requestSubmit` を使う |
| `requestFullscreen` `requestPointerLock` `requestPictureInPicture` | 状態の出力も持つ I/O ノード（`@wcstack/fullscreen`・`pointer-lock`・`picture-in-picture`）がある |
| `dispatchEvent` `attachShadow` `animate` など | 用途が汎用すぎる、または必要が見えていない。要望が出たら個別に検討する |

### 4.3 引数

- **emit の第 1 引数が `Event` なら、引数なしで呼ぶ。** `on…: $command.x` の emit は `(event, ...listIndexes)` を渡すが、ネイティブメソッドに素通しすると壊れる: `close(event)` は `returnValue` を `"[object PointerEvent]"` にし、`requestSubmit(event)` は `TypeError`、`setSelectionRange(event)` も `TypeError` になる。
- それ以外（state からの `emit(...)`）はそのまま渡す: `close("saved")`・`focus({ preventScroll: true })`・`scrollIntoView({ block: "center" })`・`setCustomValidity("…")`・`setSelectionRange(0, 3)`。
- カスタム要素の「引数はそのまま渡す」契約とは違う。README に書く。

### 4.4 戻り値と例外

- 戻り値はカスタム要素と同じく `emit()` の結果の配列に入る（`checkValidity()` の真偽、`play()` の Promise）。
- 同期の例外（開いている非モーダルの dialog への `showModal()` の `InvalidStateError`、`popover` 属性の無い要素への `showPopover()` の `NotSupportedError`）は `Token.emit` が `console.error` に出し、ほかの購読者には届く。
- Promise の reject は捕捉しない（カスタム要素と同じ契約）。`play()` の reject（自動再生の拒否、`pause()` による中断）は、state から `await Promise.all(this.$command.play.emit())` で受ける。`onclick: $command.play` の経路では受け手がいないので unhandledrejection になる。

### 4.5 タイミング（focus で最もつまずく点）

- 描画（drain）はマイクロタスクで後から走る。同じハンドラで `this.editing = true; this.$command.focusTitle.emit();` と書くと、emit はまだ表示されていない input に届き、focus は効かない（`if:` の中の要素ならまだ購読もしていない）。
- 表示を変えた直後の focus は、`$renderedCallback` から emit する（または `await` で描画を待ってから emit する）。README に例を載せる。描画後に emit する専用の API は今回は作らない（§6）。

### 4.6 ユーザー操作の要る API

`showPicker()` と音声つきの `play()` は、直前のユーザー操作（transient activation）が要る。`onclick: $command.x` の経路はクリックの処理の中で同期に呼ぶので有効。state で `await` した後に emit すると期限が切れて失敗しうる。

### 4.7 エラーとメッセージ

- 表に無いメソッド: 新しい番号 `#1205`（`[wcs/token-misconfigured]`、`M.NativeNoCommand`）。診断の後付けがあれば `<div> has no command "showModal" (a native <div>'s commands: focus, blur, …).` に did-you-mean を付ける。診断の後付けが無ければ `#1205 "div" "showModal" "focus, blur, …"`。カスタム要素と同じく、ページのバインド中ならその `<wcs-state>` の初期化を失敗させ、`for:` / `if:` の行の中なら束縛 1 本の失敗として `$errorCallback` に届く。
- 後付けを入れていない `/core` のページのネイティブ要素は、従来どおり `#1202`。診断の後付けがあれば `features/native-commands` を案内する一文を足す。

### 4.8 対象外

- wcBindable を持たないカスタム要素（`focus()` させたいデザインシステムの入力部品など）は対象外のまま。カスタム要素は呼ばれうる面を `wcBindable.commands` で宣言する、という契約を崩さない。
- SVG / MathML の要素は名前空間を見ず、`localName` で表を引く（`*` の行だけが当たる）。

## 5. lint（vscode-wcs）

- `bindingValidator.ts` の `command.` の分岐で、要素名にハイフンが無ければ manifest の `nativeCommands` と突き合わせ、表に無ければ `wcs/token-misconfigured` の error（did-you-mean つき）を出す。ランタイムは初期化ごと失敗させるので、`spread-no-bindable` と同じく error にした（同じコードの右辺の誤りは従来どおり warning）。
- コミット済みの `packages/state/dist` はリリースまで古いままなので、`nativeCommands` が無い manifest では検査しない（CI の `wcs-validate` は state を src からビルドしてから走る）。

## 6. 今後の候補

- 描画の後に emit する手段（`$renderedCallback` を書かずに「表示してから focus」を書ける形）。
- `animate`・`requestFullscreen` などの追加は、需要と I/O ノードとの棲み分けを見て決める。
- wcstack-skill（別リポジトリ）の command-token の参照を更新する。
- VS Code 拡張の補完で、ネイティブ要素の `command.` の後に表のメソッドを出す（組み込みの wcs-* タグの `command.` にも補完は無い）。

## 7. 実装の記録（2026-10-06）

### 7.1 変更

- コア: `hooks.nativeCommand`（`src/hooks.ts`、`mangle.mjs` で短縮）と、`attachCommand`（`src/dom/wc.ts`）がそれを使う分岐。メッセージ番号 `#1205`（`src/messages.ts`）。
- 後付け: `src/native/commands.ts`・`src/features/native-commands.ts`。`build.mjs` の `FEATURES`・`load.ts` の `FEATURE_NAMES`・`features/all.ts`・`src/index.ts`。
- 診断: `#1205` の文と、ネイティブ要素の `command.` の `#1202` に後付けを案内する一文（`src/diagnostics/messages.ts`）。
- manifest: `nativeCommands`（`IWcsManifest` と `getWcsManifest()`）。
- vscode-wcs: `wcsManifest.ts`（`NATIVE_COMMANDS`・`nativeCommandsOf`）、`bindingValidator.ts` の検査、文面 `nativeCommandUnknown`（日英）。「もしかして」の `suggestion` を `ioNodeValidator.ts` から `suggestion.ts` に移した（`bindingValidator.ts` が使うと循環 import になるため）。
- ゲート: `scripts/check-state-coupling.mjs` の `FEATURE_DIRS`、`state-coupling-baseline.json`（`--update` で 3 本の辺: `public/manifest.ts -> native/commands.ts`、native-commands → `hooks.ts`・`messages.ts`）、`state-size-baseline.json`（新しい入口の 1 行だけを足し、ほかの行は rc.4 の値のまま）。
- 文書: state README（日英、「ネイティブ要素のコマンド」の節と入口の表・検証ルール）、`docs/state-errors.md` / `.ja.md`、`docs/migration-v4.md` / `.ja.md`、CHANGELOG、vscode-wcs README（日英）、wcstack の README、e2e の README、CLAUDE.md・AGENTS.md。
- テスト: `__tests__/coverage-addons-native-commands.test.ts`（17 件）、`coverage-element-wc.test.ts`（後付けの無い `/core` の `#1202`）、`coverage-element-sentences.test.ts`（`#1205` の文と `#1202` の案内）、`public-surface.test.ts`（manifest の `nativeCommands` が写しであること、入口の export）、`split.test.ts`（名前を短縮した分割ビルドで後付けがフックに届く）、vscode-wcs の `bindingValidator.test.ts`（7 件）、e2e の `state-native-commands.spec.ts`（実ブラウザ 3 件）。

### 7.2 サイズ（gzip、rc.4 の基準値との比較）

| 項目 | rc.4 | この変更の後 | 差 |
|---|---:|---:|---:|
| `dist/core.min.js`（上限 20,000） | 19,500 | 19,525 | +25 |
| `split/features/native-commands.js`（コアの外） | — | 499 | 新規 |
| `split/features/diagnostics.js`（コアの外、上限 7,405） | 7,189 | 7,261 | +72 |
| `split/auto.js`（コアの外、上限 620） | 602 | 610 | +8 |
| `split/core.js`（チャンク込み、上限 24,365） | 23,655 | 23,674 | +19 |
| `index.esm.js`（上限 51,470） | 49,971 | 50,305 | +334 |
| `auto.min.js`（上限 48,335） | 46,927 | 47,328 | +401 |

`split/auto.js` は上限まで 10 B（後付けの名前の一覧が伸びたため）。次に後付けを足すときは、この行の基準値を取り直すか `slack` を考える。

### 7.3 確認したこと

- state: `npm run typecheck`・`lint`・`test:coverage`（3,002 件、閾値を満たす。変更した行と分岐は全網羅）、サイズと結合のゲート（`npm run build` の後）。router と devtools（state の src を読む）のテスト。
- vscode-wcs: 全テスト（1,167 件）、ビルドした `cli.cjs` でリポジトリの全ページを `--errors-only`（error 0）。
- e2e: Chromium・Firefox・WebKit で 3 件ずつ（Firefox と WebKit は一時的な設定で。CI の設定は Chromium だけ）。
- `packages/state/dist` はリリースまで作り直さない慣例なので、ビルドした dist はコミットしていない。両ゲートと vscode-wcs のテストは新しい入口を含む dist を前提にする（CI はどちらも src からビルドしてから走る）。コミット済みの dist に対してローカルで走らせると、サイズゲートは新しい入口の欠落を、結合ゲートは S3（dist の入口の違い）を報告する。
