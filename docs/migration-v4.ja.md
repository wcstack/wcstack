# @wcstack/state 3.x → 4.0 移行ガイド（プレビュー）

**English**: [migration-v4.md](./migration-v4.md)

> **プレビュー — 4.0 はまだリリースされていません。** このガイドは、開発中（2026 年 10 月時点）の 4.0 のエンジンについて書いたもので、3.x の利用者が前もって準備できるように公開しています。名前・メッセージ・細部はリリースまでに変わることがあります。*（未確定）* と書いた項目は、見直し中と分かっているものです。最終的な一覧は [CHANGELOG](../CHANGELOG.md)（英語）の 4.0.0 の項になります。

**対象**: `@wcstack/state` 3.x を使っているアプリの開発者です。`@wcstack/state`・`/auto`・分割エントリ・`wcstack/auto` のどれで読み込んでいるかは問いません。一緒にリリースされるパッケージ（`@wcstack/router`・`@wcstack/server`・I/O ノードのパッケージ・`@wcstack/lint`）も含みます。

## 4.0 で変わること

4.0 は `@wcstack/state` の中のエンジンを、書き直したものに置き換えます。書く側から見た形は変わりません: `<wcs-state>`、`data-wcs`・`{{ }}`・コメントバインディング、`for` / `if`、パスとパス getter、`$` の API、`bind-component`、`mount=` のボリューム、`enable-ssr`、パッケージの入口（`.`・`/auto`・`/core`・`/features/*`・`/define`・`/parser`・`/manifest`）はそのままです。変わるのは次の点です。

- 3.2 の旧名、`substr` フィルタ、`$scan` がなくなります。
- `bootstrapState()` の 3 つのオプションが、状態の `$behavior` に移ります。どのパッケージの `bootstrapXxx()` も、持っていないオプションを渡すと throw します。
- よく使うバブリングするイベントの `on*:` ハンドラは、ルートに委譲されます。そのため `event.currentTarget` はルートになります。`#direct` を付けたバインディングは委譲されません。
- リストの要素への書き込みは、その位置の値を置き換えます。行が値と一緒に動くことはなくなります。
- ボリュームは `$watch`・`$listKeys`・`$renderedCallback` を実行せず、注入も受け付けません。
- SSR の出力は 3.x と互換がありません。`@wcstack/server` とクライアントを一緒に上げます（4.0 のクライアントは、3.x の出力をクライアントで描き直します）。
- 描画の規則と公開 API のいくつかが変わります。

進め方は、**まず 3.5 に上げて警告を消し（`$behavior` へ移る 3 つのオプションの警告は除く。§1.8）、それから 4.0 に移る**、です。いつものリリースと同じく、すべての `@wcstack/*` パッケージがそれぞれの版に一緒に上がります。

## チェックリスト

3.5 で（§1）:

- [ ] CDN の URL をメジャー版 3 に固定する。準備ができる前に 4.0 がページに届かないようにするため。
- [ ] すべての `@wcstack/*` パッケージを 3.5 にする。
- [ ] 全部入りの入口でページを動かし、コンソールの `[wcs/v4-migration]` の警告を消す。ただし `$behavior` へ移る 3 つのオプションの警告は、4.0 に上げるまで出続ける（§1.8）。
- [ ] 各パッケージの `bootstrapXxx()` がオプションについて出す警告を消す。
- [ ] `@wcstack/lint` 3.5 を流し、報告を消す。
- [ ] 3.2 の旧名を正式名に直す。
- [ ] `substr(start, length)` を `slice(start, start + length)` に直す。
- [ ] `$scan` を `$watch` / `$on` で書き直す。
- [ ] `event.currentTarget` を読むハンドラ: `#direct` を付けるか、`event.target.closest(...)` を使う。
- [ ] `bootstrapState()` から `debug`・`commentTextPrefix`・`enablePropagationContext` を消す。

4.0 に上げるときに（§2・§3）:

- [ ] すべての `@wcstack/*` パッケージを一度に 4.0 にする。
- [ ] `@wcstack/server` 4.0 を、4.0 のクライアントと一緒にデプロイする（§3.6）。
- [ ] `enableMustache` / `sameValueGuard` / `enableDirectionalInitialSync` を、`bootstrapState()` から、それを要するルートの状態ごとの `$behavior` へ移す（§3.2）。
- [ ] `#stop` と、ページ側のコードの `stopPropagation()` を見直す（§3.3）。
- [ ] 行の並べ替えは、要素への書き込みではなく、新しい配列の代入で行う（§3.4）。
- [ ] 行や枝の要素を `[data-wcs]` で選ぶ CSS やテストのセレクタを置き換える（§3.4）。
- [ ] `for:` / `if:` のテンプレートの中の `outerHTML:` / `outerText:` を、包む要素の `innerHTML:` に置き換える（§3.4）。
- [ ] `for:` のフィルタを、フィルタを通したリストを返す getter に置き換える（§3.4）。
- [ ] ボリュームの `$watch` / `$listKeys` / `$renderedCallback` を、ルートの状態へ移す（§3.5）。
- [ ] ボリュームへの注入を、ルートの状態の getter に置き換える（§3.5）。
- [ ] `listPaths` / `getterPaths` / `setterPaths` / `nextVersion()` を使っている箇所を置き換える（§3.7）。
- [ ] `/core` のページ: `$listKeys` を使うなら `features/list-keys` を入れる（§3.8）。
- [ ] `/core` のページ: 開発中は `features/diagnostics` を入れる（§3.8）。
- [ ] どこにも報告されない変更を読む: 中身をバインドする要素の子、`<noscript>` / `<iframe>`、`<textarea>` / `<title>` の中のコメント、数値の添字を持つキーや、複数の行が持つ配列の `$watch`、リストの代入で残った行の、行 getter の `$watch`、リストの末尾より先の読み（§3.4）。SSR の出力の後処理（§3.6）。router の outlet に増える子ノード（§3.9）。
- [ ] `@wcstack/lint` 4.0 を流し、報告を直す（§4）。

> **コメントバインディングは残ります。** `<!--@@: path-->` と `<!--@@wcs-text: path-->` は 4.0 でも使えます。lint が、描画前の表示のちらつき（FOUC）を避けるために `<template>` の外の `{{ }}` の代わりに勧めている書き方で、4.0 は `enableMustache` を切っていてもバインドします。なくなるのは、キーワードを変える `commentTextPrefix` オプションだけです。詳しくは §3.4。

## 1. 上げる前に: まず 3.5 へ

3.5 は 4.0 の手前の段です。3.x の挙動はそのままで、4.0 で外れる・変わる書き方を、コンソールと lint で警告します。この節で直したものは 3.5 で動き、4.0 でも動き続けます。`@wcstack/state` 3.5 の README には、同じ一覧の「Preparing for 4.0」の節があります。

### 1.1 メジャー版を固定して、3.5 にする

`https://esm.run/@wcstack/state/auto` は最新版を指すので、4.0 が公開された日から 4.0 を読み込みます。移行が終わるまでは、メジャー版を固定してください。固定した URL は 3.5 を読み込みます。

```html
<script type="module" src="https://esm.run/@wcstack/state@3/auto"></script>
```

CDN から読んでいるほかのパッケージと、`@wcstack/state` を同梱する `wcstack/auto` も同じです。npm では、すべての `@wcstack/*` パッケージを 3.5 にします。`^3.5.0` のような範囲指定は 3.x に留まります。§3.9 の router の変更は、`@wcstack/router` 3.5 の時点で入ります。

### 1.2 実行時の警告を消す

- `@wcstack/state` 3.5 は、コンソールに `[wcs/v4-migration]` の警告を、メッセージごとに 1 回出します。出すのは全部入りの入口（`@wcstack/state` と `/auto`）だけで、分割の `/core` は出しません。分割エントリのページは一度全部入りの入口で動かすか、lint に頼ってください（§1.3）。
- 対象は、3.2 の旧名、`$scan` と `substr`、4.0 で削除される・`$behavior` へ移る `bootstrapState()` のオプション、知らない・型の違う `bootstrapState()` のオプション、3.x が反映しない・4.0 が throw する `$behavior` / `$features` の値、ボリュームの `$behavior` / `$features`（4.0 は接ぎ木を拒む）です。
- `enableMustache`・`sameValueGuard`・`enableDirectionalInitialSync` の警告は、3.5 では消せません。これらのオプションは 4.0 に上げるまで `bootstrapState()` に残すので（§1.8）、それまでは警告が出るものと考えてください。
- ほかのパッケージの `bootstrapXxx()`（router と autoloader を含む）も、4.0 が拒むオプションを警告します。知らないオプション、型の違う値、`tagNames` の中の知らない名前や文字列でない値です。autoloader は `scanImportmap` も警告します。
- コンソールが静かでも、そのセッションで実行しなかったコードについては何も分かりません。

### 1.3 3.5 の lint を流す

```bash
npx @wcstack/lint@3.5 index.html
```

VS Code 拡張も同じ内容を出します。

- `wcs/name-alias`（info）: 3.2 の旧名。旧名と正式名のキーを両方宣言した状態は `wcs/declaration-alias`（error）、宣言キーを旧名で読む箇所（`this.$streams`）は `wcs/declaration-alias-read`（warning か info）になります。
- `wcs/v4-migration`（info）: `$scan`。`substr`（引数が 0 以上のリテラルなら、そのまま書ける `slice` の呼び出しを示します）。`event.currentTarget` を読む、バブリングするイベントの `on*:` ハンドラ。
- 3.x でもすでに壊れていて、4.0 が拒む書き方への警告: `for:` / `if:` のテンプレートの中の `outerHTML:` / `outerText:`、行の中の別のリストの `*`、マークアップの `$0` / `$129`、スクリプトの `this.$0` / `this.$129`（`wcs/index-param-range`）、2 つ目のルートの `<wcs-state>`（`wcs/second-root`）。

info は終了コードに影響せず、`--errors-only` を付けると隠れます。出力を全部読んでください。

### 1.4 正式名を使う

3.2 で次の名前を改名し、旧名は 3.x の間だけ別名として残しました。4.0 は別名を外します。

| 種類 | 旧名（4.0 で削除） | 代わりに書く名前 |
|---|---|---|
| フィルタ | `inc` / `dec` | `add` / `sub` |
| フィルタ | `fix` | `toFixed` |
| フィルタ | `uc` / `lc` / `cap` | `upper` / `lower` / `capitalize` |
| フィルタ | `rep` / `rev` | `repeat` / `reverse` |
| フィルタ | `pad` | `padStart` |
| フィルタ | `null` | `nullIfEmpty` |
| Proxy API | `$trackDependency` / `$untrackDependency` | `$dependOn` / `$untracked` |
| 宣言キー | `$updatedCallback` | `$renderedCallback` |
| 宣言キー | `$streams` | `$stream` |

### 1.5 `substr` を `slice` にする

4.0 は `substr` フィルタを外します。`slice` の第 2 引数は長さではなく、終わりの位置です。

```html
<!-- 3.x だけ -->
<span data-wcs="textContent: code|substr(2, 3)"></span>

<!-- 3.5 と 4.0 -->
<span data-wcs="textContent: code|slice(2, 5)"></span>
```

開始位置が 0 以上なら、`substr(start, length)` は `slice(start, start + length)` です。負の開始位置はどちらも末尾から数えますが、終わりの扱いが違うので、その呼び出しは個別に確かめてください。

### 1.6 `$scan` を `$watch` か `$on` で書き直す

4.0 は `$scan` を外します。積み上げる値はふつうのキーとして持ち、ハンドラから書き込みます。

- `from: "path"` の scan は、そのパスの `$watch` ハンドラにする。
- `on: "token"` の scan は、そのイベントトークンの `$on` ハンドラにする。
- `resetOn` は、初期値を書き戻す `$watch` ハンドラにする。

```js
// 3.x だけ
export default {
  amount: 0,
  room: "lobby",
  $eventTokens: ["message"],
  $scan: {
    total: { from: "amount", initial: 0, fold: (sum, cur) => sum + cur },
    log: { on: "message", initial: [], fold: (log, e) => [...log.slice(-49), e.detail], resetOn: ["room"] },
  },
};
```

```js
// 3.5 と 4.0
export default {
  amount: 0,
  room: "lobby",
  total: 0,
  log: [],
  $eventTokens: ["message"],
  $watch: {
    amount(cur) { this.total = this.total + cur; },
    room() { this.log = []; },
  },
  $on: {
    message: (state, e) => { state.log = [...state.log.slice(-49), e.detail]; },
  },
};
```

`from` の scan と同じく、`$watch` ハンドラは 1 回の更新のバッチで落ち着いた値を 1 つだけ受け取ります。違いは 2 つです。値はふつうの状態として自分で持つことになり（再セットではほかのキーと同じく置き換わります）、リセットは書き込みの瞬間ではなく、バッチの終わりに `$watch` ハンドラが走ったときに起きます。

### 1.7 `event.currentTarget` を読まない

4.0 ではよく使うバブリングするイベントが委譲され、`event.currentTarget` はルートになります（§3.3）。`event.target` から要素を探すか（`event.target.closest("li")` など）、ハンドラが受け取るループのインデックスを使うか、バインディングに `#direct` を付けてください（`onclick#direct: select`）。3.x はもともとハンドラを要素に付けているので、`#direct` は今の 3.x でもそのまま動きます。3.5 の VS Code 拡張は補完の候補にも出します。

### 1.8 `bootstrapState()` のオプション

- `debug`・`commentTextPrefix`・`enablePropagationContext` を消します。`commentTextPrefix` を消す前に、コメントバインディングを既定のキーワード（`<!--@@: path-->` か `<!--@@wcs-text: path-->`）で書き直してください。3.x で `enablePropagationContext: false` を消すと、因果伝播のコンテキストが既定どおり有効に戻ります。4.0 にはこの仕組みがありません。
- `enableMustache`・`sameValueGuard`・`enableDirectionalInitialSync` は、今は `bootstrapState()` に残してください。3.x は `$behavior` を読みません。4.0 に上げるときに移します（§3.2）。それまでは、これらについての 3.5 の警告は出たままで構いません。

## 2. 4.0 に上げる

- すべての `@wcstack/*` パッケージを同じ 4.0 の版にします。
- `@wcstack/server` 4.0 と 4.0 のクライアントを一緒にデプロイします（§3.6）。
- CDN の URL を新しいメジャー版にします（`https://esm.run/@wcstack/state@4/auto`）。
- `@wcstack/lint`・`@wcstack/typescript`・VS Code 拡張の 4.0 の規則は、4.0 と同時に出すリリースに入ります。3.x のプロジェクトでは 3.5 のものを使い続けてください。4.0 の規則は、3.x が受け付ける書き方も報告します。

**4.0 のエラーの出方。** メッセージには lint と同じ `[wcs/<code>]` が付き、多くには番号も付きます。

```
[@wcstack/state] [wcs/filter-unknown] filter not found: uc.      ← @wcstack/state と /auto
[@wcstack/state] [wcs/filter-unknown] #501 "uc"                   ← features/diagnostics を入れない /core
```

文は `diagnostics` 機能が出します。`@wcstack/state` と `/auto` は、この機能を含みます。これを入れない `/core` のページでは、コード・番号・値だけが出ます（3.x はどちらでも文をそのまま出していました）。番号の意味は版をまたいで変わりません。このガイドに出てくるメッセージは §4 の表にまとめました。すべての番号は [state-errors.ja.md](./state-errors.ja.md) にあります。

**削除されたフィルタ名には、「Did you mean」ではなく書き換え先が出ます。** 3.2 の旧名と `substr` では、メッセージが組み込みのいちばん近い名前ではなく、書くべきものを示します（旧名にいちばん近い名前は無関係なフィルタで、`dec` → `eq` に従うと意味が黙って変わります）:

```
[@wcstack/state] [wcs/filter-unknown] filter not found: dec. "dec" was renamed "sub" in 3.2 and removed in 4.0 — write "sub". Validate statically: npx @wcstack/lint <file>.
```

書き換え先は、文と同じく `diagnostics` 機能が出します。これが無いとメッセージは `#501 "dec"` だけなので、§1.4 の表か、lint が示す書き換え先を使ってください。

## 3. 互換性のない変更

### 3.1 なくなる名前と宣言

| 3.x | 4.0 | 実行時のメッセージ | 4.0 の lint |
|---|---|---|---|
| フィルタの旧名（`uc`・`fix` …） | ページの初期化で throw | `[wcs/filter-unknown] filter not found: uc.` に続けて `"uc" was renamed "upper" in 3.2 and removed in 4.0 — write "upper".`（#501） | `wcs/filter-unknown`（warning。書き換え先を示す） |
| `substr(start, length)` | 同上 | `[wcs/filter-unknown] filter not found: substr.` に続けて `"substr" was removed in 4.0 — write slice(start, start + length) …` | `wcs/filter-unknown`（warning。`slice` の呼び出しを示す） |
| `$trackDependency` / `$untrackDependency` | 読んだ時点で throw | `[wcs/name-alias] $trackDependency was removed: write $dependOn.`（#1701） | `wcs/name-alias`（error） |
| `$updatedCallback` / `$streams` | 状態の読み込みで throw | `[wcs/declaration-alias] $streams was removed: write $stream.`（#1601） | `wcs/declaration-alias`（error） |
| `$scan` | 状態の読み込みで throw | `$scan was removed (use $watch or $on)`（#1） | `wcs/scan-declaration-invalid`（error） |

`diagnostics` 機能が無いと、実行時のメッセージはコード・番号・名前だけで、書き換え先を示しません（§2）。

ボリューム（`<wcs-state mount=…>`）では、なくなった宣言キーと `$scan` は throw しません。そのボリュームは接ぎ木されず、理由が `console.error` に出ます（§3.5）。

`wcs/filter-unknown` は、実行時には throw しますが lint では warning です。ページが実行時に自分のフィルタを登録できるためです。

直し方: §1.4〜§1.6。

### 3.2 設定

#### `bootstrapState()` は表記を受け持ち、振る舞いは `$behavior` へ

| オプション | 3.x | 4.0 |
|---|---|---|
| `bindAttributeName`・`tagNames.state`・`tagNames.ssr`・`commentForPrefix`・`commentIfPrefix`・`commentElseIfPrefix`・`commentElsePrefix`・`locale`・`enableContractAnalyzer` | `bootstrapState()` | `bootstrapState()`（変わらない） |
| `enableMustache`・`sameValueGuard`・`enableDirectionalInitialSync` | `bootstrapState()` | ルートの状態ごとの `$behavior` |
| `debug`・`commentTextPrefix`・`enablePropagationContext` | `bootstrapState()` | 削除 |

```js
// 3.x
bootstrapState({ locale: "ja-JP", enableMustache: false, sameValueGuard: false });
```

```js
// 4.0
bootstrapState({ locale: "ja-JP" });
```

```js
// 4.0 — オプションを要するルートの状態ごとに
export default {
  $behavior: { enableMustache: false, sameValueGuard: false },
  count: 0,
};
```

`$behavior`:

- キーは boolean の 3 つで、既定はどれも `true`。意味は 3.x のオプションと同じです。知らないキー、boolean でない値、オブジェクトでない `$behavior` は `#44` で throw します。`null` と配列もここに入り、この 2 つは 3.5 が警告しません。
- 効く範囲は状態の木ごとで、それを宣言した `<wcs-state>` の木全体（ボリュームを含む）です。3.x のオプションはページ全体に効きましたが、4.0 では**ルートの状態ごと**に、要るものがそれぞれ宣言します — ページのルート、shadow root の中のルートの `<wcs-state>`、マウントしたコンポーネント、DCC。ホストからは何も引き継ぎません。ボリュームには書けません（§3.5）。
- 再セット（初期化済みの要素への `setInitialState()`）で変えることはできず、`#45` で throw します。`$behavior` を書かない状態での再セットは既定値と比べるので、再セットする状態にも同じ宣言を書いてください。
- `/auto` のページでも、JSON の状態でも書けます。3.x の `/auto` には、これらのオプションを渡す方法がありませんでした。
- SSR ではサーバも同じ状態を読むので、サーバとクライアントで食い違いません。

削除されるオプション:

- `debug`: 代わりはありません。
- `commentTextPrefix`: コメントバインディングのキーワードを変えるものでした。`<!--@@: path-->` か `<!--@@wcs-text: path-->` で書いてください。
- `enablePropagationContext`: 4.0 には因果伝播のコンテキストが無いので、切るものがありません。

#### 知らないオプションは throw する（全パッケージ）

`bootstrapState()` は、持っていないオプション（移った・削除されたものを含む）、既定値と型の違う値（`null`、オブジェクトの位置の配列）、`tagNames` の中の定義していない名前、文字列でないタグ名で throw します。すべてを確かめてから当てるので、throw したときは何も当たりません。`undefined` の値は飛ばします（`bootstrapState({ locale: maybeLocale })`）。

```
[@wcstack/state] bootstrapState: "enableMustache" is not one of its options, or not of the option's type. 4.0 moved it to the state's $behavior.
```

ほかのパッケージの `bootstrapXxx()`（`bootstrapRouter`・`bootstrapFetch`・`bootstrapAutoloader`・`bootstrapStorage` ほか）も同じ規則です。3.x はこうしたオプションを黙って無視し、3.5 は警告します（§1.2）。

```
[@wcstack/fetch] bootstrapFetch: "tagName" is not one of its options, or not of the option's type.
```

autoloader の `scanImportmap` オプションは削除されます。3.x は受け取るだけでどこからも読んでおらず（autoloader はどちらでも import map を読んでいました）、今は渡すと throw するので、消してください。

`/auto` の入口だけを読み込むページは影響を受けません。オプションなしで `bootstrapXxx()` を呼ぶためです。

探し方: 3.5 の警告（§1.2）を見るか、スクリプトの中の `bootstrap` の呼び出しを検索します。`<wcs-state>` の外にあるので、lint は検査しません。

#### 既定のロケール

既定の `locale` は、モジュールを評価した時点で `<html lang>` を読みます。3.x は `bootstrapState()` を呼んだ時点で読んでいました。`<html lang>` をマークアップに書くか、`bootstrapState()` に `locale` を渡してください。

### 3.3 イベント: 委譲と `#direct`

3.x では、`on*:` のバインディングはどれも自分の要素にリスナーを付けていました。4.0 では、`click`・`dblclick`・`input`・`change`・`submit`・`keydown`・`keyup`・`mousedown`・`mouseup`・`pointerdown`・`pointerup` の `on*:` は**委譲**されます。イベントの種類ごとに 1 つのリスナーを、状態がバインドするルートに置き、イベントが通った要素のハンドラを内側から順に呼びます。そのルートは document か shadow root で、Light DOM のマウントしたコンポーネントの中ではホストの要素です。ほかの種類のイベントと、カスタム要素が `bubbles: false` で dispatch したイベントは、これまでどおり要素の上で受けます。双方向バインディング（`value:`・`checked:`・radio・checkbox）のリスナーも要素に付いたままです。

| | 3.x | 4.0（委譲） |
|---|---|---|
| ハンドラの中の `event.currentTarget` | 要素 | ルート（document、shadow root、Light DOM のコンポーネントのホスト） |
| 内側の `on*:` の `#stop` | 外側の `on*:` のハンドラを止める | 同じ |
| ページ側のコードがリスナーを付けた要素（祖先への `addEventListener`。クリックできるカードなど）の中の `#stop` | そのリスナーを止める | 止めない。イベントがルートに届く前に、そのリスナーは走り終えている |
| ページ側のコードが祖先で `stopPropagation()` を呼ぶ（オーバーレイへのクリックを止めるモーダルの中身など） | 内側の `on*:` のハンドラは呼ばれる | 内側のハンドラは一度も呼ばれない |
| 要素を別のルートへ移す（shadow root の中のダイアログを `document.body` へ移すなど） | ハンドラは呼ばれる | ハンドラは呼ばれない |

直し方:

- `event.currentTarget` の代わりに、`event.target` から要素を探すか（`event.target.closest("li")` など）、ハンドラが受け取るループのインデックス（`removeItem(event, index)`）を使います。
- 3.x と同じ動きが要るハンドラには `#direct` を付けます。

```html
<!-- ページ側のコードが click のリスナーを付けたカードの中のボタン -->
<button data-wcs="onclick#direct,stop: save">保存</button>
```

`on*#direct:` は、3.x と同じく要素そのものにリスナーを付けます。`currentTarget` は要素で、`#stop` はページ側のコードが祖先に付けたリスナーを止め、祖先の `stopPropagation()` があっても呼ばれ、要素を別のルートへ移しても呼ばれます。`#prevent`・`#stop` と組み合わせられます。`for:` / `if:` の中では行ごとに付き、行と一緒に外れます。

ハンドラは DOM が決める位置で走ります。委譲されたハンドラはルートで走るので、外側の `#direct` のハンドラは、その中の委譲されたハンドラより先に走ります。そのため、内側の `#stop` で外側の `#direct` のハンドラを止めるには、内側のバインディングにも `#direct` が要ります（`onclick#direct,stop:`）。

`#direct` は 3.x のうちに付けておけます（§1.7）。

探し方: 3.5 の lint は、`event.currentTarget` を読む、バブリングするイベントのハンドラを報告します（`wcs/v4-migration`）。ページ側のコードがリスナーを付けた要素の中の `#stop`、ページ側のコードの `stopPropagation()`、ルートをまたいで移す要素は見えないので、自分で探してください。4.0 の lint は、イベント以外のバインディングに `#direct` を付けると警告します（`wcs/template-syntax`）。

### 3.4 描画とバインディングの規則

#### リストの要素への書き込みは、その位置の値を置き換える

3.x では、要素への書き込みで値を入れ替えると（`$resolve("items.*", [0], b)`、`this["items.0"] = …`）、入れ替えが揃った時点で、描画した行が値と一緒に動きました。4.0 では、要素への書き込みはその位置の値を置き換えます。行は `$1` とともにその場に残り、バインディングが持たない DOM の状態（フォーカス、バインドしていない入力欄に打った文字、`<details>` の開閉）も位置に残ります。行の下で導いた値はすべて計算し直されます。行を値と一緒に動かすには、新しい配列を代入します。行は、新しい配列の要素と同一性で対応付けられます。

```js
// 3.x: 2 つの書き込みが揃うと、2 つの行が入れ替わる
const a = this.$resolve("items.*", [0]);
const b = this.$resolve("items.*", [1]);
this.$resolve("items.*", [0], b);
this.$resolve("items.*", [1], a);

// 4.0: 新しい配列を代入する。行はオブジェクトと一緒に動く
const items = this.items.slice();
[items[0], items[1]] = [items[1], items[0]];
this.items = items;
```

探し方: リストを並べ替えるのに使っている `$resolve(path, indexes, value)` と、添字のパスへの書き込みを探します。lint には区別できません。

#### 行と枝の要素から `data-wcs` が外れる

4.0 は、`for:` の行と `if:` の枝のために複製した要素から `data-wcs` 属性を外します。3.x は、パスを展開した形で残していました。そうした要素を選ぶ CSS やテストのセレクタ（`[data-wcs*="items"]` など）は一致しなくなるので、クラスや自前の `data-*` 属性に替えてください。`for:` / `if:` のテンプレートの外の要素は変わりません。

#### `for:` / `if:` のテンプレートの中の `outerHTML:` / `outerText:`

行と枝はノードを位置で持つので、要素そのものを置き換えるバインディングはその中で使えません。4.0 は初期化を `[wcs/template-syntax] #203` で失敗させます。3.x は 1 回だけ当てていました。代わりに、包む要素に `innerHTML:` を付けてください。テンプレートの外（ページの直下）では、`outerHTML:` / `outerText:` はこれまでどおり使えます。

```html
<!-- 3.x -->
<template data-wcs="for: posts">
  <div data-wcs="outerHTML: .html"></div>
</template>

<!-- 4.0 -->
<template data-wcs="for: posts">
  <div data-wcs="innerHTML: .html"></div>
</template>
```

3.5 の lint は警告し、4.0 の lint は `wcs/template-syntax`（error）で報告します。

#### `for:` のフィルタ

`for:` は出力フィルタを受け付けません。`for: items|take(2)` は、どのフィルタでも（登録されていない名前でも）初期化を `[wcs/binding-syntax] #121` で失敗させます。3.x は、フィルタを通した配列の行を描いていました。`for: items` の行は `items.<添字>` なので、フィルタを通した配列の行は別の要素を指してしまい、行を通した書き込みが違う要素に着地します。フィルタを通したリストを返す getter を宣言し、それを回してください。

```html
<!-- 3.x -->
<template data-wcs="for: items|take(2)">…</template>

<!-- 4.0。get firstTwo() { return this.items.slice(0, 2); } を宣言して -->
<template data-wcs="for: firstTwo">…</template>
```

この getter は写しを返すので、§5 の制限が当たります。元のパスからの書き込み（`this["items.1.n"] = 7`）は写しの行に届きません。行を通して書いてください（`firstTwo.1.n`、または行の中のバインディング）。

探し方: `for:` のバインディングの `|` を探します。3.5 の lint は報告せず、4.0 の lint は `wcs/binding-syntax`（error）で報告します。

#### 行の中の、別のリストの `*`

`for:` の行の中のバインディングで、ある段の `*` が、その段を囲む `for:` とは別のリストの行を指すもの（`for: a` の中の `{{ b.*.y }}`）は、ページの初期化で `[wcs/wildcard-rank] #1403` で throw します。3.x は、そのバインディングごとに `ListIndex not found` で失敗させていました。別のリストの行は、getter の中で `$resolve(path, indexes)` を使って読んでください。3.5 の lint は警告し、4.0 の lint は `wcs/wildcard-rank`（warning）で報告します。

#### マークアップの誤りで初期化が止まる *（未確定）*

今のプレビューでは、読めないバインディング（構文の誤り、知らないフィルタ、wildcard-rank の誤り）があると、バインドはそこで止まります。ページの直下なら `<wcs-state>` の初期化が失敗し（`connectedCallbackPromise` が reject）、誤りより後ろのバインディングは付きません。`for:` / `if:` の行の中でバインディングを付けるときに見つかった誤り（宣言の無いトークンや wcBindable のメンバーなど）は、そのバインディングの失敗として `$errorCallback` に届き、行は組み上がります。同じ誤りでも、ページの直下では初期化が失敗します。3.x は、ページの直下の誤りを報告して、そのバインディングだけを失敗させていました。この挙動は見直し中です。デプロイの前に 4.0 の lint を流してください。初期化の失敗は、3.5 と同じく `console.error` に 1 回、まず要素と状態の読み込み元（`<wcs-state src="./state.js"> failed to initialize.`）、続けてエラーの順に出ます。バインディングを組み上げた後に `$connectedCallback` が throw・reject するのは、初期化の失敗ではありません: `<wcs-state …> $connectedCallback failed.` に続けてエラーが出て、`connectedCallbackPromise` はそのエラーで reject し、ページは組み上がっているので `getBindingsReady()` は resolve します。

#### コメントバインディング

`<!--@@: expr-->` と `<!--@@wcs-text: expr-->` は、3.x と同じくバインドされます。`{{ expr }}` と同じテキストのバインディングで（フィルタも使えます）、ページの直下でもテンプレートの中でも働きます。コメントは同じ位置のテキストノードに置き換わります（3.x と同じ DOM）。`$behavior.enableMustache: false` でもバインドします。3.x との違い:

- `<textarea>` と `<title>` の中のコメントはバインドしません（ブラウザはその中身を文字として読みます）。
- 式は複数行にまたがってもかまいません（3.x は 1 行だけでした）。
- キーワードは空か `wcs-text` です。キーワードを変える `commentTextPrefix` オプションはなくなりました。
- 3.x は内部のアンカーのコメント（`<!--@@wcs-for: x-->`・`<!--@@wcs-if: x-->` など）もテキストのバインディングとして描いていましたが、4.0 はそのまま残します。

#### 中身をバインドする要素、`<noscript>`、`<iframe>`

- 中身をバインドする要素（`textContent:`・`text:`・`innerText:`・`innerHTML:`・`html:`）の子は、ページの直下でもテンプレートの中でもバインドしません。中の `{{ }}`・`data-wcs`・構造のテンプレートは文字どおりに残ります。`#init=element` や `#init=none` で、書いた子がそのまま残るときも同じです。バインドが要るマークアップは別の要素に分けてください。
- `<noscript>` と `<iframe>` の子はバインドしません（3.x が飛ばしていたのは `<script>` と `<style>` だけでした）。要素自身の `data-wcs`（`srcdoc:`・`attr.src:`）はバインドします。
- ページの直下で `outerHTML:` / `outerText:` をバインドした要素の子はバインドしません。

#### ページの直下の順序

ページの直下では、要素の子を先にバインドしてから、要素自身のバインディングを付けます。そのため、カスタム要素への最初のプロパティの書き込みの順と、`$errorCallback` に失敗が届く順は、3.x と逆になります（子が先）。テンプレートの中は、これまでどおり文書の順です。

#### 小さな違い

- 状態に無いトップレベルのキーに書き込むと、そのキーが作られます（3.x は書き込みが失敗しました）。読むのはこれまでどおり `[wcs/binding-path-missing]` で throw します。
- 再設定（初期化済みの要素への `setInitialState()`）の新しい状態に、古い状態にあったトップレベルのキーが無いと、そのキーが書き込まれるまで、そこへのバインディングは空になり、その下のリストは行を描かず、それを読む getter は `undefined` を得ます。新しい状態に無い深いパスは、もともとこうでした。3.x はそのバインディングとリストを失敗として報告し、古いテキストと行をページに残しました。新しい状態のオブジェクトには書き込みません（凍結した状態でも再設定できます）。例外はクラスの状態のプロトタイプにある getter で、新しい状態にそれが無いと、3.x と同じくそこへのバインディングは失敗します。
- `__proto__` か `prototype` を通るパスは `[wcs/binding-syntax] #120` で throw します。バインディング、書き込み、`$resolve`、`$setAll`、`this.__proto__` のような読みが対象です。
- `state="id"` は、その id の `<script type="application/json">` だけを読みます。
- 数値の添字を持つ `$watch` のキー（`"items.0.v"`）は、その添字の値が変わったときだけ発火します。3.x（3.4 以降）は、添字を通した書き込み、要素の差し替え、リストのどの行への書き込みでも発火し、値が変わっていないこともありました。
- `$watch` のハンドラと `$stream` の再開の連鎖が上限を超えると（3.x と同じく、深さ 32 を超えた書き込み）、その書き込みが起こしたハンドラと再開だけを飛ばし、同じバッチのほかのハンドラは動きます。3.x はバッチごと飛ばしていました。再開の書き込みは描画の連鎖（100 回の drain）にも数えます。microtask ごとに続く要素の書き戻しが stream を再開させると、50 回ほどで打ち切られます（stream が無ければ 100 回）。
- `$stream` の source が実行の開始（再開）と同じタスクの中で（同期に、または microtask で）出した値は、それが起こす再開の連鎖に数えます。値が別の stream の `args` に届くと、その stream は 1 段深く再開します。そのため、すぐに値を出す source で互いの値を読む 2 本の stream は、ページを固めずに打ち切られます。後のタスクで届いた値と、値が起こす `$watch` のハンドラは、数え直しです。
- リストの代入や並べ替えで残った行の、行 getter の `$watch`（`items.*.label`）は、値が変わったときだけ発火します。ただし、同じバッチの書き込みが、その getter が行の外で読んだもの — `now`、`items.length`、それらを読むルートの getter（`get count() { return this.items.length }`）— を変えたとき、または別の行の同じパス（`items.0.due`）に書いたときは発火します。3.5.1 は、getter を DOM に束ねていれば、残った行を値の変化に関わらずすべて発火させ、getter が同じオブジェクトを返すときだけ発火させませんでした。
- 複数の外側の行が同じ配列を持つとき、その要素への書き込みは、`$watch("groups.*.items.*")` を、配列を持つ外側の行ごとに 1 回ずつ、それぞれの添字で発火させます。その配列を持つどのパスでも値が変わったためです。3.x は、書いた位置で 1 回だけ発火させていました。
- リストの末尾より先の添字: 書き込み（`this["items.5.v"] = 1`、`$resolve("items.*.v", [5], 1)`）は `no row for "items.*.v"` で throw して何も変えず、読みは `undefined` を返します。3.x は、どちらも `ListIndex not found` で throw していました。

### 3.5 ボリュームとマウントしたコンポーネント

#### ボリューム（`<wcs-state mount="p">`）

| ボリュームの中の | 3.x | 4.0 |
|---|---|---|
| `$watch`・`$listKeys`・`$renderedCallback` | `p` からの相対で実行 | 拒否: ボリュームは接ぎ木されず、`console.error` |
| `$stream`・`$scan`・`$recursion` | 拒否 | 拒否 |
| `$behavior`・`$features` | — | 拒否 |
| `$commandTokens`・`$eventTokens`・`$on`・`$errorCallback` | 実行しない、警告 | 実行しない、`console.warn` |
| ボリュームの要素への注入（`data-wcs="state.taxRate: settings.taxRate"`、3.1） | 使える | 拒否: ボリュームは接ぎ木されず、`console.error` |
| ボリュームのメソッド | 木に出ない | パスで呼べる（`onclick: p.method`・`this["p.method"]`） |

メッセージは `[@wcstack/state] <wcs-state mount="p">` に続けて、`$watch is not run in a volume — declare it on the root state.`、`injections (data-wcs="state.<key>: …") are not supported — read the root path in a root getter.` と出ます。拒否されたボリュームも、`connectedCallbackPromise` は resolve します。

宣言は、パスを全部書いた形でルートの状態に移します。ルートのハンドラの中の `this` はルートの状態なので、パスはルートから書きます（`this["cart.items"]`）。

```js
// 3.x: "cart" にマウントした cart.js
export default {
  items: [],
  get total() { /* … */ },
  $watch: { total(cur) { /* … */ } },
};
```

```js
// 4.0: cart.js はデータと getter をそのまま持ち、watch はルートの状態が持つ
export default {
  $watch: { "cart.total"(cur) { /* … */ } },
};
```

ボリュームの `$renderedCallback` は、マウントパスからの相対のパスを受け取っていました。ルートの `$renderedCallback(paths, indexes)` は、木全体のパスをルートから書いた形（`cart.items.*.name`）で受け取るので、接頭辞で絞り込んでください: `paths.filter((p) => p.startsWith("cart."))`。

注入は、両方のパスを読む getter をルートの状態に置いて置き換えます。

```html
<!-- 3.x -->
<wcs-state mount="cart" src="./cart.js" data-wcs="state.taxRate: settings.taxRate"></wcs-state>
<!-- cart.js: get totalWithTax() { return this.subtotal * (1 + this.taxRate); } -->
```

```html
<!-- 4.0 -->
<wcs-state mount="cart" src="./cart.js"></wcs-state>
<!-- ルートの状態: get cartTotalWithTax() { return this["cart.subtotal"] * (1 + this["settings.taxRate"]); } -->
```

ホストに配線したコンポーネント（ホストに `data-wcs="state…"`）の shadow root の中の `<wcs-state mount>` は、`will not graft: its component is wired to its host.` で拒否され、`connectedCallbackPromise` は resolve します。3.x は pending のままでした。配線したコンポーネントはホストの木を読むので、そのデータはホストの状態に置いてください。

4.0 の lint は、これらの宣言を `wcs/volume-declaration` で、ボリュームの `$behavior` / `$features` を `wcs/behavior-invalid` / `wcs/features-invalid` で、なくなった名前を §3.1 のとおりに報告します。lint は `src=` で読み込むボリュームの状態を読めないので、そのマウントパスの下を指すルートの `$watch` のキーやバインディング（`cart.total`）には、動くにもかかわらず `wcs/watch-path-missing` / `wcs/binding-path-missing` の警告が出ます。そこでは出るものと考えてください。`--strict` では CI の失敗になります。

#### マウントしたコンポーネント（`state: …` を持つ `bind-component`）

| マウントしたコンポーネントの中の | 3.x | 4.0 |
|---|---|---|
| `$listKeys` | 実行しない、警告 | コンポーネント自身のリストに効く |
| `$commandTokens`・`$eventTokens`・`$on` | 実行しない、警告 | 実行する（コンポーネント自身のバインディングで） |
| `$errorCallback` | 実行しない、警告 | コンポーネント自身のバインディングの失敗を受け取る |
| `$recursion` | 実行しない、警告 | `[wcs/mount-dollar-declaration] <tag>: $recursion is not run in a mounted component — declare it on the root state.` で throw |
| `$watch`・`$stream`・`$renderedCallback` | 実行しない、警告 | 実行しない、`[wcs/mount-dollar-declaration]` の警告（変わらない） |
| ホストの行の要素への書き込み（`this["users.1"] = obj`） | コンポーネントの私有データを作り直す | コンポーネントの要素は残り、私有のキーもそのまま（§3.4 の「リストの要素への書き込み」を参照） |
| `<wcs-state bind-component>` を新しいものに差し替える | スコープをもう一度初期化する（残したノードのバインディングを張り直し、足したノードも束ねる） | 古い要素が束ねた・描いたノードが残っていれば、新しい要素がスコープを引き継ぐ。それらのバインディング・行・`{{ }}` の text はそのまま。その横に足したバインディングのあるノード（`data-wcs`・`{{ }}`）は束ねず、`console.warn` で知らせる。残っていなければ（中身ごと描き直した。残したノードのうち `<style>` や空白のようなバインディングの無いものは数えない）、新しい要素が中身を束ね直す |

マウントに失敗したコンポーネントの `<wcs-state bind-component>` は、`connectedCallbackPromise` をそのエラーで reject します。3.x の README が設定の誤りについて約束していたとおりです。4.0 は、3.x が reject しなかった 2 つの場合にも reject します: 初期化に失敗した根に配線したコンポーネント（`<tag>.state will not mount: the root state failed to initialize.`。3.x はその `connectedCallbackPromise` を決着させず、ページと一緒に接続したものも後から接続したものも、それを待つ側は止まったままでした）と、1 つのコンポーネントで 2 つ目に接続した `<wcs-state bind-component>`（`<tag> already has a connected <wcs-state bind-component="state">.`。3.x は resolve していました）です。`@wcstack/server` の `renderToString()` と `@wcstack/testing` の `mount()` は、Light DOM のコンポーネントのものも含めてすべての `connectedCallbackPromise` を待つので、これらの場合にも reject します。コンポーネントの `$connectedCallback` が失敗しても、コンポーネントを描いた後で reject します（`… $connectedCallback failed.`、§3.4）。

### 3.6 SSR

- **`@wcstack/server` 4.0 と 4.0 のクライアントは一緒にデプロイしてください。** 4.0 のクライアントは、`@wcstack/state` 3.x で描画する 3.x の `@wcstack/server` の出力（ほかの major.minor の出力も）をハイドレートできません。警告を出し（`<wcs-ssr version="3.5.0"> does not match 4.0.0: its snapshot is discarded, and the page renders on the client from its own state.`）、サーバが無いときと同じくクライアントで描きます: サーバのスナップショットは使わず、状態は自分の読み込み元（`json=`・`src=`・内側のスクリプト・`setInitialState()`）から読み、`$connectedCallback` はクライアントで走り、サーバの行・枝・印は、描画の元になったテンプレートに戻ります。ページから配線した Light DOM のコンポーネント（`data-wcs="state: user"`、`state.label: user.name`）では、3.x はパスをページのパスで書いていました（`user.name`）。これはホストの配線を通して元に戻します（3.5.3 からは、テキストのバインディングの印はコンポーネント自身の式を持つので、そのまま読みます）。ページは動きますが、サーバがした仕事はクライアントでもう一度行われます（`$connectedCallback` が取得するデータも取得し直します）。
- 3.5.2 までの 3.x のサーバの出力から戻らないものが 1 つあります: テンプレートの外のテキストのバインディング（ページの直下や Light DOM のコンポーネントの中身の `{{ }}`・`<!--@@: -->`）はフィルタを失います。その印はパスしか持たないためです（`{{ price|toFixed(2) }}` は整形しない値を出します）。そうした出力では、警告もそう言います。`for:` / `if:` のテンプレートの中の式はそのまま残ります。3.5.3 から（wcstack#373）印はフィルタを含むバインディングの式全体を持ち、警告もその文を言いません: 切り替える前に 3.x のサーバ（`@wcstack/server` と `@wcstack/state`）を 3.5.3 以降（下の場合を考えれば 3.5.4 以降）に上げれば、フィルタは失われません（4.0 のクライアントは 2 つの形式を `<wcs-ssr version>` で見分けます。プレリリースはそれより前と数えます）。残るのは 1 つです: HTML のコメントに入らない式（`|defaults('--')` のように `--` を含むもの）は、パスだけを印に書くので、そのバインディングもフィルタを失います。3.5.4 から（wcstack#427）失うのはそれだけです: Light DOM のコンポーネントでも、そのパスはコンポーネント自身のパスなので、値はフィルタ抜きで表示されます。3.5.3 のサーバの出力だけは、さらに制限があります。3.5.3 はそこにページのパスを書くためです: コンポーネントの私有のキーは元に戻しますが、配線したキーはコンポーネント自身のパスとして読みます: コンポーネントに同じ名前のキーがあれば、そのキーの値を表示し（配線で名前を変えていない `state.price: price` のような形でだけ正しい値）、無ければ 3.5.4 か 4.0 のサーバが描画するまでテキストは空のままです。3.x のサーバが描画するあいだは、そうした式に `--` を書かないでください。切り替えるときは、上げる前にキャッシュしたページなど、3.x で描画した HTML を消してください。
- 逆の組み合わせ（4.0 のサーバと 3.x のクライアント）は扱いません。3.x のクライアントは全体を描き直すと警告しますが（`SSR version mismatch: server="4.0.0", client="3.5.0". Falling back to full render.`）、4.0 の印を読みません。状態の変化に追従するのは、テンプレートの外の `data-wcs` 属性のバインディングだけで、テキストのバインディング・行・枝はサーバの HTML のままです。
- `@wcstack/state` 4.0 を古い `@wcstack/server` の下で描画すると（npm の override など）、出力に `<wcs-ssr>` がまったく無いことがあり、そのときページは警告なしにサーバの HTML のまま固まります。4.0 と一緒にリリースされる `@wcstack/server` を使ってください。
- `@wcstack/server` の API（`renderToString()`）は変わりません。出力の形は変わるので、3.x の印を前提に出力を加工しないでください。
- 出力のコメントを消さないでください。テキストのバインディングと、行・枝の印はコメントです。後段の HTML の圧縮（html-minifier の `removeComments` など）で消すと、ハイドレーションが崩れ、値の中の `{{ }}` がクライアントでバインディングとして読まれることがあります。
- 3.x と同じく、フォームの値はマークアップと違うものをサーバの HTML に書きます。input の `value` 属性と `checked` 属性、select で選ばれている option の `selected`、textarea のテキストです。違いは 3 つで、パスワードの値は書かず、select の `value:` はその option に印を付け（3.x は `<select>` に `value` 属性を書いていました）、値に `{{` を含む textarea はクライアントに任せます。
- `outerHTML:` / `outerText:` はサーバでは当てず、クライアントで当てます。サーバの出力には要素が書いたとおりに載るので、その値は検索エンジンや JavaScript の無い表示には出ません。
- ページの直下でバインドした Light DOM のカスタム要素が値から描いた子は、サーバの出力に入りません（クライアントが描きます）。書いた子は残ります。
- 3.x（3.4.0 以降）と同じく、ハイドレーションはサーバの行・枝をその場で引き取ります: その中のカスタム要素はページを読み込んだときに一度だけ接続され、切断・再接続されることはありません。`<tbody>` を書かない `<table>` の `<tr>` の行は、ブラウザのパーサが補う `<tbody>` の中に残ります。テンプレートと形が合わなくなったサーバの行（束縛するノードの前に子を足す Light DOM の要素）は、その場で描き直します（前後の行はそのままです）。描き直した行は、束縛を当てる前にページに入ります（引き取った行と同じで、行を束縛してから挿入するクライアントだけの描画とは違います）。そのため、その中のカスタム要素は、束縛の値が届く前に接続されます。クライアントが描かない行・枝（行が少ない、別の枝）は、ページを束縛し終えたところで外します。
- 3.x と同じく、スナップショットは JSON です。`Date`・`Set`・`Map`・クラスのインスタンスはそのままでは残りません。SSR する状態には JSON の値を置き、ほかは getter で組み立ててください（`get created() { return new Date(this.createdIso); }`）。

### 3.7 公開 API（JavaScript / TypeScript）

| 3.x | 4.0 |
|---|---|
| `IStateElement.listPaths`・`getterPaths`・`setterPaths`・`nextVersion()` | 削除。代わりは無い |
| `Ssr`（`<wcs-ssr>`）の `hydrateProps` | 常に空（4.0 はサーバの DOM を引き取るときに、すべてのバインディングを当てる） |
| `Ssr` の内部の静的メソッド（`extractStateData`・`buildContent` …） | 削除。`ISsrElement` が宣言するものは残る |
| `IWritableConfig` / `getConfig()` | §3.2 の 6 つのオプションが無い |
| `$errorCallback(error, info)` | `for:` が描いていないリストでは `info.node` が `null`（型は `Node \| null`） |
| `@wcstack/state/parser` の結果 | `uuid` が無い。パスの `__proto__` / `prototype` の段を #120 で拒む |
| `@wcstack/state/manifest` | 旧名の表は空（`builtinFilterAliases` は `{}`）。`$scan` は予約名から外れた。`$behavior`・`$features` を予約。`behaviorOptions`・`features` を追加 |
| `defineState` の型 | `$trackDependency` / `$untrackDependency` が無い |
| `installFeatures()` | 入れ済みの機能は飛ばす（3.x は毎回 `install()` を呼んでいた。どちらも冪等） |
| `@wcstack/state` | 型 `IStateElement` も export する |

### 3.8 分割エントリと機能

- **`$listKeys` は core の外**の新しい機能 `@wcstack/state/features/list-keys` に移りました。`@wcstack/state` と `/auto` は含みます。`$listKeys` を使う `/core` のページは、これを入れる必要があります。入れないと、状態が `[wcs/feature-not-installed] $listKeys needs the add-on @wcstack/state/features/list-keys` で失敗します。
- `features/temporal` が受け持つのは `$watch` と `$stream` です（`$scan` はなくなりました）。
- `features/diagnostics` を入れない `/core` では、メッセージが番号になります（§2）。開発中は `diagnostics` を入れてください。
- 3.x と同じく、`installFeatures([...])` は `bootstrapState()` の前に呼びます。機能を入れる前に、その機能のキーを宣言した状態が定義されると、`[wcs/feature-not-installed]` で失敗します。
- `dist/split/chunks/` の下のファイル名に、中身のハッシュが付くようになりました。チャンクのファイルを自分で並べている場合（preload のリンク、import map の `integrity`）は、4.0 のビルドから名前を取り直してください。
- パッケージにソースマップ（`.map`）は入りません（3.5.4 は各バンドルの隣にありました）。スタックトレースは最小化したバンドルを指します。エンジンの中を追うときは、リポジトリのソース（`packages/state/src`）を使ってください。

4.0 で増えたもの（使わなくてもかまいません）:

- **分割 auto のエントリ** `dist/split/auto.js` は、import map なしの 1 つの script タグで分割のビルドを読み込みます。版を固定した素の `/npm/` のパスから読み、`esm.run` は通さないでください。`exports` には載っていないので、バンドラでは `@wcstack/state/core` と `installFeatures` を使い続けます。

  ```html
  <script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state@4.0.0/dist/split/auto.js"></script>
  <wcs-state features="scopes diagnostics">…</wcs-state>
  ```

- **`features="…"`** は、文書のルートの `<wcs-state>`（`mount` も `bind-component` も持たない最初のもの）に書き、`<wcs-state>` を定義する前に 1 回だけ読まれます。どの `<wcs-state>` が始まる前にも要る `scopes` と、開発用の機能（`diagnostics`・`devtools`）を書く場所です。読むのは分割 auto のエントリだけです。
- **`$features: ["temporal", "formats"]`** は、その状態が要る機能を状態の中に書くものです。分割 auto のエントリは、足りない機能を状態を組み立てる前に読み込みます。ほかのエントリは、入っているかを確かめるだけです。配列でなければ `#46` で throw します。
- 名前は `formats`・`diagnostics`・`temporal`・`list-keys`・`scopes`・`recursion`・`ssr`・`devtools` です。`features=` にほかの名前があると、分割 auto のエントリは `<wcs-state>` を定義する前に `[wcs/feature-unknown]` で失敗します。`$features` にあると、分割 auto のエントリでは `[wcs/feature-unknown]`、ほかのエントリでは `[wcs/feature-not-installed]` で、その状態が失敗します。

### 3.9 ほかのパッケージ

- **`@wcstack/router` 3.5 以降**（3.5 に上げた時点で入ります）
  - 表示中のルートの内容の終わりに、コメント `<!--@@wcs-route-end:/path-->`（SSR の終了マーカーと同じ文字）が入ります。outlet の子ノードが 1 つ増えます。`:empty` には影響しません。
  - ルートを出るときは、ルートの始まりからこの印までをまとめて取り出し、入るときに戻します。`@wcstack/state` がそこに描いた行・枝や、自分のコードが差し込んだノードも一緒に出入りします。3.4.0 までの router は元のノードだけを出し入れし、ほかは outlet に残っていました。戻るのは取り出したものだけなので、自分のコードがルートの本文から取り除いた直下のノードは、次に入っても戻りません。表示中のルートをもう一度表示するとき（パラメータの変化）は、内容を取り出して同じ順で戻すので、中のカスタム要素は 1 回だけつながり直し、新しいパラメータを読みます。入れ子のルートでも同じです（3.4.0 までの router は元のノードを 1 つずつ入れ直して並びを崩し、要素で包んだ入れ子のルートでは 2 回つながり直して、1 回目は古いパラメータを読んでいました）。
  - `<wcs-route>` の直下に置いた `for:` / `if:` のテンプレートは、`@wcstack/state` 4.0 と組み合わせると、ナビゲーションで入ったときにも描かれます。3.4.0 までの router、`<wcs-head>` の中、ほかのコードが差し込んだ内容では、4.0 は描かずに `[wcs/template-syntax] #204` をコンソールに出します。3.x はこの形を一度も描きませんでした。要素で包めば、どの組み合わせでも描かれます。
  - `<wcs-layout>` の中のルートの内容と、レイアウトのテンプレート自身のバインディングも、最初にナビゲーションで入ったときからバインドされます（3.4.0 までの router では、ナビゲーションで入るとバインドされず、中の `for:` はその後に入り直しても描かれませんでした）。
  - 変わらない制限: ルートの本文やレイアウトのテンプレートの直下に、要素で包まずに書いたテキストの `{{ }}` は、ナビゲーションで入ったときにはバインドされません。要素で包んでください。
- **`@wcstack/server`**: §3.6。
- **`@wcstack/autoloader` と I/O ノードのパッケージ**: `bootstrapXxx()` のオプションの規則と `scanImportmap`（§3.2）。
- **`wcstack/auto`** は `@wcstack/state`・router・fetch・storage・autoloader を同梱しているので、ここまでの変更がすべて及びます。
- **`@wcstack/devtools`**: そのまま動きます（フックのプロトコル v2）。1 回の更新が 32 回のパスで落ち着かないときも `state:render-chain-limit` を送ります（`maxDepth: 32`）。
- **binder プロトコル**: `bind(subtree, options?)` に省略できる第 2 引数が加わります。内容を差し込み、後でひとまとまりとして出し入れするコード（3.5 以降の router）は `{ range: true }` を渡し、そのときだけ差し込んだ内容の先頭の `for:` / `if:` のテンプレートが描かれます。binder を自分で呼ぶ場合だけ関係します。
- **[wcstack-app skill](https://github.com/wcstack/wcstack-skill)** は、別に 4.0 に合わせて更新します。

## 4. 影響する箇所を探す

上げる前は、3.5 のコンソールの警告と 3.5 の lint（§1.2・§1.3）で、§1 の書き方のほとんどが見つかります。上げた後は、4.0 の lint と下の実行時のメッセージを使います。

### 4.1 4.0 の lint

4.0 の公開後に `npx @wcstack/lint@4 <files>` を流します（VS Code 拡張も同じコードを出します）。`--strict` を付けると warning でも CI が失敗します。下の warning のうち 2 つは実行時に throw するので、付けると役に立ちます。`--strict` では、`src=` で読み込むボリュームのパスへの誤った警告（§3.5）も失敗になる点に注意してください。

| コード | 報告するもの | 重大度 |
|---|---|---|
| `wcs/filter-unknown` | 3.2 のフィルタの旧名と `substr`。書き換え先を示す | warning（実行時は throw） |
| `wcs/name-alias` | `$trackDependency`・`$untrackDependency` | error |
| `wcs/declaration-alias` | `$streams`・`$updatedCallback` | error |
| `wcs/scan-declaration-invalid` | `$scan` | error |
| `wcs/behavior-invalid` | `$behavior`: 知らないキー、boolean でない値、オブジェクトでない（`null` と配列を含む）、ボリュームでの宣言 | error |
| `wcs/feature-unknown` | `$features` や `features=` の知らない名前 | error |
| `wcs/features-invalid` | 配列でない `$features`、ボリュームの `$features`（error）。文書のルートでない `<wcs-state>` の `features=`（warning） | error / warning |
| `wcs/volume-declaration` | ボリュームの `$stream`・`$watch`・`$listKeys`・`$renderedCallback`（error）、`$commandTokens`・`$eventTokens`・`$on`・`$errorCallback`（warning） | error / warning |
| `wcs/template-syntax` | `for:` / `if:` の中の `outerHTML:` / `outerText:`（error）。イベント以外のバインディングの `#direct`（warning） | error / warning |
| `wcs/wildcard-rank` | 行の中の別のリストの `*`（#1403）。どの `for` の外にもあるパターンのパス・省略パス・ループのインデックス | warning（実行時は throw） |
| `wcs/binding-syntax` | パスの `__proto__` / `prototype` の段、`for:` のフィルタ | error |
| `wcs/index-param-range` | `for` の中の `$129` 以上。スクリプトの `this.$0`・`this.$129` | error |
| `wcs/second-root` | 文書の 2 つ目のルートの `<wcs-state>`（3.x の実行時も拒否していたもの） | error |
| `wcs/bind-component-source` | `state` / `src` / `json` やインラインのスクリプトを持つ `<wcs-state bind-component>`（3.x の実行時も拒否していたもの） | error |

lint に見えないもの: `bootstrapXxx()` のオプション、委譲されたハンドラのまわりの `#stop` と `stopPropagation()`、移した要素、行を並べ替えるための要素への書き込み、`[data-wcs]` のセレクタ、SSR の出力の後処理、削除された `IStateElement` のメンバーの使用。

### 4.2 実行時のメッセージ

文は `@wcstack/state` と `/auto` が出すものです。diagnostics 機能が無いと、代わりにコード・番号・値が出ます。

| メッセージ | 番号 | § |
|---|---|---|
| `$scan was removed (use $watch or $on)` | #1 | 3.1 |
| `[wcs/declaration-alias] $streams was removed: write $stream.` | #1601 | 3.1 |
| `[wcs/name-alias] $trackDependency was removed: write $dependOn.` | #1701 | 3.1 |
| `[wcs/filter-unknown] filter not found: <name>.`（旧名では、続けて `"<name>" was renamed "<new name>" in 3.2 and removed in 4.0 — write "<new name>".`） | #501 | 3.1 |
| `bootstrapState: "<key>" is not one of its options, or not of the option's type.`（状態の `$behavior` では `$behavior:` や `state:` で始まる） | #44 | 3.2 |
| `a re-set state may not change $behavior: create the element again.` | #45 | 3.2 |
| `[@wcstack/<package>] bootstrapXxx: "<key>" is not one of its options, or not of the option's type.` | — | 3.2 |
| `[wcs/template-syntax] "outerHTML:" replaces its element, so it cannot be used inside a "for" / "if" template …` | #203 | 3.4 |
| `[wcs/binding-syntax] "for: items\|take(2)": "for:" takes no filters …` | #121 | 3.4 |
| `[wcs/wildcard-rank] "b.*.y" ranges over the rows of "b", but the enclosing "for" template at that level renders "a".` | #1403 | 3.4 |
| `[wcs/binding-syntax] "<path>": a state path cannot go through "__proto__" or "prototype" …` | #120 | 3.4 |
| `<wcs-state src="./state.js"> failed to initialize.`（`console.error`。続けてエラー。`state=`・`src=`・`mount=`・`bind-component=` があれば示す） | #49 | 3.4 |
| `<wcs-state> $connectedCallback failed.`（`console.error`。続けてエラー。バインディングを組み上げた後） | #50 | 3.4 |
| `<wcs-state mount="p">`: `$watch is not run in a volume — declare it on the root state.`（`console.error`） | — | 3.5 |
| `<wcs-state mount="p">`: `injections (data-wcs="state.<key>: …") are not supported — read the root path in a root getter.`（`console.error`） | — | 3.5 |
| `<wcs-state mount="p"> will not graft: its component is wired to its host.`（`console.error`） | — | 3.5 |
| `[wcs/mount-dollar-declaration] <tag>: $recursion is not run in a mounted component — declare it on the root state.` | — | 3.5 |
| `<wcs-ssr version="3.x.y"> does not match 4.0.0: its snapshot is discarded, and the page renders on the client from its own state.`（`console.warn`。3.5.2 までの 3.x の出力では、続けて `3.x output keeps only the path of a text binding outside a template, so such a binding loses its filters: deploy @wcstack/server 4.0 with this client.`） | — | 3.6 |
| `[wcs/feature-not-installed] <key> needs the add-on @wcstack/state/features/<name>` | — | 3.8 |
| `$features must be an array of add-on names (["temporal", "formats"]).` | #46 | 3.8 |
| `[wcs/feature-unknown] "<name>" is not an add-on (…).` | — | 3.8 |
| `[wcs/template-syntax] a "for:" template at the top of inserted content was not rendered, …` | #204 | 3.9 |

## 5. プレビューの既知の制限 *（未確定）*

- **1 つのオブジェクトが 2 つの行から届く。** 同じオブジェクトを 1 つのリストの 2 つの位置に置くと、片方の行の下への書き込み（`this["items.0.name"] = "z"`）は、もう片方の行のバインディングと行 getter に届きません。素の読み、ルートの getter、`$getAll` は新しい値を返します。1 つのオブジェクトが 2 つのリストから届く場合も同じです。TodoMVC 風の絞り込み（`todos` を絞り込んだ写しを返す `get shown()` を `for: shown` で描き、checkbox が行に書き込む形）が当たります。getter が `todos` そのものを返すのに戻ると、引き継いだ行は描き直されます。3.x にも同じ問題があります（#365）。4.0 の既知の制限として記録されており、範囲は見直し中です。
- **プレーンなオブジェクトの下の数値のキー**（`sales.2024.total`・`usersById.42.name`）。マークアップでは描かれますが、4.0 ではスクリプトの読み（`this["sales.2024.total"]`、getter の中も）が `undefined` になり、そのパスへの `$eq` は常に偽になり、書き込みは `no row for "sales.*.total"` で throw し、双方向の書き戻しも失敗します。3.x（3.4 以降）は、これまでどおり素のキーとして読み、`$resolve` / `$setAll` では素のキーとして書きます。決まるまでは、読みは `this.sales[2024].total` と書き、書き込みはトップレベルのキーに新しいオブジェクトを代入するか（`this.sales = { ...this.sales, 2024: { ...this.sales[2024], total: 10 } }`）、数値でないキーを使ってください。
- **再セットの後**、`Object.keys(this)`・`in`・`delete`・`JSON.stringify(this)` は古い状態を見ます。
- **マークアップの誤りと初期化**: §3.4 を参照。
