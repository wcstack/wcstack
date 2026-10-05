# @wcstack/state

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

> **この README は 4.0 を説明しています。** 3.x から移行する場合は、[3.x からのアップグレード](#3x-からのアップグレード) と [3.x → 4.0 移行ガイド](https://github.com/wcstack/wcstack/blob/main/docs/migration-v4.ja.md) を読んでください。

**これは便利な既存FWの別実装ではありません。パスがビューとモデルの契約になる——フロントエンドの外で確立した系譜を、Web標準の上に持ち込む試みです。**

多くのライブラリは、UI・状態・コンポーネントの結合点を JavaScript の中に置きます。`@wcstack/state` はそこを選びません。仮想DOMも、コンパイルも、hook も、selector も前提にせず、HTML とパス文字列だけを契約として UI と状態を結びつけます。

それが `<wcs-state>` と `data-wcs` のアプローチです。CDNからの読み込みだけで動作し、依存パッケージはゼロ、構文はHTMLそのままです。CDNのスクリプトはカスタム要素の定義を登録するだけで、ロード時にはそれ以外の処理は走りません。`<wcs-state>` 要素がDOMに接続されたときにはじめて、状態ソースを読み取り、同一ルートノード（`document` または `ShadowRoot`）内の `data-wcs` バインディングを走査してリアクティビティを構築します。初期化プロセスはすべて要素のライフサイクルによって駆動されるため、独自の初期化コードを書く必要はありません。

## ここには存在しないもの

以下は未実装ではありません。**設計上、存在しません。**

- 変数を取り出す API
- 要素ごとに状態を束縛するオブジェクト
- hook（`useState` / `useStore` 系。`$connectedCallback` などのライフサイクルコールバックはこれに当たりません）
- selector
- reactive primitive をコンポーネントへ引き込むための glue code

これらはどれも、設計上存在しません。

なぜなら、このライブラリでは UI と状態の結合点を JavaScript の中に置かないからです。状態を「取り出して」コンポーネントへ渡すのではなく、HTML 側がパス文字列によって状態を参照します。要素は状態を所有せず、状態も要素を知りません。両者が共有するのはパスだけです。

## 位置づけ — 選ぶとき・選ばないとき

これは React / Vue / Solid の別構文ではありません。あちらは UI と状態の結合点をコンポーネントの中に置き、こちらはパス文字列に置きます。**前提自体が違う**ので、比較は正しい軸で行ったときにだけ意味を持ちます。

| コンポーネント型 FW が前提にするもの | `@wcstack/state` が前提にするもの |
|---|---|
| コンポーネントが UI と状態の結合点 | パス文字列が UI と状態の結合点 |
| JavaScript が描画の中心 | HTML と DOM が中心 |
| state を取り出して component へ流し込む | path を宣言して DOM を状態へ接続する |
| hook / selector / signal で購読する | 属性とパスで束縛する |
| フレームワークの実行モデルにアプリ全体を載せる | ブラウザ標準の上に reactive layer を足す。ページはページのまま |

より近い親戚は **属性ディレクティブ型・ビルド不要のライブラリ** — Alpine.js や petite-vue の系統です。前提（素の HTML への属性・コンパイラ不要）は共有しつつ、選択を分ける違いが 2 つあります。

- **式言語を持たない。** それらは属性に JavaScript 式を書き、実行時に評価します。`data-wcs` に載るのはパスとフィルタチェーンだけで、計算は state 側のパス getter に置きます。バインディングを静的に検査できる（`@wcstack/lint`・VS Code 拡張・`@wcstack/typescript`）のも、`unsafe-eval` なしの厳格な CSP で動く（[docs/csp.ja.md](../../docs/csp.ja.md)）のも、この選択の帰結です。
- **Web Components 同士を配線する。** wc-bindable・command-token・event-token の各プロトコルと `bind-component` マウントが、互いを import しない要素同士を接続します。[I/O ノード群](../../README.ja.md#追加パッケージ)はその上に成り立っています。

**選ぶとき**: HTML が主役のページ — サーバー描画や静的なマークアップにリアクティブな部分を足す、カスタム要素を組み合わせてページを作る、「HTML を読めばデータ依存が全部わかる」ことに価値があり、ビルド工程が前提ではなくコストであるとき。

**選ばないとき**: チームが既にコンポーネント型 FW の中で暮らしている — I/O ノードは[フレームワークアダプタ](../../docs/framework-adapter-integration.ja.md)経由で使ってください。ホットパスが巨大な keyed リストで、生成・追加の時間が決め手になる — 計測したうえで（[パフォーマンス](#パフォーマンス)）、このパッケージと相互運用できる [`@wcstack/signals`](../signals/) を検討してください。テンプレートに式を書きたい — 意図的に存在しません。テンプレートの型検査をツールではなくコンパイラに求める — パスは文字列で、`@wcstack/typescript` は差を縮めますが埋めはしません。

この軸に乗せれば比較は具体的になります。下の[パフォーマンス](#パフォーマンス)節がその一例で、`e2e/bench/` のドライバで手元のハードウェアでも再現できます。

### JavaScript の外にある系譜

「*パス文字列だけがビューとモデルの契約である*」という前提は、フレームワークの時代より古く、その大半は JavaScript の外で作られました。JavaScript の内側での直系は、Knockout の `data-bind="text: user.name"`（バインディングを属性に載せる。ただし式を評価し、`ko.observable` のラップが要る）と、Polymer のパス体系（ドットパス、`items.*` オブザーバ、`this.set("users.0.name", v)`）です。後者が `set()` / `notifyPath()` を必須にしたのは、当時のプラットフォームでは素の代入を観測できなかったからでした。新規性を主張するより、先行系譜を名指しするほうが有益です。

| 系譜 | すでに持っていたもの | ここで異なる点 |
|---|---|---|
| **表計算**（VisiCalc, 1979） | アドレス、セルが**何であるか**を宣言する数式、依存グラフ、遅延再計算 — 更新コードはどこにもない | 格子座標ではなく名前を使い、数式をセル単位ではなく*形*単位で書く。`get "cart.items.*.subtotal"()` は各行へフィルダウンされるのではなく、ワイルドカードそのものが定義 |
| **Cocoa Bindings / KVC–KVO**（NeXT の EOF, 1994／Mac OS X 10.3, 2003） | キーパス（`person.address.street`）、「対象 + キーパス + value transformer」の三つ組、パスに沿って集計するコレクション演算子（`@sum.items.price`） | その三つ組が nib や `bind:toObject:withKeyPath:` の呼び出しではなくマークアップにあるので、grep・lint・diff できる。変更検知は KVC 準拠ではなく素のオブジェクトへの ES Proxy |
| **XForms**（W3C 勧告, 2003） | model / instance / view の分離、instance を指す `ref` パス、そして `<bind calculate="…">` — **パスの位置に**宣言される算出値であり、パス getter の直系の祖先 | パスはアドレスに徹し、計算は属性内の XPath ではなく state 上の JavaScript getter。XForms プロセッサなしで素のブラウザで動く |
| **WPF / XAML**（2006） | `{Binding Path=User.Name, Mode=TwoWay}`、部分木ごと基点を張り替える `DataContext`、ソースへの書き戻し時点を選ぶ `UpdateSourceTrigger`、両端を変換する `IValueConverter` | ビジュアルツリーを継承するコンテキストと `RelativeSource` / `ElementName` の脱出口ではなく、ルートごとに 1 本の state ツリー。`state: user` がその基点張り替えで、しかもホストの HTML に書かれる。変換器は登録するクラスではなく 47 個の閉じたフィルタで、コンパイルも不要 |
| **Android Data Binding**（2015） | レイアウトファイル自体に書くパス — `android:text="@{user.name}"`、双方向は `@={}` | ビルド手順も生成されるバインディングクラスもなく、属性の中に式を書かない |
| **SCADA / HMI のタグバインド**（産業用・数十年） | 設定だけでウィジェットのプロパティをタグパス（`Line1/Tank/Level`）へ配線する。パスを媒介変数化する*間接*バインド（`Folder/Tag_{1}`）で 1 画面が多数の機器を駆動する | ツリーが持つのはスカラーのフラットな名前空間ではなく、派生値・リスト・マウントされたコンポーネント。媒介変数はドロップダウンから与えるものではなく、バインディングが置かれた行が解決するループのワイルドカード |

ワイルドカードは MQTT のトピックフィルタ（`sensor/+/temperature`）や OSC のアドレスパターン（`/synth/*/freq`）にも似ていますが、あちらが選ぶのは**流れているメッセージ**です。`items.*.price` が名指すのは state のアドレスで、同じ 1 本の文字列が購読先であり書き込み先でもあります。

この比較を経て本当に新しいと言えるのは狭い範囲です。**ワイルドカードパス getter** — *キー*がパスパターンである getter なので、定義 1 本が全行に効き、依存エッジはセル単位ではなくパターン単位で保持されます。それ以外は、上の系譜を、いずれもが前提にできなかった 3 つのもの（Custom Elements・ES Proxy・Import Maps）の上へ組み直したものです。

## 第一原理: パスが唯一の契約

既存の多くのフレームワークでは、**コンポーネント**がUIと状態の結合点になっています。状態ストアを外部に切り出しても、コンポーネント内にフックやセレクタ、リアクティブプリミティブといった**状態を引き込むためのコード**が必ず必要になります。つまり、UIと状態は常にJavaScriptの中で結びついているのです。

`@wcstack/state` はこの結合を完全に排除しました。UIと状態を結びつけているのは**パス文字列**だけです — `user.name` や `cart.items.*.subtotal` のようなドット区切りのアドレスのみが、2つのレイヤー間の唯一の契約（コントラクト）になります:

| レイヤー | 知っていること | 知らないこと |
|----------|----------------|--------------|
| **状態** (`<wcs-state>`) | データ構造とビジネスロジック | どのDOM要素がバインドされているか |
| **UI** (`data-wcs`) | パス文字列と表示意図 | 状態がどう保存・算出されているか |
| **コンポーネント** (`state: path`) | ホストが書くマウント表 | 誰がマウントしたのか、ツリーの他の部分に何があるのか |

3つのレベルのパス契約が疎結合を実現しています:

1. **UI ↔ 状態** — `data-wcs="textContent: user.name"` という属性がバインディングのすべてです。フックもセレクタもリアクティブプリミティブもありません。コンポーネント側のコードがリアクティブプリミティブを import することも、購読を登録することもありません。`bind-component` するクラスは素の `state` オブジェクトを自分で宣言し、素のオブジェクトとして読み書きします。存在しないのは、状態をコンポーネントへ引き込む glue コードのほうです。

2. **コンポーネント ↔ コンポーネント** — ホストが各コンポーネントへ部分木をマウントし（`<my-card data-wcs="state: user">`）、ボリュームが追加モジュールをツリーに接ぎ木します（`<wcs-state mount="i18n">`）。コンポーネント同士がお互いを import することはなく、丸ごとマウントは単一ツリー上のパス接頭辞そのものです。これより踏み込む宣言形式が 2 つあり、それぞれ定義箇所に明記しています。[個別対応付け](#ホスト側の使用方法)（`state.message: user.name`）はホストがコンポーネント自身のキー名を書くことになり、[公開 getter](#公開-getterコンポーネントの-getter-を外から読む) はコンポーネントが計算した値をホストが読むので、そのバインディングはそこにコンポーネントがマウントされていることに依存します。

3. **ループコンテキスト** — `for` ループ内では `*` が抽象インデックスとして機能します。`items.*.price` のようなバインディングは自動的に現在の要素へと解決されます。テンプレートは自身の具体的な位置（インデックス）を知る必要がなく、ワイルドカードがその契約となります。

### なぜこれが重要なのか

これはUIと状態の分離を、**JavaScriptのコードを介することなく**実現していることを意味します。つまり:

- UIを作り直しても、状態のロジックに触れる必要がありません — ただしロジックが描画内容にぶら下がっていない範囲で。live binding は 3 つある[評価のきっかけ](#評価のきっかけdemand-root)の 1 つなので、表示専用のつもりの要素がページ唯一の購読になりえます。
- 状態のデータ構造をリファクタリングしても、パス文字列の更新だけで済みます。
- HTMLを読めば、すべてのバインディングを把握できます。HTMLに現れない依存（`$watch`・`$stream`）は、すべて state という 1 箇所に宣言されています。

このパスによる契約は、REST APIのURLと同じ発想です — 両者が合意するシンプルな文字列だけが存在し、そこに共有するコードはありません。これはJavaScriptの上に独自のテンプレート言語を発明するのではなく、HTML本来の宣言的な性質をフルに活かした結果として生まれた設計です。

以下の機能はすべて、この原理の帰結です。機能が先にあり、その説明として哲学を後付けしているのではありません。

## わずか4ステップで動作

```html
<!-- 1. CDN を読み込む -->
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<!-- 2. <wcs-state> タグを書く -->
<wcs-state>
  <!-- 3. 状態オブジェクトを定義する -->
  <script type="module">
    export default {
      message: "Hello, World!"
    };
  </script>
</wcs-state>

<!-- 4. data-wcs 属性でバインドする -->
<div data-wcs="textContent: message"></div>
```

これだけです。ビルドツールも、初期化コードも、重いフレームワークも必要ありません。

## この原理から導かれる機能

各行はこの README の 1 節に対応します。[周辺パッケージの役割](#周辺パッケージの役割)に挙げたもの以外は、すべてこのパッケージ単体の機能です。

| 領域 | 一行で言うと | 参照 |
|---|---|---|
| **パスモデル** | ドットパスが state を指す。`*` は抽象添字、`**` は深さ、`$1` / `$2` は軸の名前 | [第一原理](#第一原理-パスが唯一の契約) · [ループインデックス変数](#ループインデックス変数1-2-) |
| **バインディング構文** | 1 つの `data-wcs` 属性にプロパティ / テキスト / class / style / 属性 / イベントを載せる。テキストでは `{{ }}` と `<!--@@: path-->`、`<svg>` の内側でも同じ | [バインディング構文](#バインディング構文) · [Mustache](#mustache-構文) · [SVG](#svg-サポート) |
| **イベント** | よく使うバブリングイベントの `on*:` ハンドラはルートへ委譲される。`#direct` を付けたものは要素自身に付く | [イベントハンドリング](#イベントハンドリング) |
| **構造ディレクティブ** | `<template>` 上の `for` と `if` / `elseif` / `else` | [構造ディレクティブ](#構造ディレクティブ) |
| **行の同一性** | 行は参照で差分を取るので、並べ替えや絞り込みで DOM を再利用する。`$listKeys` は再取得した配列でも行 DOM と行オブジェクトを保つ | [`$listKeys`](#listkeys--再取得された行の同一性) |
| **フォーム** | `input` / `select` / `textarea` の双方向バインディング、ラジオグループと単一値、チェックボックスグループと配列、`#ro` / `#onchange` / `#prevent` / `#stop` | [双方向バインディング](#双方向バインディング) · [修飾子](#修飾子) |
| **フィルタ** | 47 種類の組み込み、チェーン可能、`<html lang>` を見るロケール依存フォーマット | [フィルタ](#フィルタ) · [ロケール](#ロケール) |
| **派生状態** | パス getter がデータツリーの任意の深さの仮想プロパティを 1 箇所にフラットに宣言する。チェーンでき、setter も書ける | [パス getter](#パス-getter算出プロパティ) |
| **集計と一括書き込み** | `$getAll` / `$setAll` / `$resolve` が `items.*.price` を横断して読み書きする。配列は作り直さない | [Proxy API](#proxy-api) |
| **再帰パス** | `$recursion` が木の形の繰り返し地点を宣言し、1 本の `**` getter が全深さを覆う | [再帰パス](#再帰パスrecursion) |
| **リアクティビティ** | ES Proxy がアドレス単位で読み取りを追跡・キャッシュし、依存順に無効化し、DOM 書き込みをマイクロタスクでまとめる | [状態の更新](#状態の更新) · [依存追跡の境界](#依存追跡の境界) |
| **getter が動く条件** | getter は遅延評価。評価需要は live binding・`$watch`・`$stream` の `args` の 3 箇所からしか生まれない | [評価のきっかけ](#評価のきっかけdemand-root) |
| **モジュール化** | `mount=` がモジュールを 1 本のツリーに接ぎ木し、`state: path` が部分木をコンポーネントにマウントする。個別対応付けは単一キーを繋ぎ、マウントされたコンポーネントの getter はマウント点で公開される | [ボリューム](#追加の状態をマウントするmount) · [丸ごとマウント](#丸ごとマウントstate-path) |
| **コンポーネント** | 排他的な 2 方式 — JavaScript クラス＋`bind-component` か、HTML だけの DCC か | [機構の選び方](#コンポーネント機構の選び方) |
| **他要素との配線** | wc-bindable プロトコル、spread（`...: obj`）、`#init=` / `#sync=` の authority、プロパティ→属性ミラー | [バインディング authority](#バインディング-authority-init--sync) · [Spread](#spread-バインディング-) · [Inputs](#inputs-と属性ミラー) |
| **トークン** | command token が state から要素のメソッドを呼び、event token が要素のイベントを state へ戻す | [Command token](#command-tokenメソッドバインディング) · [Event token](#event-tokenイベントバインディング) |
| **時間** | `$stream` が非同期ソースを fold し、`$watch` が headless に反応する | [時間を扱う機構の選び方](#時間を扱う機構の選び方) |
| **初期化とライフサイクル** | state の供給は 6 通り。`$connectedCallback` 〜 `$stateReadyCallback`、`bootstrapState()` / `createState()` | [状態の初期化](#状態の初期化) · [ライフサイクルフック](#ライフサイクルフック) · [API リファレンス](#api-リファレンス) |
| **設定** | `bootstrapState()` はそのページでのマークアップの綴りを決め、各 state は自分の振る舞い（`$behavior`）と必要なアドオン（`$features`）を自分で宣言する | [設定](#設定) |
| **診断** | 解決しないパス・添字の本数・階数・getter の循環を、lint と同じ診断 code とメッセージ番号付きで報告する。失敗はそのバインディング 1 本に閉じ、値も DOM も巻き戻さない | [診断と失敗の扱い](#診断と失敗の扱い) |
| **セキュリティ** | 値はサニタイズせず、マークアップとしても読まない。自分で書いていないマークアップをページ走査に届かせてはならない | [セキュリティ](#セキュリティ) |
| **配布** | ランタイム依存ゼロ、ビルド不要、ESM、CDN の `/auto` 1 タグ、またはページが使うアドオンだけを入れる分割エントリ。`unsafe-eval` 不要で Trusted Types 対応 | [インストール](#インストール) · [docs/csp.ja.md](../../docs/csp.ja.md) |

### 周辺パッケージの役割

`@wcstack/state` はリアクティブコアだけを担います。ツール・I/O・ルーティングは別パッケージで、分担はいつも同じ形です —— このパッケージが接続点と契約を用意し、周辺パッケージが機構を持ち込みます。

| パッケージ | 加わるもの | このパッケージ側にあるもの |
|---|---|---|
| [`@wcstack/server`](../server/) | サーバー側での描画と、クライアントに届いた markup のハイドレーション | `enable-ssr` 属性とハイドレーション契約 — [SSR](#サーバーサイドレンダリング) |
| [`@wcstack/lint`](../lint/) | `npx @wcstack/lint <file>` が HTML 中の `data-wcs` を実行前に検査する | 診断 code と `getWcsManifest()`（どちらもこの実装から導出）— [診断](#診断と失敗の扱い) |
| VS Code 拡張（`wcstack-intellisense`） | 同じ診断と補完をエディタ内で | 同じ manifest と診断 code |
| [`@wcstack/typescript`](../typescript/) | `wcs-schema` が型を HTML 検証器へ運び、`wcs-tsc` がインライン state スクリプトを型検査する | `defineState()`、`WcsPaths<T>` / `WcsPathValue<T, P>` — [TypeScript サポート](#typescript-サポート) |
| [`@wcstack/devtools`](../devtools/) | state・配線・更新履歴を見るブラウザパネル | パネルが読む計装（Hook Protocol v2。全部入りのエントリに含まれる `devtools` アドオン） |
| [`@wcstack/testing`](../testing/) | `mount()` / `settle()` / `fire()` を 1 import で | 追加パッケージなしで書ける素のレシピ — [ページをテストする](#ページをテストする) |
| [`@wcstack/view-transition`](../view-transition/) | リストの移動・削除や分岐の入れ替えを View Transition API でアニメーションさせる | transition-runner の受け渡し。ページに arbiter がなければ変更はそのまま適用される — [遷移アニメーション](#遷移アニメーション) |
| [`@wcstack/router`](../router/) · [`@wcstack/autoloader`](../autoloader/) | 宣言的ルーティング、未定義カスタム要素の自動読み込み | ルートが書き込めるパス、ルートの中身が挿入されたときにそれをバインドするバインダ（[挿入された内容の中の構造テンプレート](#挿入された内容の中の構造テンプレート)）、遅延定義を待つバインディング |
| [I/O ノード群](../../README.ja.md#追加パッケージ) — `fetch`, `storage`, `ws`, `midi`, … | プラットフォーム API を要素として | それらを繋ぐ wc-bindable 配線・spread・トークンプロトコル — [Spread](#spread-バインディング-) |
| [`@wcstack/signals`](../signals/) | もう 1 つのリアクティブコア。JavaScript で書く signals と、非同期 IO のリソースアダプタ | 相互運用 —— どちらも wc-bindable を話すので I/O ノードと DCC は共有できる — [パフォーマンス](#パフォーマンス) |

## インストール

### CDN（推奨）

```html
<!-- 自動初期化 — これだけで動作します -->
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

### CDN（手動初期化）

```html
<script type="module">
  import { bootstrapState } from 'https://esm.run/@wcstack/state';
  bootstrapState();
</script>
```

### 分割エントリ（使う機能だけを入れる）

`@wcstack/state` と `/auto` は全機能入りで、こちらが引き続き推奨です（全部使うページなら、core ＋
機能に分けるより 1 ファイルのほうが小さい）。機能を意図的に落とすページは、組み合わせて入れられます。

```html
<script type="importmap">
{
  "imports": {
    "@wcstack/state/core": "https://cdn.jsdelivr.net/npm/@wcstack/state@4.0.0-rc.2/dist/split/core.js",
    "@wcstack/state/features/temporal": "https://cdn.jsdelivr.net/npm/@wcstack/state@4.0.0-rc.2/dist/split/features/temporal.js",
    "@wcstack/state/features/scopes": "https://cdn.jsdelivr.net/npm/@wcstack/state@4.0.0-rc.2/dist/split/features/scopes.js"
  }
}
</script>
<script type="module">
  import { bootstrapState, installFeatures } from '@wcstack/state/core';
  import temporal from '@wcstack/state/features/temporal';  // $watch / $stream
  import scopes from '@wcstack/state/features/scopes';      // bind-component・mount=・DCC

  installFeatures([temporal, scopes]);
  bootstrapState();
</script>
```

**アドオンは、どの state が定義されるよりも前に入れてください** — 上の例のとおり、`installFeatures([...])`
を `bootstrapState()` の前に呼びます。アドオンのキー（`$watch`・`$listKeys` …）を宣言した state は、
そのアドオンが入っていなければ `[wcs/feature-not-installed]` で失敗し、アドオンを入れる前に作られた
エンジンが後からそのアドオンを得ることもありません。`bootstrapState()` の後に入れたアドオンも、自分の
タグ（`<wcs-ssr>`）はすでに bootstrap 済みのレジストリへ定義しますが、最初の `<wcs-state>` が動き出す
前にすべてのアドオンが揃っているのは、宣言どおりの順で呼んだときだけです。

分割の形は、パッケージのファイルそのものから読みます — 上の例のように jsDelivr の素の `/npm/` パスで
版を固定するか（素のパスは `exports` を読まないので、`dist/split/` 以下のファイル名を書く）、バンドラを
通します。**`esm.run` からは読まないでください**。`+esm` はエントリごとにサーバー側で再バンドルし、
共有の core チャンクをそれぞれに取り込むため、エントリごとに別のエンジンを抱えます。機能は core から
見えないコピーへ install され、`installFeatures` を呼んでも `[wcs/feature-not-installed]` で落ちます。
素のファイルなら、どのエントリの相対 import も同じチャンクの URL に解決され、エンジンは 1 回だけ評価
されます。この形の integrity は [docs/sri.ja.md §5.1](../../docs/sri.ja.md#51-wcstackstate-の分割エントリ) を参照。
`dist/split/chunks/` 以下のファイル名にはコンテンツハッシュが入ります。チャンクのファイルを自分で列挙する
場合（preload リンク、import map の `integrity`）は、読み込むビルドからファイル名を取ってください。

| エントリ | 足されるもの |
|---|---|
| `@wcstack/state/core` | バインディングの本体: `data-wcs`・`{{ }}` とコメントバインディング・`for` / `if`・パス getter・イベント・`$command` / `$on`・24 個のロジックフィルタ（比較・算術・型変換・デフォルト）・`bootstrapState`・`installFeatures` |
| `@wcstack/state/features/temporal` | `$watch`・`$stream` |
| `@wcstack/state/features/list-keys` | `$listKeys` |
| `@wcstack/state/features/scopes` | `bind-component`・`mount=` のボリューム・オーバーレイの公開 getter・DCC（`data-wc-definition`） |
| `@wcstack/state/features/recursion` | `$recursion` と `**` パス |
| `@wcstack/state/features/ssr` | `enable-ssr`: サーバー描画とハイドレーション |
| `@wcstack/state/features/formats` | 23 個の書式フィルタ（`upper`・`date`・`round`・`truncate` …） |
| `@wcstack/state/features/devtools` | DevTools Hook Protocol への source 登録 |
| `@wcstack/state/features/diagnostics` | エラーメッセージの文章（did-you-mean と lint への案内を含む）と、開発時の警告（束縛や `$watch` のパスが解決しない、`wcs/default-getter-mismatch`）。入れなければ、メッセージは code・番号・値だけになり（[エラーメッセージ](#エラーメッセージと番号)）、これらの警告は出ない |
| `@wcstack/state/define` | `defineState` と型だけ — ランタイムは 0 |

アドオンが入っていない宣言は黙って無視されません。state の読み込み時に
`[wcs/feature-not-installed] $watch needs the add-on @wcstack/state/features/temporal` を throw し
（`mount=`・`bind-component`・`data-wc-definition` は同じ形で `scopes` を、`enable-ssr` は `ssr` を
名指します）、`formats` なしの書式フィルタは束縛計画の段で、アドオン名を挙げた `[wcs/filter-unknown]`
を throw します。install は冪等で — 2 回目の install は読み飛ばされます — どのエントリも core の
チャンクを 1 つだけ共有します。アドオンがエンジンの 2 つ目のコピーを抱えることも、**別のアドオン**の
コピーを抱えることもありません（アドオンをまたぐ呼び出しは、持ち主のアドオンが install 時に埋める
受け口を通ります）。

#### 分割版の auto エントリ

`dist/split/auto.js` は、import map なしで、script タグ 1 つから分割ビルドを読み込みます。core と、
ページが名指したアドオンを、同じビルドから読み込みます。

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state@4.0.0-rc.2/dist/split/auto.js"></script>
<wcs-state features="scopes diagnostics">
  <script type="module">
    export default {
      $features: ["temporal", "formats"],
      price: 1200,
      $watch: { price(cur) { console.log(cur); } },
    };
  </script>
</wcs-state>
<p>{{ price|locale }}</p>
```

アドオンは 2 箇所で、それぞれ別の理由から名指します:

| | ルートの `<wcs-state>` の `features="…"` | state の中の `$features: [...]` |
|---|---|---|
| どこに書くか | 文書のルートの `<wcs-state>` — `mount` も `bind-component` も持たない最初の 1 つ | ボリューム以外の任意の state（ルート、マウントされたコンポーネント、DCC） |
| いつ読まれるか | 1 回だけ、`<wcs-state>` が定義される前 | その state が読み込まれるとき、エンジンが作られる前 |
| 何のためか | どの `<wcs-state>` が動き出すよりも前に揃っているべきもの — `mount=` / `bind-component` / DCC の要素が何であるかを決める `scopes` — と、ページの開発補助（`diagnostics`・`devtools`） | その state が必要とするアドオン（`$watch` のための `temporal`、フィルタのための `formats`） |
| 誰が読むか | 分割版の auto エントリだけ | すべてのエントリ: 分割版の auto エントリは足りないアドオンを読み込み、それ以外のエントリは入っているかを確かめ、入っていなければその state を `[wcs/feature-not-installed]` で失敗させる |

名前は `formats`・`diagnostics`・`temporal`・`list-keys`・`scopes`・`recursion`・`ssr`・`devtools` です。
`features=` にそれ以外の名前があると、分割版の auto エントリは `<wcs-state>` を定義する前に
`[wcs/feature-unknown]` で失敗します。`$features` にあれば、その state が失敗します（分割版の auto
エントリでは `[wcs/feature-unknown]`、それ以外では `[wcs/feature-not-installed]`）。配列でない
`$features` は `#46` を throw し、ボリュームは `$features` を宣言できません。

`dist/split/auto.js` も、上と同じ理由で、版を固定した素の `/npm/` パスから読み、`esm.run` は通さない
でください。`exports` には入っていません: 実行時に組み立てる URL をバンドラは追えないので、バンドルする
ページは `@wcstack/state/core` を import して `installFeatures` を呼びます。実行時に import するアドオンは
その `<script>` の `integrity` の外にあり、CSP の下では CDN のホストを許可しておく必要があります。

## 基本的な使い方

```html
<wcs-state>
  <script type="module">
    export default {
      count: 0,
      user: { id: 1, name: "Alice" },
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" }
      ],
      countUp() { this.count += 1; },
      clearCount() { this.count = 0; },
      get "users.*.displayName"() {
        return this["users.*.name"] + " (ID: " + this["users.*.id"] + ")";
      }
    };
  </script>
</wcs-state>

<!-- テキストバインディング -->
<div data-wcs="textContent: count"></div>
{{ count }}

<!-- 双方向入力バインディング -->
<input type="text" data-wcs="value: user.name">

<!-- イベントバインディング -->
<button data-wcs="onclick: countUp">Increment</button>

<!-- 条件付きクラス -->
<div data-wcs="textContent: count; class.over: count|gt(10)"></div>

<!-- ループ -->
<template data-wcs="for: users">
  <div>
    <span data-wcs="textContent: .id"></span>:
    <span data-wcs="textContent: .displayName"></span>
  </div>
</template>

<!-- 条件分岐レンダリング -->
<template data-wcs="if: count|gt(0)">
  <p>カウントは正の値です。</p>
</template>
<template data-wcs="elseif: count|lt(0)">
  <p>カウントは負の値です。</p>
</template>
<template data-wcs="else:">
  <p>カウントはゼロです。</p>
</template>
```

## 状態の初期化

`<wcs-state>` は複数の方法で初期状態を読み込めます：

```html
<!-- 1. <script type="application/json"> を id で参照 -->
<script type="application/json" id="state">
  { "count": 0 }
</script>
<wcs-state state="state"></wcs-state>

<!-- 2. インライン JSON 属性 -->
<wcs-state json='{ "count": 0 }'></wcs-state>

<!-- 3. 外部 JSON ファイル -->
<wcs-state src="./data.json"></wcs-state>

<!-- 4. 外部 JS モジュール (export default { ... }) -->
<wcs-state src="./state.js"></wcs-state>

<!-- 5. インラインスクリプトモジュール -->
<wcs-state>
  <script type="module">
    export default { count: 0 };
  </script>
</wcs-state>

<!-- 6. プログラム API -->
<script>
  const el = document.createElement('wcs-state');
  el.setInitialState({ count: 0 });
  document.body.appendChild(el);
</script>
```

解決順序: `state` → `src` (.json / .js) → `json` → 内包 `<script>` → `setInitialState()` 待機。

状態の読み込み中にルートから外されたルートの `<wcs-state>`（ページの中身が入れ替わった、要素が移された）は、そこには何もマウントせず、次に接続された場所で（すでに接続されていればすぐに）始め直します。`setInitialState()` で渡された状態はそのために保持しますが、`state` / `src` / `json` / 内包スクリプトのソースは読み直します —— fetch はもう一度走り、内包モジュールはトップレベルのコードも含めてもう一度評価されます。

`state="<id>"` が読むのは、その id を持つ `<script type="application/json">` だけです — まず要素自身のルート（shadow root）で、次に document で探し、同じ id を持つ別の要素は対象になりません。読めないソースは、その要素の初期化を失敗させます: そのような script がない（`#16`）、`.json` を取得できない（`#13`、HTTP ステータス付き）、JSON がパースできない、モジュールが throw する（[初期化の失敗](#初期化の失敗)）。空の JSON script は `{}` として扱います。

5 番の `<script type="module">` はブラウザ自身も評価します（`<wcs-state>` の中にあっても止まりません）。export はどこにも届かないので state には影響しませんが、トップレベルのコードは 2 回走ります（ブラウザが 1 回、state が 1 回）。トップレベルに副作用（リクエスト・ログ出力・グローバルへの代入）を置かないでください。CSP 下では下の注記を参照してください。

> **Content-Security-Policy 下では:** 5 番（内包 `<script type="module">`）は `blob:` URL 経由で評価されるため、state を読み込む `<script>` にページの nonce を付けるか（blob: の import がその nonce を引き継ぎます）、`script-src blob:` が必要です。厳格な CSP を敷く場合は 4 番（`src="./state.js"`）を使ってください。追加ディレクティブは不要です。なお 5 番の `<script>` はブラウザ自身も評価します。CSP 下では、その `<script>` にも nonce を付けない限りコンソールに違反が 1 件出ます。nonce を付けた場合や CSP が無い場合は、トップレベルのコードが 2 回走ります（副作用を置かないこと）。詳細は [docs/csp.ja.md](../../docs/csp.ja.md)。

### 追加の状態をマウントする（`mount=`）

状態のツリーは **1 つの root に 1 本**です。状態をモジュールに分けたい場合はボリュームをマウントします。データはマウントパスの位置でルートツリーに接ぎ木され、バインディングは接頭辞付きのパスで読みます。

```html
<wcs-state mount="cart" src="./cart.js"></wcs-state>
<wcs-state src="./app.js"></wcs-state>

<div data-wcs="textContent: cart.total"></div>
```

ボリュームはデータ・getter・setter・メソッドを持ち、`$connectedCallback` / `$disconnectedCallback` を宣言できます。そのどれの中でも `this` はマウントパスを基点にします: `this.items` はツリーの `cart.items` で、パスを取る `$` API（`$getAll`・`$setAll`・`$resolve`・`$postUpdate`・`$dependOn`・`$eq`・`$eqPath`・`$eqIndex`）もマウント相対のパスを取ります。getter と setter はツリーの `cart.<キー>` のアクセサになり、メソッドはパスで呼べます —— `onclick: cart.checkout`、ルートからは `this["cart.checkout"]()`。読み込み順は自由です: ルートより先に接続されたボリュームは、ルートのエンジンが作られるとき、ページがバインドされる前に接ぎ木されます。ルートの `<wcs-state>` がページから外れている間に接続されたボリュームは、それが戻されたときに接ぎ木されます。

ボリュームは、ツリー全体に反応する宣言を実行しません。`$watch`・`$stream`・`$listKeys`・`$renderedCallback`・`$recursion`・`$behavior`・`$features` —— そして削除された `$scan`・`$streams`・`$updatedCallback` —— を宣言したボリュームは拒否されます: 接ぎ木されず、`console.error` が要素を名指して `$watch is not run in a volume — declare it on the root state.` と伝えます。これらはルートの state にフルパスで宣言してください —— ルートのハンドラの中では `this` はルートで（`$watch: { "cart.total"(cur) { … } }`）、ルートの `$renderedCallback(paths)` はルートから書いたパス（`cart.items.*.name`）を受け取るので、接頭辞で絞り込みます。`$commandTokens`・`$eventTokens`・`$on`・`$errorCallback` は、`console.warn` を出して実行されません。ボリュームは注入も受けません: ボリューム要素に `data-wcs`（`state.taxRate: settings.taxRate`）があると、そのボリュームは拒否されます —— ルートのパスはルートの getter で読んでください（`get cartTotalWithTax() { return this["cart.subtotal"] * (1 + this["settings.taxRate"]); }`）。

拒否されたボリュームは、接ぎ木せずに決着し、理由を報告して、`connectedCallbackPromise` を resolve します。state の読み込みに失敗したボリュームも同じです。そのほかの拒否: 別のボリュームがすでに持っているマウントパス（`will not graft: another volume already holds "cart".`）、ルートの state がすでに持っているパス（`will not graft: the root state already has "cart".` —— ただし SSR では、ボリュームはそこにあるサーバーのデータを引き継ぎます）、ホストに配線されたコンポーネントの shadow root の中のボリューム（`will not graft: its component is wired to its host.` —— そのコンポーネントはホストのツリーを読むので、データはホストの state に置いてください）。ルートの `<wcs-state>` が初期化に失敗した場合、それを待っていたボリュームと、後から読み込まれるボリュームは `will not graft: the root state failed to initialize.` を報告し、永久に待たずに決着します。それが終点です: あとから修正版のルートを接続しても復帰しません —— 壊れたルートとボリュームを取り除き、新しい要素を追加してください。ボリュームの `$connectedCallback` が throw した場合は `console.error` で報告され、ボリュームは接ぎ木されたままです。

接ぎ木済みのボリュームは、外してもデータとマウントパスを保ちます: アンマウントはありません。ルートを待っている間にページから外されたボリューム（ページの中身が入れ替わった）は、同じマウントパスを求める新しいボリュームにそれを譲り、接ぎ木せずに settle します。ルートはその下のパスに書き込めますが、ボリュームの接ぎ木先より上にあるオブジェクトを置き換える書き込み（`mount="shop.cart"` のときの `this.shop = …`）は throw し、ルートやボリュームの再設定（`setInitialState()`）も throw します。マウントパスは静的パスのみです（`*`・`$`・`#`・`@`・空白は不可）。初期化後に `mount` 属性を変更することはできず、変更は無視されます —— 要素を取り除き、望むパスで新しい要素を追加してください。

**スコープごとに動くもの**（ここに無言で無視されるものはありません）:

| 宣言 | ルートの `<wcs-state>` | ボリューム `<wcs-state mount="p">` | マウントされたコンポーネント（`state: …` 付きの `bind-component`） |
|---|---|---|---|
| データキー・getter・setter・メソッド | 動く | 動く（`p` 相対。メソッドはパスで呼べる — `p.method`） | 動く — 自前のキーはホストがマップしない限り私有、getter は公開される |
| `$connectedCallback` / `$disconnectedCallback` | 動く | 動く（`p` 相対） | 動く |
| `$watch`・`$stream`・`$renderedCallback` | 動く | 拒否: 接ぎ木されず `console.error` | 動かない — `wcs/mount-dollar-declaration` を 1 回警告 |
| `$listKeys` | 動く | 拒否: 接ぎ木されず `console.error` | 動く（コンポーネント自身のリストに対して） |
| `$recursion`・`**` の getter | 動く | 拒否 | `[wcs/mount-dollar-declaration]` を throw |
| `$commandTokens`・`$eventTokens`・`$on` | 動く | 動かない — `console.warn` | 動く（コンポーネント自身のバインディングに対して） |
| `$errorCallback` | 動く | 動かない — `console.warn` | 動く（コンポーネント自身のバインディングの失敗に対して） |
| `$behavior`・`$features` | 動く | 拒否: 接ぎ木されず `console.error` | 動く（コンポーネント自身のツリーに対して） |
| 要素への注入（`data-wcs="state.<key>: …"`） | — | 拒否: 接ぎ木されず `console.error` | —（ホストの配線がマウントそのもの） |
| 初期化の失敗 | 1 回報告し、`connectedCallbackPromise` を reject | 接ぎ木せずに決着。`connectedCallbackPromise` は resolve（`scopes` アドオンが無いときは reject） | 1 回報告し、コンポーネントの `connectedCallbackPromise` を reject |

マウントされていないコンポーネント（自前の `<wcs-state>` を持つ素の Shadow DOM の子や、ホストが配線しない Shadow DOM の `bind-component`）はそれ自体がルートで、1 列目のすべてが動きます。

> **v1 の名前付き状態からの移行:** `<wcs-state name="cart">` + `total@cart` は `<wcs-state mount="cart">` + `cart.total` になります。v2 では `name` 属性は fail-fast し、パス中の `@` は parse error です（どちらもこの誘導文付き）。移行の対応表: [docs/state-mount-design.md](../../docs/state-mount-design.md) §9。

## 状態の更新

`@wcstack/state` では、すべての状態は**パス**を持ちます — `count`、`user.name`、`items` のように。状態をリアクティブに更新するには、**パスに代入**します:

```javascript
this.count = 10;               // パス "count"
this["user.name"] = "Bob";     // パス "user.name"
```

ルールは1つだけです。**「パスに直接代入する」ことで、関連するDOMが自動的に更新されます。**

state にないトップレベルのキーへの書き込みは、そのキーを作ります（`this.later = 5`）。そのようなキーの読み取りは
`[wcs/binding-path-missing] Path "later" does not exist on the state tree.`（`#301`）を throw するので、
state のどこにも宣言されていないキーへのバインディングは失敗します（[診断](#診断と失敗の扱い)）——
バインドするキーは、`null` も含めてすべて初期状態に宣言してください。存在しない深いパス
（`user.nickname`）は `undefined` と読めます。

### なぜ `this.user.name = "Bob"` ではDOMが更新されないのか

これは単なる制約ではなく、**契約境界が見えている箇所**です。

通常のプロパティアクセスの書き方だと、まず `this.user` でプレーンな `user` オブジェクトを読み取り（パスの読み取り）、取得したオブジェクトの `.name` を直接書き換える挙動になります。これは「パスに対するプロパティ代入」という契約を通っていません。そのため、システム側は変更を検知しません：

```javascript
// ✅ パスへの代入 — 変更が検知される
this["user.name"] = "Bob";

// ❌ パスへの代入ではない — 変更は検知されない
this.user.name = "Bob";
```

`this.user.name = "Bob"` も動くようにすると、一見便利にはなります。しかしその瞬間に「UI と状態はパスだけで結ばれる」という原理が崩れます。どこで依存を追跡し、どこで更新を確定するかが曖昧になり、契約境界が失われます。

### 配列

配列についても全く同じルールが適用されます。常に**パスに対して新しい配列を代入**してください。`push` や `splice`、`sort` などの破壊的な配列メソッドは、パスへの代入を介さずに状態をその場で（in-placeに）書き換えてしまうため、変更が検知されません。代わりに、新しい配列を返す非破壊的なメソッドを使用します：

```javascript
// ✅ 新しい配列をパスに代入 — 変更が検知される
this.items = this.items.concat({ id: 4, text: "New" });
this.items = this.items.toSpliced(index, 1);
this.items = this.items.filter(item => !item.done);
this.items = this.items.toSorted((a, b) => a.id - b.id);
this.items = this.items.toReversed();
this.items = this.items.with(index, newValue);

// ❌ その場での変更 — パスへの代入なし、変更は検知されない
this.items.push({ id: 4, text: "New" });
this.items.splice(index, 1);
this.items.sort((a, b) => a.id - b.id);
```

要素 1 つへの書き込み（`this["items.0"] = obj`）もパスへの代入です: その位置の値を置き換え、その位置の
行が新しい値を表示します。行を値ごと動かすには、新しい配列を代入してください —— [`$resolve`](#resolve--明示的なインデックスでのアクセス) を参照。

## バインディング構文

### `data-wcs` 属性

```
property[#modifier]: path[|filter[|filter(args)...]]
```

複数バインディングは `;` で区切ります：

```html
<div data-wcs="textContent: count; class.over: count|gt(10)"></div>
```

区切りの `;` と `|` は引用符の外でだけ区切るので、引用符付きのフィルタ引数に含められます: `textContent: tags|join('; ')`、`title: parts|join(' | ')`。

| 要素 | 説明 | 例 |
|---|---|---|
| `property` | バインドする DOM プロパティ | `value`, `textContent`, `checked` |
| `#modifier` | バインディング修飾子 | `#ro`, `#prevent`, `#stop`, `#onchange`, `#direct` |
| `path` | 状態プロパティパス | `count`, `user.name`, `users.*.name` |
| `\|filter` | 変換フィルタチェーン | `\|gt(0)`, `\|round\|locale` |

### プロパティ種別

| プロパティ | 説明 |
|---|---|
| `value` | 要素の値（input では双方向） |
| `checked` | チェックボックス / ラジオボタンの選択状態（双方向） |
| `textContent` | テキストコンテンツ |
| `text` | textContent のエイリアス |
| `html` | innerHTML |
| `class.NAME` | CSS クラスの切り替え |
| `style.PROP` | CSS スタイルプロパティの設定 |
| `attr.NAME` | 属性の設定（SVG 名前空間対応） |
| `radio` | ラジオボタングループバインディング（双方向） |
| `checkbox` | チェックボックスグループの配列バインディング（双方向） |
| `onclick`, `on*` | イベントハンドラバインディング — [イベントハンドリング](#イベントハンドリング) 参照 |
| `.NAME` | 明示のプロパティ — `on` で始まってもイベントにしない |

**`on` で始まるプロパティ。** 名前が `on` で始まる束縛はイベントになります（`onclick:`）。そのため `online: x` は `"line"` イベントを待ち、要素の `online` プロパティには書きません。`on` で始まるプロパティに値を書くには、左辺の先頭にドットを付けます:

```html
<my-status data-wcs=".online: isOnline; onclick: refresh"></my-status>
```

ドットの付いた形はドットの無い形と同じ束縛で、イベントにならない点だけが違います（`.value:` は `value:` と同じく双方向、修飾子と入力フィルタもそのまま使えます）。名前空間の語（`.class` / `.attr` / `.style` / `.command` / `.eventToken` / `.state`）と空の名前は `[wcs/binding-syntax]` で拒否します。

### 修飾子

| 修飾子 | 説明 |
|---|---|
| `#ro` | 読み取り専用 — 双方向バインディングを無効化 |
| `#prevent` | イベントハンドラで `event.preventDefault()` を呼び出す |
| `#stop` | イベントハンドラで `event.stopPropagation()` を呼び出す — 委譲されたハンドラでは、外側の `on*:` ハンドラを止めるが、祖先に自分で付けたリスナーは止めない（[イベントハンドリング](#イベントハンドリング) 参照） |
| `#direct` | `on*:` バインディングで、リスナーをルートへ委譲せず要素自身に付ける — [イベントハンドリング](#イベントハンドリング) 参照 |
| `#onchange` | 双方向バインディングで `input` の代わりに `change` イベントを使用 |
| `#init=<authority>` | バインディングの authority / 初期同期の向き — [バインディング authority](#バインディング-authority-init--sync) 参照 |
| `#sync=<timing>` | 要素スナップショットの読み取りタイミング — [バインディング authority](#バインディング-authority-init--sync) 参照 |

複数の修飾子は 1 つの `#` の後にカンマ区切りで書きます: `value#ro,init=none: path`、`onclick#direct,stop: save`

修飾子は束縛の種別を変えません: `radio#ro:` と `checkbox#ro:` は radio / checkbox の束縛のままです。その束縛が使わない修飾子は無視されます（プロパティ束縛の `#direct`、未知の `#foo`）。未知の `key=value` 形式の修飾子（`#foo=1`）は throw します。

パーサは次の書き方を `[wcs/binding-syntax]` で拒否します: 2 つ目の `#`（`value#ro#wo` ではなく `value#ro,wo` と書く）、`else:` の後ろの値（`else:` と書く）、`for` / `if` / `elseif` / `else` / `...` の左辺の修飾子やフィルタ、`for:` の出力フィルタ（`#121` — [ループ](#ループ-for) 参照）、`__proto__` や `prototype` というパスセグメント（`#120` — 書き込み・`$resolve`・`$setAll`、そして `this.__proto__` のような読み取りでも拒否される）、フィルタ引数の閉じていない引用符。

### 双方向バインディング

以下の要素で自動的に有効化されます：

| 要素 | プロパティ | イベント |
|---|---|---|
| `<input type="checkbox/radio">` | `checked` | `input` |
| `<input>`（その他の type） | `value`, `valueAsNumber`, `valueAsDate` | `input` |
| `<select>` | `value` | `change` |
| `<textarea>` | `value` | `input` |

`<input type="button">` は除外されます。`#ro` で無効化、`#onchange` でイベントを変更できます。値を書き戻すリスナーは要素自身に付きます —— 双方向バインディング・radio・checkbox は委譲されません。

### バインディング authority (`#init=` / `#sync=`)

**これが解決する問題。** バインディングが attach する時点で既に値を持っている要素 —— 永続値をロード済みの `<wcs-storage>`、時計、自分のスナップショットを復元するウィジェット —— は state の初期値に上書きされます。双方向バインディングの初期同期が state→element に書くからです。そのバインディングにだけ `#init=element` を付けると、初期同期は*要素*が勝ちます。以後の変更は通常どおり両方向に流れます。このケース（load-before-bind）は下で具体的に説明します。この節の残りは、それを一例として含む一般規則です。

`static wcBindable` を宣言したカスタム要素への prop バインディングは、**authority**（バインディング attach 時の**初期同期**をどちら側が勝つか）を解決します。定常時の方向は authority とは別に、メンバの宣言形状で決まります: output-only メンバは state からの書き込みを恒久的に受け付けず（契約）、双方向メンバは初期同期の勝者と無関係に以後は両方向に流れます。既定 authority はメンバの宣言位置から導出されます（既定 ON。`$behavior: { enableDirectionalInitialSync: false }` でその state ツリーについて OFF にできます — [`$behavior`](#behavior) 参照）：

| メンバの宣言位置 | 既定 authority | 効果 |
|---|---|---|
| `properties` のみ（output-only） | `element` | 要素の値が state に流れる。**state からこのメンバへは書き込まれない** |
| `inputs` のみ | `state` | state が要素に書き込む |
| `properties` + `inputs`（双方向） | `state` | 従来挙動 — state が先に書き、以後は要素イベントが state を更新 |
| —（`wcBindable` 非宣言・素の HTML 要素） | `state` | 従来と不変 |

> **作法：** settable なメンバは **`properties` と `inputs` の両方**に宣言してください。`properties` にしか宣言されていないメンバは output-only 扱いになり、state→element 書き込みがバインディングの生存期間ずっと抑止され、要素側の初期値が state 側のシード値を上書きします（`@wcstack` の I/O ノード Shell と DCC の `$bindables` はこの作法に従っています）。

#### 要素から state に何が書かれるか（`properties[].getter`）

要素が `properties[].event` を dispatch したとき、state に書かれる値は **`getter(event)`** です。`getter` を省略するとプロトコル既定の [`(e) => e.detail`](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/SPEC.md#default-getter) が適用され、**`detail` 全体がそのまま**書かれます。このとき宣言したプロパティは要素から読まれ*ません*。イベントのペイロードが正です。`wcBindable` を持たない素の HTML 要素は逆で、`input`/`change` 時に `element[propName]` を読みます。

したがって `getter` なしで `detail: { value: 7654321 }` を dispatch する要素は、数値ではなく**オブジェクト** `{ value: 7654321 }` を state に書きます。しかもこの失敗はほぼ無言です。書き戻し（`Number({ value: … })` → `NaN`）は例外を投げず、`@wcstack/lint` にも見えません（ペイロードの形は静的に分かりません）。`diagnostics` アドオン（全部入りのエントリに含まれる）は、イベント時点で見分けられる 2 形についてだけ、要素 × プロパティごとに 1 回警告します（`wcs/default-getter-mismatch`）: 要素プロパティに値があるのに `detail` が `undefined`（素の `Event`、または `detail` の付け忘れ）、および要素プロパティがオブジェクトでないのに `detail` が `<propName>` キーを持つオブジェクト（上のラッパー）。それ以外の不整合は気づかれずに通り、どちらの場合も書き込み自体はそのまま行われます。次の 2 形のどちらかに揃えてください：

```javascript
class YenInput extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [
      // (a) 値そのものを detail にする — プロトコルの推奨形。getter 不要
      { name: "value", event: "yen-input:value-changed" },
      // (b) detail がオブジェクト、または CustomEvent でないイベントを使う — 読み方を宣言する
      // { name: "value", event: "yen-input:value-changed", getter: (e) => e.detail.value },
      // { name: "value", event: "input",                  getter: (e) => e.target.value },
    ],
    inputs: [{ name: "value" }],
  };
  #onInput() {
    // (a): ラッパーオブジェクトではなく値を dispatch する
    this.dispatchEvent(new CustomEvent("yen-input:value-changed", { detail: this.value, bubbles: true }));
  }
}
```

どちらを選んでも、`element.value` とイベントから取り出す値は同じ論理状態を表していなければなりません（プロトコルの *Producer State Consistency Invariant*）。初期同期はプロパティを読み、以後の更新はイベントを読むからです。wcstack 内部でも両形が使われています —— `<wcs-fetch>` の `loading` は `getter` なしで真偽値を `detail` に載せ、`value` は `getter` で `detail.value` を読みます。DCC の `$bindables` が `getter: (e) => e.target[name]` を宣言するのは、サブパス書き込みには `detail` に載せる単一の値が無いからです。既定そのものを変える予定はありません。`e.detail` はすべての wc-bindable アダプタに対する規範（`@wc-bindable/core` の `bind()` とフレームワークアダプタも同じ既定）で、プロトコル上、既定の変更は新しいプロトコル識別子を要する破壊的変更に分類されています。

authority はバインディング単位で `#init=` により上書きできます：

| 値 | 初期同期 | 使える宣言 |
|---|---|---|
| `init=state` | state の値を要素へ書く（双方向の既定） | inputs のみ・双方向 |
| `init=element` | 要素のスナップショットを state へ入れる — 双方向メンバではその後は通常の双方向に戻る（次の変更から state→element も流れる） | output-only・双方向 |
| `init=auto` | state スロットが未初期化なら `element`、それ以外は `state` | 双方向 |
| `init=none` | 初期同期なし — 次の変更から通常どおり流れる（event バインディングはこの値のみ許可） | すべて |

`#init=` が決めるのは初期競合の勝者だけです。state→element 書き込みの**恒久**抑止は「メンバが output-only 宣言であること」から来るのであって、修飾子からは来ません。これにより `#init=element`（または `#init=auto`）が **load-before-bind** の宣言的な解になります: 要素が自身の `connectedCallback` で永続値をロード済み（バインディング確立より先）でも state 初期値に潰されず、以後の state 変更は要素へ届きます（例えば `<wcs-storage>` の保存は生き続けます）：

```html
<!-- 永続化済みリストが todos を初期化し、以後の todos 代入は保存もされる -->
<wcs-storage key="todos" type="local" data-wcs="value#init=element: todos"></wcs-storage>
```

`#sync=` は element authority のバインディングで要素スナップショットを**いつ**読むかを制御します：

| 値 | 意味 |
|---|---|
| `sync=call`（既定） | バインディングの attach 時に即読み取り |
| `sync=connect` | 要素が document に接続されるまで読み取りを保留 |

```html
<x-clock  data-wcs="value#init=element: clock.now"></x-clock>
<x-input  data-wcs="value#init=auto: form.name"></x-input>
<x-widget data-wcs="value#init=element,sync=connect: widget.snapshot"></x-widget>
```

`sync=connect` では、接続時スナップショットが初期競合を解決するまで state→element 書き込みも保留されます。

注意：

- `$behavior: { enableDirectionalInitialSync: false }`（opt-out）のとき、`#init=`/`#sync=` を書くと throw し（`#31`）、メンバは宣言と照合されず、output-only メンバも含めてすべての初期同期で state が勝ちます。
- output-only メンバに対して state 側に都合のよい初期値（`value: []`、`query: ""` 等）をシードしないでください — 要素側の実初期値（多くは `null`/`undefined`）がシードを置き換えます。シードは要素の実初期値に合わせ、表示用の値は派生 getter で null ガードしてください。
- 宣言に載っていないメンバへのバインディングは throw します（`Property "x" is not declared by wcBindable.`、`#38`）。メンバの形状が許さない `#init=`（`#39`）、観測可能なプロパティでないメンバへの `sync=connect`（`#40`）も同様です。authority が支配するのは初期同期だけです（`docs/architecture-hardening/09-remediation-design.ja.md` §3.6）。

### ラジオボタンバインディング

`radio` でラジオボタングループを単一の状態値にバインドします：

```html
<input type="radio" value="red" data-wcs="radio: selectedColor">
<input type="radio" value="blue" data-wcs="radio: selectedColor">
```

状態値と一致する `value` を持つラジオボタンが自動的にチェックされます。ユーザーが別のラジオボタンを選択すると、状態が更新されます。`#ro` で読み取り専用にできます。

`for` ループ内での使用：

```html
<template data-wcs="for: branches">
  <label>
    <input type="radio" data-wcs="value: .; radio: currentBranch">
    {{ . }}
  </label>
</template>
```

### チェックボックスバインディング

`checkbox` でチェックボックスグループを状態配列にバインドします：

```html
<input type="checkbox" value="apple" data-wcs="checkbox: selectedFruits">
<input type="checkbox" value="banana" data-wcs="checkbox: selectedFruits">
<input type="checkbox" value="orange" data-wcs="checkbox: selectedFruits">
```

チェックボックスの `value` が状態配列に含まれている場合にチェック状態になります。チェックボックスの切り替えで配列への値の追加・削除が行われます。`|int` で文字列値を数値に変換、`#ro` で読み取り専用にできます。

### Mustache 構文

テキストノードの中の `{{ expression }}` はテキストバインディングです —— 中身はパスと省略可能なフィルタチェーンで、`textContent:` の右辺と同じです：

```html
<p>こんにちは、{{ user.name }}さん！</p>
<p>カウント: {{ count|locale }}</p>
```

テキストノードは波括弧の位置で分割されます: 文字どおりのテキストはそのまま残り、`{{ }}` はそれぞれ値を表示する独立したテキストノードになります。`$behavior: { enableMustache: false }` でその state ツリーについて OFF にできます（[`$behavior`](#behavior)）。その場合、波括弧はテキストのまま残ります。

state が読み込まれる前は、`<template>` の外の `{{ }}` は書いたとおりに見えています。そのちらつきが問題になり、ページがサーバー描画でない場合は、代わりにコメントバインディングを書いてください。

#### コメントバインディング

`<!--@@: expression-->`（または `<!--@@wcs-text: expression-->`）は、フィルタも含めて `{{ expression }}` と同じテキストバインディングを、コメントとして書いたものです —— そのため、バインドされる前には何も表示されず、要素も増えません：

```html
<p>こんにちは、<!--@@: user.name-->さん！</p>
<p>合計: <!--@@wcs-text: total|locale--></p>
```

- コメントは同じ位置のテキストノードに置き換えられます。ページレベルでも、`for:` / `if:` のテンプレートの中でも同じです。
- `enableMustache` の値にかかわらずバインドされます: `{{ }}` を OFF にしても、コメントバインディングは OFF になりません。
- キーワードは空か `wcs-text` です。それ以外のコメント（`<!--@@route:…-->`、このパッケージや `@wcstack/server` が書くアンカー、普通のコメント）には手を付けません。式は複数行にまたがってもかまいません。
- `<textarea>` や `<title>` の中のコメントはバインドされません: ブラウザはその中身をテキストとしてパースするためです。
- `@wcstack/lint` と VS Code 拡張は、`<template>` の外の `{{ }}` よりもこの形を推奨します。

### Spread バインディング (`...`)

[`wc-bindable` プロトコル](#bindables--commands-と-wc-bindable-プロトコル)を宣言したカスタム要素に対して、`...: target` を使うと要素の **properties + inputs を 1 行で一括配線**できます：

```html
<wcs-fetch data-wcs="...: usersFetch"></wcs-fetch>
```

```js
export default {
  usersFetch: {
    url: "/api/users",
    method: "GET",
    value: null,
    loading: false,
    error: null,
    status: null,
  }
}
```

ランタイムが `customClass.wcBindable.properties + inputs` を読み取り、各 name を個別バインディング（`usersFetch.value`、`usersFetch.url`、...）に展開します。

**対象範囲**：spread は *データサーフェス*（properties + inputs）のみを対象とします。`commands` や event token は **対象外** — pub/sub の発火点が HTML から読めるように、明示配線を維持してください。

**for ループ内**：`...: items.*`（推奨）または dot ショートカット `...: .` を使います：

```html
<template data-wcs="for: storesFetches">
  <wcs-fetch data-wcs="...: storesFetches.*"></wcs-fetch>
</template>
```

**後勝ち上書き** — spread の後ろに同名 prop を書くと、明示側が優先されます：

```html
<wcs-fetch data-wcs="...: usersFetch; status: alternateStatus"></wcs-fetch>
```

**`undefined` は「無意見」** — 展開された state パスが `undefined` に解決される場合（slot オブジェクトでその input を初期化していない場合など）、プロパティ書き込みは**スキップ**され、要素側の既定値がそのまま生きます。実際に使うパスだけ初期化すれば十分で、`<wcs-fetch>` が `method` / `manual` / `body` を宣言していても `usersFetch: { value: null, loading: false }` だけで動きます。明示的にクリアしたい場合は `null` を代入してください（`null` は常に書き込まれます）。（このスキップは spread に限らず、要素の input に値を渡すすべてのプロパティバインディングに適用されます。）**表示の表面は別です:** `textContent` / `innerText` / `innerHTML`・mustache やコメントバインディングのテキスト・`attr.*`・`style.*`・`class.*` には生かすべき要素側の既定値が無いので、`undefined` も `null` も「値が無い」— テキストは空になり、属性やスタイルは削除され、クラスは外れます。`class.*` だけは範囲が狭く、「値が無い」扱いになるのは `undefined` と `null` だけです — **それ以外の非 boolean は今も throw します**。クラスの束縛は真偽の切り替えなので、truthy な文字列は意図というより書き間違いである方がずっと多いためです。「truthy として扱う」つもりなら `class.on: flag|truthy` と書いてください。

**フィルタを挟んでも契約は保たれます。** 空値の判定はフィルタ**後**の値に対して行われるため、`String(value)` で結果を組み立てるフィルタは、値が無いときに `"undefined"` という**文字**を作ってしまいかねません。書式の族（`upper` / `lower` / `capitalize` / `trim` / `slice` / `padStart` / `padEnd` / `repeat` / `reverse` / `truncate` / `unit`）は代わりに `undefined` / `null` を素通しするので、`attr.title: x|trim` はフィルタの無い `attr.title: x` と同じく属性を消します。次の 3 群は**意図的に素通ししません**: 空値そのものが入力として意味を持つフィルタ（`defaults` / `coalesce` / `nullIfEmpty` / `boolean` / `truthy` / `falsy` / `not` / `eq` / `ne`）、変換が仕事のフィルタ（`int` / `float` / `number` / `string` — `undefined|string` は今も `"undefined"`）、値の型を検査するフィルタ（数値・日付・配列の族。`toFixed` / `date` / `join` など）。最後の群は throw しますが、それは束縛 1 本に閉じ込められ `$errorCallback` に報告されます。値が無いことが正当にありうるなら前に `coalesce` を置いてください（`price|coalesce(0)|toFixed(2)`）。

**制約事項**：

- spread 右辺へのフィルタ（`...: target|filter`）はエラー
- 右辺パスの途中に `*` を含めても OK（例：`...: stores.*.fetch`）
- 右辺は素のツリーパス（`...: fetchX`、途中の `*` も可）
- カスタム要素クラスが未登録の場合、`customElements.whenDefined(tag)` 解決時に遅延展開される（autoloader による遅延ロードに対応）。`for:` / `if:` のテンプレートの中でも同じ — 行や枝はすぐに描かれ、クラスが定義されたらそれぞれの行の要素をその行の値で展開する。定義前に消えた行・閉じた枝は展開せず、何も生かし続けない。待つのはその要素を定義するレジストリ —— 要素が置かれた shadow root のスコープ付きレジストリも含む
- `wcBindable` 宣言**のない**要素はエラー（`[wcs/spread-no-bindable]`。明示配線で書いてください）— ネイティブ要素は定義を待たずに即座にエラーになる。spread は何を展開すべきかを契約から読み取るため

**Composite shell**（wc-bindable Composition Profile）はそのままサポートされます：composite shell は標準の `target.constructor.wcBindable` を通じて synthesized declaration を露出するため、`"s3.progress"` のような composed name はフラットな要素メンバーキーとして扱われます。state を composed 構造に合わせて (`{ s3: { progress: 0 } }`) 持てば、`...: pipeline` が自動的に nested state path へ展開されます。

### ページ走査が何をバインドするか

`<wcs-state>` は自分のルート（document、shadow root、または Light DOM コンポーネントのホスト）をバインドするとき、マークアップを 1 回走査し、その中の `data-wcs` 属性・`{{ }}`・コメントバインディングを読みます:

- **値は決してマークアップにならない。** バインディングがページに入れるもの —— `textContent:` や `innerHTML:` の値、カスタム要素がバインドされた値から描画する子 —— がバインディングとして読まれることはありません: その中の `{{ }}`・`data-wcs`・コメントバインディングは、ただのテキストのまま残ります。
- バインディングが中身を設定する要素（`textContent:`・`text:`・`innerText:`・`innerHTML:`・`html:`）の子はバインドされません。ページレベルでもテンプレートの中でも同じで、`#init=element` や `#init=none` によって書いた子がそのまま残る場合も同じです。`outerHTML:` / `outerText:` をバインドしたページレベルの要素の子もバインドされません。バインディングが必要なマークアップは別の要素に置いてください。
- `<script>`・`<style>`・`<noscript>`・`<iframe>` の中身は走査しません。その要素自身の `data-wcs`（`srcdoc:`、`attr.src:`）はバインドされます。
- `<wcs-state>` 要素の内側に書いたマークアップはページの一部です。Light DOM コンポーネントの中身は、ページではなくそのコンポーネント自身のエンジンがバインドします。
- ページレベルでは、要素の子が要素自身のバインディングより先にバインドされます。そのため、カスタム要素が最初のプロパティ書き込みを受け取るのは子がバインドされた後で、`$errorCallback` も子の失敗から先に受け取ります。テンプレートの中では文書順です。
- `for:` の行と `if:` の枝は、`data-wcs` 属性を除いたテンプレートの複製です。そのため `[data-wcs…]` に対する CSS ルールやテストのセレクタはそれらの要素にマッチしません —— クラスや自前の `data-*` 属性を使ってください。
- `for:` / `if:` のテンプレートの中で、自分の要素を置き換えるバインディング（`outerHTML:`、`outerText:`）は `[wcs/template-syntax] #203` で初期化を失敗させます: 行は自分のノードを位置で保持しているためです。代わりにラッパー要素に `innerHTML:` をバインドしてください（`class.outerHTML:`、`attr.outerText:` は影響を受けません）。

自分で書いていないマークアップをこの走査に届かせてはいけません —— [セキュリティ](#セキュリティ) を参照してください。

## 構造ディレクティブ

構造ディレクティブは `<template>` 要素で使用します：

### ループ (`for`)

```html
<template data-wcs="for: users">
  <div>
    <!-- フルパス -->
    <span data-wcs="textContent: users.*.name"></span>
    <!-- 省略形（ループコンテキストからの相対パス） -->
    <span data-wcs="textContent: .name"></span>
  </div>
</template>
```

`for:` ディレクティブは**値ベースの差分アルゴリズム**を使用します。配列の各要素の値そのものが識別キーとして機能します。配列が再代入されると、差分アルゴリズムが新旧の要素を値で照合し、変更のない要素の DOM ノードを再利用しつつ、追加・削除・並び替えを効率的に処理します。

つまり、**行オブジェクトの参照さえ保たれていれば、行の追加・削除・並べ替えに明示的なキー属性（React の `key` や Vue の `:key`）は不要です**。非破壊の配列メソッド（`toSorted` / `toReversed` / `filter` / `with` / `toSpliced`）はいずれも要素の参照を保つため、ソートやフィルタは構造的に keyed に動作し、「キーの付け方を間違える」種類のバグが原理的に発生しません。

例外は、**新しく生成されたオブジェクトとして届くデータ**です。`fetch(...).json()`、ストレージからの `JSON.parse`、WebSocket / SSE の全件スナップショット、Worker の `postMessage` などがこれにあたります。これらの行は参照で照合できないため、全行が破棄・再構築されます。次の [`$listKeys`](#listkeys--再取得された行の同一性) を参照してください。

**`for:` は出力フィルタを取りません。** `for: items|take(2)` は、フィルタが何であれ `[wcs/binding-syntax] #121` で初期化を失敗させます。`for: items` の行は `items.<index>` なので、フィルタ後の配列の行は別の要素を指してしまい、その行を通した書き込みが間違った要素に届きます。絞り込んだリストを返す getter を宣言し、それをループしてください:

```html
<!-- get firstTwo() { return this.items.slice(0, 2); } がある場合 -->
<template data-wcs="for: firstTwo">
  <li data-wcs="textContent: .name"></li>
</template>
```

getter はコピーを返すので、元のパスを通した書き込み（`this["items.1.name"] = "z"`）はコピー側の行に届きません。行を通して書いてください（`firstTwo.1.name`、または行の中のバインディング）。1 つのオブジェクトが 2 つのリストから到達できる場合（`todos` を絞り込む `get shown()` を `for: shown` で描画する場合）も同じです: [同じオブジェクトが 2 つの位置にあるとき](#resolve--明示的なインデックスでのアクセス) を参照してください。

#### `$listKeys` — 再取得された行の同一性

行がバインディングの管理外の DOM 状態（フォーカス、IME 変換中の文字列、`<details>` の開閉、行内スクロール位置、`<canvas>` の描画内容、`<video>` の再生位置）を持つ場合、行の再構築でそれらは失われます。キーを宣言すると、リフレッシュをまたいで行を同定できます：

```js
{
  items: [],
  $listKeys: {
    "items": "id",                        // フィールド名
    "items.*.children": (row) => row.uid, // 複合キー用の関数も可
  },
}
```

キーを宣言すると、新しい配列を代入しても**既存の行オブジェクトが据え置かれ**、実際に変化したフィールドだけがそこへ書き込まれます。行の DOM は再構築されず再利用されます：

```js
// 行オブジェクトはすべて新しいが id で照合されるため、DOM・フォーカス・
// <details> の状態は保たれ、差分のあるフィールドだけが書き込まれる
this.items = await (await fetch("/api/items")).json();
```

補足：

- **opt-in かつパス単位**です。宣言していないリストは従来どおりの挙動で、追加コストもありません。
- **ネストも opt-in** です。宣言されたパスだけがキー照合され、未宣言のネスト配列は従来どおり参照置換されます。リスト単位で段階的に導入できます。
- **無変化のリフレッシュはゼロコスト**です。何も変わっていなければフィールド書き込みも DOM 操作も一切発生しません。
- **行は plain object** である必要があり、キーは存在かつ一意でなければなりません。キーの重複・欠落・クラスインスタンスは、静かに劣化させず即座にエラーになります。
- **行から消えたフィールドは `null` でクリア**されます。`null` はこのパッケージにおける明示的なクリアの語彙です（`undefined` は「状態が値を持たない」を意味し、書き込み自体がスキップされます）。
- 名前が 1 つのパスセグメントにならないフィールド（`@odata.etag`・`2fa`・`a.b`）や、行 getter と同じ名前のフィールドは、据え置かれる行へそのままコピーされ、行は全体として更新されます。JSON から来た `__proto__` キーはコピーされません。
- 格納される配列は照合済みの行オブジェクトから組み直されるため、代入後は `this.items !== 代入した配列` になります。
- `$listKeys` は `list-keys` アドオンです: 全部入りのエントリには含まれており、`/core` のページは `@wcstack/state/features/list-keys` を入れます。マウントされたコンポーネントの `$listKeys` はそのコンポーネント自身のリストにキーを付けます。ボリュームは宣言できません。

#### ドット省略記法

`for` ループ内では、`.` で始まるパスがループの配列パスを基準に展開されます：

| 省略形 | 展開後 | 説明 |
|---|---|---|
| `.name` | `users.*.name` | 現在の要素のプロパティ |
| `.` | `users.*` | 現在の要素そのもの |
| `.name\|upper` | `users.*.name\|upper` | フィルタは保持される |

プリミティブ配列では、`.` が要素の値を直接参照します：

```html
<template data-wcs="for: branches">
  <label>
    <input type="radio" data-wcs="value: .; radio: currentBranch">
    {{ . }}
  </label>
</template>
```

多重ワイルドカードによるネストループに対応しています。ネストされた `for` ディレクティブの `.` 省略記法も親ループのパスを基準に展開されます：

```html
<template data-wcs="for: regions">
  <!-- .states → regions.*.states -->
  <template data-wcs="for: .states">
    <!-- .name → regions.*.states.*.name -->
    <span data-wcs="textContent: .name"></span>
  </template>
</template>
```

### 条件分岐 (`if` / `elseif` / `else`)

```html
<template data-wcs="if: count|gt(0)">
  <p>正の値</p>
</template>
<template data-wcs="elseif: count|lt(0)">
  <p>負の値</p>
</template>
<template data-wcs="else:">
  <p>ゼロ</p>
</template>
```

条件をチェーンできます。`elseif` は前の条件を自動的に反転します。

### 挿入された内容の中の構造テンプレート

ページがバインドされた後に別のパッケージが挿入する内容 —— `@wcstack/router` が表示するルートの本体や、`<wcs-head>` の子 —— は、挿入する側がバインダプロトコル（`globalThis[Symbol.for("wcstack.binder")].bind(subtree, options?)`）を通して引き渡したときにバインドされます。そのような内容の**最上位**にある `for:` / `if:` テンプレートは自分の隣に描画されるため、自分のノードだけを動かす挿入側では行が置き去りになります。そこで、挿入側が範囲全体をまとめて出し入れすると宣言したときだけ描画されます —— `bind(subtree, { range: true })`。`@wcstack/router` 3.5 以降はルートの中身についてそうしています。この宣言がなければ描画されず、コンソールに `[wcs/template-syntax] #204` が報告されます。要素で包んだテンプレートは、どの場合でも描画されます:

```html
<wcs-route path="/items">
  <ul>
    <template data-wcs="for: items"><li>{{ .name }}</li></template>
  </ul>
</wcs-route>
```

バインダはマークアップを理由に throw しません: 引き渡された部分木の中のエラーは `console.error` で報告され、それより前の部分はバインドされたまま残り、ナビゲーションは続きます。もう一度引き渡された部分木（router は挿入のたびに中身を引き渡します）がバインドされるのは 1 回だけで、ルートの `<wcs-state>` がページから外れている間に引き渡された部分木は、その要素が戻されたときに —— 引き渡されたときの範囲の宣言のとおりに —— バインドされます。引き渡されるのは要素だけなので、ルートの本体に要素の外で直接書いた `{{ }}` は、ナビゲーションでそのルートに入ったときにはバインドされません —— 要素で包んでください。これが問題になるのは、バインダを自分で呼ぶ場合か、`<wcs-route>` の直下に `for:` / `if:` を書く場合だけです。

## パス getter（算出プロパティ）

**パス getter** は `@wcstack/state` の中核機能です。JavaScript の getter に**ドットパス文字列キー**とワイルドカード（`*`）を使って定義します。**データツリーの任意の深さに仮想プロパティを追加でき、すべてを1箇所にフラットに定義できます**。データのネストがどれほど深くても、定義側は同じレベルに並び、ループ要素ごとの自動依存追跡が機能します。

### 基本的なパス getter

```html
<wcs-state>
  <script type="module">
    export default {
      users: [
        { id: 1, firstName: "Alice", lastName: "Smith" },
        { id: 2, firstName: "Bob", lastName: "Jones" }
      ],
      // パス getter — ループ内で要素ごとに実行
      get "users.*.fullName"() {
        return this["users.*.firstName"] + " " + this["users.*.lastName"];
      },
      get "users.*.displayName"() {
        return this["users.*.fullName"] + " (ID: " + this["users.*.id"] + ")";
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: users">
  <div data-wcs="textContent: .displayName"></div>
</template>
<!-- 出力:
  Alice Smith (ID: 1)
  Bob Jones (ID: 2)
-->
```

パス getter 内の `this["users.*.firstName"]` は、手動でインデックスを指定することなく、自動的に現在のループ要素に解決されます。

### トップレベル算出プロパティ

ワイルドカードなしの getter は通常の算出プロパティとして動作します：

```javascript
export default {
  price: 100,
  tax: 0.1,
  get total() {
    return this.price * (1 + this.tax);
  }
};
```

### getter のチェーン

パス getter は他のパス getter を参照でき、依存チェーンを形成します。上流の値が変更されると、キャッシュは自動的に無効化されます：

```html
<wcs-state>
  <script type="module">
    export default {
      taxRate: 0.1,
      cart: {
        items: [
          { productId: "P001", quantity: 2, unitPrice: 500 },
          { productId: "P002", quantity: 1, unitPrice: 1200 }
        ]
      },
      // アイテムごとの小計
      get "cart.items.*.subtotal"() {
        return this["cart.items.*.unitPrice"] * this["cart.items.*.quantity"];
      },
      // 集計: 全小計の合計
      get "cart.totalPrice"() {
        return this.$getAll("cart.items.*.subtotal", []).reduce((sum, v) => sum + v, 0);
      },
      // チェーン: totalPrice から税を算出
      get "cart.tax"() {
        return this["cart.totalPrice"] * this.taxRate;
      },
      // チェーン: 合計金額
      get "cart.grandTotal"() {
        return this["cart.totalPrice"] + this["cart.tax"];
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: cart.items">
  <div>
    <span data-wcs="textContent: .productId"></span>:
    <span data-wcs="textContent: .subtotal|locale"></span>
  </div>
</template>
<p>合計: <span data-wcs="textContent: cart.totalPrice|locale"></span></p>
<p>税: <span data-wcs="textContent: cart.tax|locale"></span></p>
<p>総合計: <span data-wcs="textContent: cart.grandTotal|locale"></span></p>
```

依存チェーン: `cart.grandTotal` → `cart.tax` → `cart.totalPrice` → `cart.items.*.subtotal` → `cart.items.*.unitPrice` / `cart.items.*.quantity`。アイテムの `unitPrice` や `quantity` を変更すると、チェーン全体が自動的に再計算されます。

### ネストされたワイルドカード getter

ネストされた配列構造では複数のワイルドカードが使用できます：

```html
<wcs-state>
  <script type="module">
    export default {
      categories: [
        {
          name: "果物",
          items: [
            { name: "りんご", price: 150 },
            { name: "バナナ", price: 100 }
          ]
        },
        {
          name: "野菜",
          items: [
            { name: "にんじん", price: 80 }
          ]
        }
      ],
      get "categories.*.items.*.label"() {
        return this["categories.*.name"] + " / " + this["categories.*.items.*.name"];
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: categories">
  <h3 data-wcs="textContent: .name"></h3>
  <template data-wcs="for: .items">
    <div data-wcs="textContent: .label"></div>
  </template>
</template>
<!-- 出力:
  果物
    果物 / りんご
    果物 / バナナ
  野菜
    野菜 / にんじん
-->
```

### フラットな仮想プロパティ — ネストの深さに依存しない定義

パス getter の重要な利点は、**データのネストがどれほど深くても、すべての仮想プロパティを1箇所にフラットに定義できる**ことです。各ネストレベルに算出プロパティを持たせるためだけにコンポーネントを分割する必要がありません。

```javascript
export default {
  regions: [
    { name: "関東", prefectures: [
      { name: "東京", cities: [
        { name: "渋谷", population: 230000, area: 15.11 },
        { name: "新宿", population: 346000, area: 18.22 }
      ]},
      { name: "神奈川", cities: [
        { name: "横浜", population: 3750000, area: 437.56 }
      ]}
    ]}
  ],

  // --- ネストの深さに関係なく、すべてフラットに定義 ---

  // 市レベル — 仮想プロパティ
  get "regions.*.prefectures.*.cities.*.density"() {
    return this["regions.*.prefectures.*.cities.*.population"]
         / this["regions.*.prefectures.*.cities.*.area"];
  },
  get "regions.*.prefectures.*.cities.*.label"() {
    return this["regions.*.prefectures.*.name"] + " "
         + this["regions.*.prefectures.*.cities.*.name"];
  },

  // 県レベル — 市からの集約。`indexes` 省略時はループ文脈（[$1, $2]）が
  // 既定になるので、この県の市だけが合計される
  get "regions.*.prefectures.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.cities.*.population")
      .reduce((a, b) => a + b, 0);
  },

  // 地方レベル — 県からの集約（文脈 [$1] でこの地方に絞られる）
  get "regions.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.totalPopulation")
      .reduce((a, b) => a + b, 0);
  },

  // トップレベル — ループ文脈なし。[] は「マッチ全件」
  get totalPopulation() {
    return this.$getAll("regions.*.totalPopulation", [])
      .reduce((a, b) => a + b, 0);
  }
};
```

3階層のネスト、5つの仮想プロパティ — すべてが1つのフラットなオブジェクト内に並んで定義されています。各レベルは任意の深さの値を参照でき、`$getAll` による集約は下位から上位へ自然に流れます。コンポーネントベースのフレームワークでは、一般的に各ネストレベルに個別のコンポーネントを作成し、算出値をツリーの上位に渡す方法が採られます。パス getter は、すべての定義を1箇所にまとめるという異なるトレードオフを提供します。

### getter の戻り値のサブプロパティへのアクセス

パス getter がオブジェクトを返す場合、ドットパスでそのサブプロパティにアクセスできます：

```javascript
export default {
  products: [
    { id: "P001", name: "ウィジェット", price: 500, stock: 10 },
    { id: "P002", name: "ガジェット", price: 1200, stock: 3 }
  ],
  cart: {
    items: [
      { productId: "P001", quantity: 2 },
      { productId: "P002", quantity: 1 }
    ]
  },
  get productByProductId() {
    return new Map(this.products.map(p => [p.id, p]));
  },
  // 完全な product オブジェクトを返す
  get "cart.items.*.product"() {
    return this.productByProductId.get(this["cart.items.*.productId"]);
  },
  // 戻り値のサブプロパティにアクセス
  get "cart.items.*.total"() {
    return this["cart.items.*.product.price"] * this["cart.items.*.quantity"];
  }
};
```

`this["cart.items.*.product.price"]` は `cart.items.*.product` getter が返すオブジェクトを透過的にチェーンします。

### パス setter

`set "path"()` でカスタム setter ロジックを定義できます：

```javascript
export default {
  users: [
    { firstName: "Alice", lastName: "Smith" },
    { firstName: "Bob", lastName: "Jones" }
  ],
  get "users.*.fullName"() {
    return this["users.*.firstName"] + " " + this["users.*.lastName"];
  },
  set "users.*.fullName"(value) {
    const [first, ...rest] = value.split(" ");
    this["users.*.firstName"] = first;
    this["users.*.lastName"] = rest.join(" ");
  }
};
```

```html
<template data-wcs="for: users">
  <input type="text" data-wcs="value: .fullName">
</template>
```

パス setter は双方向バインディングと連携します — input を編集すると setter が呼ばれ、`firstName` / `lastName` に分割して書き戻します。

### 対応するパス getter パターン

| パターン | 説明 | 例 |
|---|---|---|
| `get prop()` | トップレベル算出 | `get total()` |
| `get "a.b"()` | ネスト算出（ワイルドカードなし） | `get "cart.totalPrice"()` |
| `get "a.*.b"()` | 単一ワイルドカード | `get "users.*.fullName"()` |
| `get "a.*.b.*.c"()` | 複数ワイルドカード | `get "categories.*.items.*.label"()` |
| `set "a.*.b"(v)` | ワイルドカード setter | `set "users.*.fullName"(v)` |

### 仕組み

1. **コンテキスト解決** — リストの各要素は、位置を持つ行です。行について評価されるパス getter の中（`for:` の行、その中に束縛したイベントハンドラ、`$getAll` の走査）では、`this["users.*.name"]` の各 `*` がその行とその祖先の行に解決されるため、常に現在の要素を参照します。`*` が解決されるのは*その*リストの行を通してだけです: 別のリストの行はそのコンテキストになりません（`wcs/wildcard-rank`）。

2. **自動依存追跡** — getter が `this["users.*.name"]` にアクセスすると、`users.*.name` から getter のパスへの依存が登録されます。`users.*.name` が変更されると、getter のキャッシュが dirty になります。

3. **キャッシュ** — getter の結果は行ごとにキャッシュされます。`users.*.fullName` のインデックス 0 とインデックス 1 は別々のキャッシュエントリを持ちます。依存先が変更された場合のみキャッシュが無効化されます。

4. **直接インデックスアクセス** — 行をインデックスで指すこともできます: `this["users.0.name"]` は、ループコンテキストなしで「いま 0 番目にある行」を指します。要素への書き込み（`this["users.0"] = { ...this["users.0"], name: "z" }`）はその位置の値を置き換えます: 行はその場にとどまって新しい値を受け取り、その下で派生するもの（`users.0.name`・`$getAll("users.*.name")`・行 getter）はすべて計算し直されます —— `for:` でリストを描いているかどうかに関わらず同じです。オブジェクトをその場で書き換えて `$postUpdate("users.0")` / `$postUpdate("users")` で知らせると、行は据え置いたまま、その下を読み直します。数値の添字を含むバインディングパスも同じ意味 ——「*いま 0 番目にある行*」—— を持ちます: `textContent: users.0.name`、`{{ users.1.name }}`、`{{ users.0.fullName }}` のような行 getter、そして添字を複数含むパス（`groups.0.items.1.v`）。添字のパスを通した書き込み、`for:` の行やその行に束縛した入力欄を通した書き込み、要素の差し替え、並べ替え、行の削除、リストの丸ごと置換に追従します。数値の添字を含む `$watch` のキー（`"users.0.name"`）は、その位置の値が変わったときだけ発火します。リストの末尾より先の添字は `undefined` と読め、そこへの書き込みは `no row for "users.*.name"`（`#3`）を throw して何も変えません。

   数値の段が添字になるのは、その前の値が配列のときだけです。配列でないオブジェクトの下では、書いたとおりの綴りのキーです: `sales.2024.total`・`usersById.42.name` は `sales["2024"].total`・`usersById["42"].name` を読み書きします —— マークアップ、`this[...]`（getter の中でも）、`$eq`、そのパスを渡した `$resolve` / `$setAll` / `$getAll`、双方向の書き戻し、`$watch` のキーのどれでも同じです。そこへの書き込みは、そのパスやその下のパスを読むバインディングと getter を更新します。`byDay.007` はキー `"007"` を読み、そのようなキーの下の配列はふたたび添字で引きます（`usersById.42.tags.0`）。それ以外（`null`・`undefined`・文字列）への数値の段には行がなく、リストの末尾より先の添字と同じ扱いです。

### getter は state に対して純粋であること

getter のキャッシュを無効化するのは**依存グラフだけ**で、依存グラフに載るのは getter が **`this` を通して読んだもの**だけです。それ以外の入力は無効化から見えないため、**最初に計算した値がそのまま残り続けます**：

```javascript
// ❌ 二度と再計算されない — 依存グラフ上の何も変化しないため
get stamp() { return `${this.label} @ ${Date.now()}`; }   // Date.now() は追跡外
get theme() { return document.body.dataset.theme; }        // DOM は追跡外
get total() { return this.price * exchangeRate; }          // モジュール変数は追跡外
```

規則は「**`this` を通してのみ読む。getter から state を書かない・DOM を触らない**」です。追跡外の入力をどうしても使いたい場合は、その入力を state に持たせてパスに代入する（通常の契約に戻す）か、以下の逃げ道を使ってください：

| API | 用途 |
|---|---|
| `this.$dependOn(path)` | 依存を明示的に追加し、そのパスの変更でこの getter を dirty にする |
| `this.$postUpdate(path)` | 追跡外の入力が変わったことを getter の外から通知する |
| `this.$untracked(fn)` | 依存として登録せずにパスを読む（上の対称） |
| `this.$eq(path, key)` / `$eqPath(path, keyPath)` / `$eqIndex(path)` | 鍵付き購読: 「`path` はこの行の鍵に等しいか」をパターン依存なしで答える（[鍵付き選択](#鍵付き選択eq--eqpath--eqindex)） |

```javascript
// ✅ 時計を state 側で刻み、getter は純粋なまま
export default {
  now: Date.now(),
  get stamp() { return `${this.label} @ ${this.now}`; },
  $connectedCallback() { setInterval(() => { this.now = Date.now(); }, 1000); },
};
```

getter の例外は握り潰されません。評価された場所（バインディングの適用・`$watch` の評価・自分での読み取り）でそのまま表面化します。

#### 依存追跡の境界

依存グラフに何が載るかは 3 つの規則で決まります。踏み越えるまで意識する必要はありませんが、踏み越えたときの症状は「値が更新されなくなる。エラーは出ない」なので、ここにまとめておきます：

| 規則 | 踏み越えたときの見え方 |
|---|---|
| **追跡されるのは `this` を通した *パス* の読み取りだけ。** `this.form` は `form` を、`this["form.name"]` は `form.name` を追跡する。`this.form.name` が追跡するのは **`form` だけ** —— `.name` は返ってきたオブジェクトへの素のプロパティアクセスでしかない。`Date.now()`・DOM・モジュール変数・クロージャで掴んだオブジェクトは何も登録しない | その入力に対して getter は二度と再評価されず、最初の値が残り続ける（上の例）。`this.form.name` を読む getter は、`<input data-wcs="value: form.name">` を編集しても再実行されない —— `this["form.name"]` で読む |
| **setter の中の読み取りは追跡しない。** setter は命令的な代入であって派生ではないので、その中で読んだものは何の依存にもならない | 何を書くかを `this.a` を読んで決める setter は、`a` が変わっても再実行されない。再実行されるのは getter だけ |
| **同値ガードはプリミティブにだけ効く。** 現在値と `Object.is` で等しいプリミティブの書き込みはキューに入る前に落とされる。オブジェクト・配列の書き込みは同じ参照でも必ず通る | 同じ文字列を再代入しても何も起きない。同じオブジェクトを再代入するとバインディングと `$watch` が再発火する（`$behavior.sameValueGuard`。`semantics: "event"` のプロパティはどちらにせよ対象外） |

規則 1 は静的解析で捕まえられる唯一の規則です。getter が `this.form.name` を読んでいて、ドキュメントのどこかで `form.name` を書いている（`value:` バインド・spread・`this["form.name"] = …`）と、`wcs-validate` と VS Code 拡張が `wcs/getter-untracked-read` を報告します。ルートを丸ごと置換するだけの設計（router の params・`$stream` の fold）には出ません。

`$untracked(fn)` は setter の規則を getter に意図的に適用するもので、`fn` の中の読み取りは追跡されません。`$dependOn(path)` は最初の規則に対する逃げ道です。

### 鍵付き選択（`$eq` / `$eqPath` / `$eqIndex`）

「この行は選択中か」を答える行 getter は、依存追跡が最も効きにくい形です。`get "items.*.selected"() { return this.$1 === this.selectedIndex; }` と書くと全行が `selectedIndex` に依存し、1 クリックで 1 万行の getter が再評価されます。鍵付きの形は各行を **その行自身の鍵** の下に購読させ、パスへの書き込みでは「選択されていた行」と「選択される行」だけを再評価します：

| API | 鍵 | 選択の付き先 | 備考 |
|---|---|---|---|
| `this.$eq(path, key)` | 任意の値 | 鍵 | `path` は依存を張らずに読み、行は `key` の下に登録される |
| `this.$eqPath(path, keyPath)` | `keyPath` の値（ワイルドカードはこの行で解決） | id | 鍵も依存を張らずに読むので、リストの置換や並べ替えで行が再評価されない |
| `this.$eqIndex(path, level = 1)` | この行の index（`$1`。`level` でワイルドカード段を選ぶ） | index | `$1` を読む場合と違い getter を **index 依存に記録しない**: 行の移動はリスト差分が鍵を付け替えるので、1 行削除で再評価されるのは高々 2 行 |

```javascript
export default {
  items: [],
  selectedId: null,
  selectedIndex: null,
  // id による選択: 並べ替えや削除をまたいで同じ行に付いて行く
  get "items.*.selected"() { return this.$eqPath("selectedId", "items.*.id"); },
  // 位置による選択: 同じ仕事量で index に付く
  get "items.*.current"() { return this.$eqIndex("selectedIndex"); },
  onSelect(e, $1) { this.selectedId = this["items." + $1 + ".id"]; this.selectedIndex = $1; },
};
```

規則: `$eq` と `$eqPath` は getter の中で評価されれば購読を張ります — 行の getter でも、`get isAdmin() { return this.$eq("role", "admin"); }` のようなトップレベルの getter でも同じです。メソッドやハンドラから呼ぶと比較結果を返すだけです。`$eqIndex` にはリスト行が要ります: 行の外では `$eqIndex("…") needs a list row scope.` を投げ、その深さにリストの index が無い `level` でも投げます。行の購読はリスト差分がその行を外した時点で落ちます。鍵の比較は `Object.is` ですが、Map の意味論により `+0` と `-0`、`NaN` 同士は同じ鍵になります。`$eqPath` は鍵を依存なしで読むので、行の鍵がその場で書き換わっても行は再評価されません — 変わらない同一性（id）に使い、鍵自体が動く場合は追跡付きの読みと `$eq` を組み合わせてください。

行に届くもの:

- **`path` への書き込み** — オブジェクトを含むどんな値でも（`$eq("selected", this["items.*"])` に対する `this.selected = row`）: 選ばれていた行と、新たに選ばれる行。
- **`path` より上のオブジェクトへの書き込み** — `$eq("sel.id", …)` に対する `this.sel = { id: 2 }`: 同じく 2 行。旧いオブジェクトの下と新しいオブジェクトの下で `path` が持つ値を鍵にします。
- **`path` が getter か getter の配下**（`get current()` に対する `$eq("current.id", …)`）: 値が書き込みなしに変わるので、依存を張る普通の読み取りに戻ります。選択は正しく保たれますが、変化のたびに全行が再評価されます（鍵付きの形を使わないのと同じ）。2 行で済ませるには、`path` を書き込まれる state（`selectedId`）に向けてください。`@wcstack/devtools` の State ペインは、path ごとの購読の数を **Keyed selection** に出します。この形に落ちた path は購読を持たないので、そこには載りません。
- **リストの中の `path`** —— ワイルドカード（`$eq("items.*.v", …)`）か数値の添字（`$eq("items.0.v", …)`）: `$eq` / `$eqPath` が鍵で購読できるのはリストの外のパスだけなので、この形も依存を張る普通の読み取りに戻り、その行の `v` への書き込み・要素の差し替え・リストの差し替えに追従します（getter と同じく、別の行の `v` への書き込みでも再評価されます）。
- **型変換はしません:** `"2"` は id `2` に一致しません。`<input>` や `<select>` は文字列を書くので、入口で変換する（`value|number: selectedId`）か、id を文字列で持ってください。
- **スコープの中では `path` は相対**です — パスを取る他の `$` API と同じです。マウントされたコンポーネント（`bind-component`）とボリューム（`<wcs-state mount="cart">`）では、`$eq("selectedId", …)`・`$eqPath` の 2 つのパス・`$eqIndex`・`$dependOn` はどれもそのスコープ（`cart.selectedId`）に解決され、ルートには向きません。`$untracked` はコールバックを取るので翻訳の対象外です。

### ループインデックス変数（`$1`, `$2`, ...）

getter やイベントハンドラ内で、`this.$1`、`this.$2` などで現在のループイテレーションのインデックスを取得できます（0始まりの値、1始まりの命名）：

```javascript
export default {
  users: ["Alice", "Bob", "Charlie"],
  get "users.*.rowLabel"() {
    return "#" + (this.$1 + 1) + ": " + this["users.*"];
  }
};
```

```html
<template data-wcs="for: users">
  <div data-wcs="textContent: .rowLabel"></div>
</template>
<!-- 出力:
  #1: Alice
  #2: Bob
  #3: Charlie
-->
```

ネストループでは、`$1` が外側のインデックス、`$2` が内側のインデックスです。

テンプレート内でループインデックスを直接表示することもできます：

```html
<template data-wcs="for: items">
  <td>{{ $1|add(1) }}</td>  <!-- 1始まりの行番号 -->
</template>
```

### Proxy API

状態オブジェクト内（getter / メソッド）で `this` 経由で以下の API が利用できます：

| API | 説明 |
|---|---|
| `this.$getAll(path, indexes?)` | ワイルドカードパスにマッチする全ての値を取得 |
| `this.$setAll(path, indexes, value, options?)` | ワイルドカードパスにマッチする全アドレスへ一括書き込み |
| `this.$resolve(path, indexes, value?)` | ワイルドカードパスを特定のインデックスで解決 |
| `this.$postUpdate(path)` | 指定パスの更新通知を手動で発行 |
| `this.$dependOn(path)` | キャッシュ無効化のための依存関係を手動で登録 |
| `this.$untracked(fn)` | fn 実行中の依存追跡を抑止して値を読む |
| `this.$eq(path, key)` / `$eqPath(path, keyPath)` / `$eqIndex(path, level?)` | 鍵付き購読: 「`path` の値はこの行の鍵か」（[鍵付き選択](#鍵付き選択eq--eqpath--eqindex)） |
| `this.$command.<name>` | `$commandTokens` で宣言した `CommandToken` へのアクセス（[Command Token](#command-tokenメソッドバインディング) 参照） |
| `this.$stateElement` | `IStateElement` インスタンスへのアクセス |
| `this.$1`, `this.$2`, ... | 現在のループインデックス（1始まりの命名、0始まりの値） |

#### `$getAll` — 配列要素全体の集計

`$getAll` はワイルドカードパスにマッチする全ての値を配列として収集します。集計パターンに不可欠です：

```javascript
export default {
  scores: [85, 92, 78, 95, 88],
  get average() {
    const all = this.$getAll("scores.*", []);
    return all.reduce((sum, v) => sum + v, 0) / all.length;
  },
  get max() {
    return Math.max(...this.$getAll("scores.*", []));
  }
};
```

`indexes` はパスの `*` に対する**前方一致の接頭辞**です。不足した階層は全展開され、`[]` は常に「マッチ全件」を意味します。**省略**した場合はループ文脈の添字（`[$1, $2, ...]`）が既定になり、パスが文脈と共有するワイルドカード階層に敷かれます：

```javascript
export default {
  regions: [ /* { prefectures: [ { population: … }, … ] } */ ],
  // ループ文脈 [$1] — 省略すると現在の地方に絞られる
  get "regions.*.total"() {
    return this.$getAll("regions.*.prefectures.*.population").reduce((a, b) => a + b, 0);
  },
  // ループ文脈なし — 省略は全展開（[] と同じ）
  get grandTotal() {
    return this.$getAll("regions.*.total").reduce((a, b) => a + b, 0);
  }
};
```

文脈がパスより深い分は切り詰められます（`[$1, $2]` の文脈は `*` 1 本のパスを `[$1]` で絞ります）。一方、文脈がループ添字を持っているのにパスと**ワイルドカード階層をまったく共有しない**場合 —— たとえば `regions.*` の getter 内での `$getAll("users.*.name")` —— は、黙って全 users を読む代わりに **throw** します。文脈の添字は別のリストのものであり、流用しても無視しても書き手の意図とは食い違うためです。この形では添字を明示してください（全件なら `[]`）。

#### `$setAll` — 配列要素を作り直さずに一括更新

`$setAll` は `$getAll` の書き側の対称形で、ワイルドカードパスにマッチする全アドレスへ書き込みます。狙いは記述の短さではなく、**配列そのものを保つ**ことです。`this.users = this.users.map(...)` のように作り直すとリストの添字・行 getter のキャッシュ・差分描画がまとめて捨てられますが、`$setAll` は行ごとの in-place な書き込みに分解するのでリストの同一性が保たれます。

```javascript
export default {
  users: [{ selected: false }, { selected: false }],

  toggleAll(e) {
    this.$setAll("users.*.selected", [], e.target.checked);   // ブロードキャスト
  },
  invertAll() {
    this.$setAll("users.*.selected", [], cur => !cur);        // mapper
  },
  rankTopThree() {
    // undefined を返したアドレスはスキップされる（＝この行は変えない）
    this.$setAll("users.*.score", [], (cur, i) => i < 3 ? cur * 2 : undefined);
  }
};
```

形は 3 つあり、3 番目だけは明示的に要求する必要があります。

| 第 3 引数 | 意味 |
|---|---|
| 関数 | **mapper** — マッチしたアドレスごとに `(current, ...indexes)` で呼ばれる |
| それ以外 | **ブロードキャスト** — 配列も含め、同じ値が全アドレスに書かれる |
| 配列 ＋ `{ spread: true }` | **spread** — マッチ順に 1 件ずつ配る |

配列が既定でブロードキャストされるのは、対象プロパティ自体が配列型でありうるためです。`$setAll("users.*.tags", [], ["admin"])` は「全員に `["admin"]`」なのか「1 人目に `"admin"`」なのか判別できません。`{ spread: true }` を明示すればこの推測が消え、長さがマッチ件数と噛み合わなければ黙って誤配せずに throw します。

`indexes` の意味は `$getAll` と同じ**前方一致の接頭辞**（不足はその階層を全展開）ですが、**省略はできません**。書き込みには暗黙のループ文脈を与えないため、`for` テンプレートの中でも `this.$setAll("users.*.selected", [], true)` は現在行ではなく**全行**を意味します。

```javascript
this.$setAll("matrix.*.*", [0], 0);                    // 0 行目だけ全列
this.$setAll("users.*", [], rows, { spread: true });   // 配列を保ったまま各行を差し替え
```

`undefined` はどの形でも書き込まれず「このアドレスはスキップ」を意味します。mapper が `return` を忘れて全行を潰す事故を防ぐためで、クリアしたい場合は `null` を使います。戻り値は実際に書き込んだ件数です。

なお `$setAll` は依存解決を一括化する仕組みではありません。描画は 1 バッチに畳まれますが、書き込みは 1 件ずつ登録されるので、コストは置き換え対象の手書きループと同じです。得られるのはリストが保たれることであって、実行回数の削減ではありません。

#### `$resolve` — 明示的なインデックスでのアクセス

`$resolve` は特定のワイルドカードインデックスの値を読み書きします。**読みか書きかは引数の個数で決まります**: `$resolve(path, indexes)` は読み、`$resolve(path, indexes, value)` は `value` の書き込みで、`undefined` も書きます。readonly のプロキシでは、この書き込みは直接代入と同じく `This state is readonly.` で throw し、`$setAll` も同じです。リストの末尾より先の添字は `undefined` と読め、そこへの書き込みは `no row for "items.*"` を throw して何も変えません。

**要素への書き込みは、その位置の値を置き換えます。** その位置の行は `$1` ごとその場にとどまって新しい値を受け取ります: バインディングがその値を表示し、行の下で派生するものはすべて計算し直されます。バインディングが持たない DOM の状態 —— フォーカス、バインドしていない input に入力中のテキスト、`<details>` の開閉 —— は位置に残ります。そのため、行にバインドした input（`value: .`）は入力中もフォーカスを保ち、自分の行に書く行内の要素（`value: .`、`status: .` でバインドした wc-bindable の出力）の書き込みは、その行に届き続けます。行を**値ごと**動かすには、新しい配列を代入してください: 行は新しい配列の要素と同一性で照合されるので、オブジェクトと一緒に動きます。

```javascript
export default {
  items: [{ name: "A" }, { name: "B" }, { name: "C" }],
  // ✅ 2 つの行が DOM ごと入れ替わる
  swapFirstTwo() {
    const items = this.items.slice();
    [items[0], items[1]] = [items[1], items[0]];
    this.items = items;
  },
  // 値が入れ替わり、行はその場にとどまる
  swapValues() {
    const a = this.$resolve("items.*", [0]);
    const b = this.$resolve("items.*", [1]);
    this.$resolve("items.*", [0], b);
    this.$resolve("items.*", [1], a);
  }
};
```

**同じオブジェクトが 2 つの位置にあるとき。** リストの 2 つの位置に同じオブジェクトがあると（`items: [o, o, …]`）、片方の行の下のキーへの書き込み（`this["items.0.name"] = "z"`）でオブジェクトは変わりますが、もう片方の行のバインディングと行 getter は古い値を表示し続けます: 書き込みはそれを通した行にしか届かないためです。素の読み取り・ルートの getter・`$getAll` には新しい値が見えます。1 つのオブジェクトが 2 つのリストから到達できる場合も同じことが起きます。TodoMVC 風の絞り込み —— `todos` を絞り込んだコピーを返す `get shown()` を `for: shown` で描画し、チェックボックスがその行に書き込む場合です。こうした書き込みの後に `$postUpdate("items")` を呼ぶと、そのリストのすべての行がオブジェクトを表示し直します。これはこのバージョンの既知の制約です。

## 再帰パス（`$recursion`）

パスは深さを文字列に焼き付けます。`nodes.*.children.*.total` はワイルドカードちょうど 2 段のパスであり、木が 1 段深くなっても 3 段には伸びません。しかし木の深さはコードではなく**データの性質**です。`$recursion` はこの隔たりを埋めます。形が繰り返す場所を宣言し、あとは「いま何段目であれ」を `**` と書きます。

```javascript
export default {
  $recursion: { "nodes.*": "children.*" },   // アンカー → 反復サブパス

  nodes: [
    { value: 1, selected: false, children: [
      { value: 10, selected: false, children: [
        { value: 100, selected: false, children: [] }
      ]},
      { value: 20, selected: false, children: [] }
    ]},
    { value: 2, selected: false, children: [] }
  ],

  // getter は 1 本で全深さぶん。`**` は評価されている深さに束縛される
  get "nodes.**.total"() {
    return this["nodes.**.value"]
         + this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0);
  },

  // 木全体の集計。`[]` は全深さの合併
  get treeTotal() {
    return this.$getAll("nodes.**.value", []).reduce((a, b) => a + b, 0);
  },

  clearSelection() {
    this.$setAll("nodes.**.selected", [], false);
  }
};
```

この森の total は `131 / 110 / 100 / 20 / 2`、`treeTotal` は `133` になります。

**`**` はオーサリング層だけの記号で、エンジンには決して降りません。** 具体パス（`nodes.*.children.*.total`）を読んだ時点で、その深さの getter が遅延実体化されます（実際に触れた深さのぶんだけアクセサが生えます）。その先 —— パスパターン、依存グラフ、`$1`…`$n`、`$resolve`、リスト差分 —— が見るのは、いつもどおりワイルドカード本数が固定された普通のパスです。リアクティブの中核は新しい形を覚えていません。

### 再帰点を宣言する

`$recursion` は 1 つの**アンカー**を、1 段深くする**反復サブパス**へ対応づけます。どちらも「固定プロパティ列 + 末尾の `.*`」の形で、リストそのものではなくリストの**要素**を名指します：

```javascript
$recursion: { "nodes.*": "children.*" }     // nodes[i].children[j].children[k]…
$recursion: { "data.tree.*": "kids.*" }     // 深い位置のアンカーも可
$recursion: { "nodes.*": "nodes.*" }        // 自己相似な綴りも可
```

`**` に意味を与えるのはこの宣言だけです。`$recursion` の無い state では `**` はパスの文字ですらなく（`wcs/recursion-unsupported`）、この記法が子孫検索へ黙って滑り落ちることはありません。このバージョンが受け付けるのは **state ごとに単一の自己再帰アンカー**です。アンカーの途中のワイルドカード、2 つ目のエントリ、2 つのアンカー間の相互再帰、1 本のパスに 2 つ目の `**`、`get "nodes.**"`（これはノード自身であって、ノード配下の計算パスではありません）、接尾辞が構造そのものを名指す `**` getter（`get "nodes.**.children"()` / `.children.*` / `.children.length` —— 全深さで実データの子リストを影にしてしまいます）、同じ具体パスへ展開される 2 本の `**` getter、そして再帰 **setter** は、宣言を読んだ時点で拒否します —— 別の意味に解釈することはありません。このうち 3 つの検査 —— 接尾辞が構造を名指す getter、同じ具体パスへ展開される 2 本の getter、展開形と同名の具体 getter —— は `diagnostics` アドオン（全部入りのエントリに含まれる）が行います。それを入れていない `/core` のページでは行われません。

宣言が定義する族は無限ですが、state に生えるのは実際に要求された深さだけです：

```
k=0   nodes.*
k=1   nodes.*.children.*
k=2   nodes.*.children.*.children.*
```

### `**` はどこで何を意味するか

`**` は深さを表す変数で、**束縛**されるか**合併**されるかは文脈が決めます。これは新しい規則ではなく、`*` が既に持っている「現在行」と「全行」の書き分けをそのまま継いだものです：

| `**` が現れる場所 | 意味 |
|---|---|
| getter のキー（`get "nodes.**.total"()`） | 評価されている深さに束縛 |
| その getter 本体でのパス読み（`this["nodes.**.value"]`） | 同じ深さに束縛 |
| `$getAll(path)`（添字**省略**） | その深さに束縛。展開されるのは `**` より**後ろ**のワイルドカードだけ |
| `$getAll(path, [])`（**明示**） | **全深さの合併** —— 深さ優先・行きがけ・添字昇順 |
| `$getAll(path, [i, …])` | 拒否。接頭辞ではどの深さの話か言えない（`wcs/recursion-getall-form`） |
| `$setAll(path, [], value)` | 全深さへのブロードキャスト（合併と同じ走査・同じ順序） |
| `$resolve` / `$postUpdate` / `$dependOn` / `$watch` のキー / `$listKeys` のキー / markup の `data-wcs` / 直接代入 | 拒否（`wcs/recursion-unsupported`） |

束縛形は束縛先の深さを必要とするので、**再帰 getter の中**でしか解決できません（アンカー配下の普通の行 getter や、その行に紐づくイベントハンドラも同じく、深さを読み取れる実体の行について実行されるので使えます）。トップレベルで `this["nodes.**.value"]` を読むと `wcs/recursion-context` になります —— どのノードのつもりだったかを黙って推測することはありません。深さは行の添字と同じく**最も内側の評価フレームだけ**から読みます。再帰 getter が呼ぶ普通の getter（`get "nodes.**.x"() { return this.helper }` と `get helper() { return this["nodes.**.value"] }`）は自分の行を持たないので、これも `wcs/recursion-context` になります —— `**` は再帰 getter の側で読み、値を渡してください。合併形は深さを要求しないので、トップレベルの getter でも普通の行 getter でもメソッドでも読めます。

```javascript
this.$getAll("nodes.**.value", []);   // [1, 10, 100, 20, 2] —— 深さ優先・行きがけ
```

`**` より**後ろ**の `*` は、各ノードで固定本数のパスと同じ順に展開し、そのノードの分を出し切ってから子へ降ります。上の木のノードに `tags` があるとき（`1` → `[3, 4]`、`10` → `[5]`、`20` → `[7]`、他は空）：

```javascript
this.$getAll("nodes.**.tags.*.v", []);   // [3, 4, 5, 7] —— ノード 1 の tags、次にノード 10 の、次にノード 20 の
```

### 孫を二重に数えない集計

木を畳むのは再帰 getter なので、この書き分けが集計の成否そのものになります：

```javascript
// ✅ 省略 —— この深さに束縛されるので、直下の子だけを合計する
get "nodes.**.total"() {
  return this["nodes.**.value"]
       + this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0);
}

// ❌ `[]` —— 全深さの子 total。各ノードの total が自分の子孫の total を再び含み、
//    getter が自分自身を要求することになる。実際には誤った値ではなく
//    `wcs/getter-cycle` になる。
get "nodes.**.total"() {
  return this["nodes.**.value"]
       + this.$getAll("nodes.**.children.*.total", []).reduce((a, b) => a + b, 0);
}
```

同じ間違いを再帰の**外側**でやると、こちらは静かです。踏む循環が無く、もっともらしい大きすぎる値が返るだけになります。集計値の合併は、孫を「親の total の内訳」として 1 回、「合併の要素」としてもう 1 回数えます：

```javascript
// ❌ 363 —— 全ノードの total を合併しているが、total は既に部分木を含んでいる
get treeTotalWrong() {
  return this.$getAll("nodes.**.total", []).reduce((a, b) => a + b, 0);
}
// ✅ 133 —— 生の値を合併する
get treeTotal() {
  return this.$getAll("nodes.**.value", []).reduce((a, b) => a + b, 0);
}
// ✅ 133 —— あるいはルートだけを足す（各ルートの total が既に部分木を畳んでいる）
get treeTotalFromRoots() {
  return this.$getAll("nodes.*.total", []).reduce((a, b) => a + b, 0);
}
```

**合併するのは生の値か、さもなくばルートだけを足すこと。自分の部分木を既に集計している値を合併してはいけません。** 二重計上かどうかはパス文字列からは決定できないので、これを捕まえると約束する診断はありません。

### 書き込みはブロードキャストのみ

再帰 `$setAll` が受け付けるのは `[]` ＋ 素の値という 1 つの形だけで、戻り値は書き込んだアドレスの件数です（上の森なら 5）：

```javascript
this.$setAll("nodes.**.selected", [], false);   // 全深さの全ノード
```

それ以外の形は、走査が 1 件でも書く**前に**拒否します。拒否された呼び出しは木を一切変更しません。この保証は**形**の検査についてのもので、添字綴りの葉（`nodes.**.children.0.value`）は**データ**の条件で途中で止まることがあります —— `children` が空のノードには書き込む子 `0` が無いためで、固定本数の `$setAll("nodes.*.children.0.value", [], v)` と同じ振る舞いです：

| 形 | 拒否する理由 |
|---|---|
| 非空の接頭辞 | 接頭辞ではどの深さに適用されるのか言えない（`wcs/recursion-setall-form`） |
| 添字の省略 | 書き込み API は文脈を取らないので束縛する深さが無い —— `[]` を渡す（`indexes` の無い `$setAll` と同じく `#9`） |
| mapper 関数 | `(current, ...indexes)` の添字の本数が深さごとに変わる（`wcs/recursion-setall-form`） |
| `{ spread: true }` | 1 次元配列を木へ配るには作者が走査順を知っている必要があり、契約として使えない（`wcs/recursion-setall-form`） |
| `nodes.**` / `nodes.**.children` / `nodes.**.children.*` / `nodes.**.children.length` —— 反復サブパスが多段（`branch.children.*`）なら、子リストへ至る途中の `nodes.**.branch` も。添字綴りも同じ形に畳まれるので `nodes.**.children.0` は子ノード | 構造そのものへの書き込み（`length` への代入はリストを切り詰める）は、その書き込み自身が確定済みの子アドレスを壊す（`wcs/recursion-structural-write`） |
| `nodes.**.total`、およびその値の内側を指すパス —— 子ノードのパスも同じ形に畳まれるので `nodes.**.children.0.total` と `nodes.**.children.*.total` も getter。子ノードの下に宣言した getter（`get "nodes.**.children.*.x"`）があれば `nodes.**.x` も拒否する | 再帰 getter に setter は無い。導出元を書く（`wcs/recursion-readonly`） |

それ以外は葉です。子ノードの下の葉もそうで、`$setAll("nodes.**.children.*.value", [], v)` は各ノードの子の `value`（根以外のすべてのノード）に書き込みます。

読み取り専用の規則は `**` の綴りに依存しません。再帰 getter の具体的な展開形 —— `nodes.*.total` / `nodes.*.children.*.total` / … —— への書き込みも、固定本数の `$setAll` でも値付きの `$resolve(path, indexes, value)` でも直接代入でも、またその深さが実体化済みかどうかに関わらず、書き込みの入口で拒否します。この検査が無かったときは、未実体化の展開形が「無いキー」に見えてノードのオブジェクトに書き込まれ、代入値が getter のキャッシュ結果として固定されていました。

### 入力は木でなければならない

走査は深さ方向に降りながら、必要な形をその場で検査します。**同じ配列インスタンス**に 2 度到達したら拒否します。その配列が現在のノードの祖先のものなら循環（`wcs/recursion-cycle`）、そうでなければ 2 つのノードが 1 本の子リストを共有しています（`wcs/recursion-shared-list`）。各ノードに自分の `children` 配列を持たせてください —— **空**配列の使い回しは行を持たず別名化のしようがないので、追跡もせず正当です。

行オブジェクトを作り直して `children` 配列を引き継ぐ置換 —— `this.nodes = this.nodes.map(n => ({ ...n }))` —— はふつうの更新で、集計もそのまま追従します。

再帰の走査の外では、行が 1 本の配列を共有してもかまいません（走査は上のとおりそれを拒否します）。同じ配列インスタンスを持つリストはどれも、そのうちのどれを通した書き込みも表示します —— `groups.0.items.1` の下への書き込みは、`groups.2.items.1` も同じ配列を（同じキーでも別のキーでも）持っていれば、そこにも届きます。1 つのオブジェクトに*別々の*配列を通して到達する場合（共有配列のコピー、絞り込んだコピーを返す getter）は、[同じオブジェクトが 2 つの位置にあるとき](#resolve--明示的なインデックスでのアクセス) で説明した既知の制約です。

上限は展開後のパスの**ワイルドカード 128 段**です。上の集計 getter は評価中のノードより 1 段下を読むので、127 段の鎖までは畳めて、128 段で `wcs/recursion-depth-exceeded` になります（アンカー・到達した深さ・組み立てようとしたパス・上限を名指しします）。この検査は getter 評価スタック自身の 128 段の上限（`wcs/getter-depth-exceeded`）より先に効くので、深い木は「深い」と報告され、循環の疑いを掛けられることはありません。途中で打ち切ることもしません —— 部分的な集計は、誤った値を正しい値として返すことだからです。

### 木を描画する

`**` は markup には書けず、再帰 `<template>` もありません。木は**自己参照コンポーネント**で描画します —— 子ごとに自分自身を shadow の中でマウントするカスタム要素 1 つです。各スコープの中で使うパスは常に 1 段だけ（`node.children.*`）なので markup が深さに依存せず、`node.total` はマウントを通ってルート state の再帰 getter に解決されるので、各ノードが自分の部分木の集計を表示できます。

```html
<!-- ホスト側 -->
<template data-wcs="for: nodes">
  <tree-node data-wcs="state.node: nodes.*"></tree-node>
</template>
```

```javascript
const markup = `
  <wcs-state bind-component="state"></wcs-state>
  <span data-wcs="textContent: node.label"></span>
  <span data-wcs="textContent: node.total"></span>
  <template data-wcs="for: node.children">
    <tree-node data-wcs="state.node: node.children.*"></tree-node>
  </template>`;

customElements.define("tree-node", class extends HTMLElement {
  state = {};                            // ← `node` を自分で持たない（マウントから届く）
  constructor() { super(); this.attachShadow({ mode: "open" }); }
  connectedCallback() {                  // ← shadow は constructor ではなくここで組む
    if (this.shadowRoot.childNodes.length === 0) this.shadowRoot.innerHTML = markup;
  }
});
```

ここには 2 つの罠があり、どちらも実際に踏んだものです：

- **コンポーネントの `state` に、マウント先と同名のキーを置かないこと。** 無関係なメソッドや私有キーは構いませんが、自分の `node` を持つとマウントを隠し、子は自分の既定値を表示したまま一段も降りません（実行時に `wcs/mount-own-key-shadow` で名指されます）。
- **shadow は constructor ではなく `connectedCallback` で組むこと。** constructor で `innerHTML` を入れると、`<template>` の中身を inert に保たない実装ではその中の要素まで upgrade され、自己参照コンポーネントは自分の constructor の中で無限再帰します。実ブラウザは通ってしまうので、素直なクラッシュではなく環境依存の地雷になります。

深さが固定なら、ここまでは要りません。展開後のパスは普通のパスなので、入れ子の `for` テンプレートから `nodes.*.total` や `nodes.*.children.*.total` を他と同じようにバインドできます。

### このバージョンに含まれないもの

以下はいずれも診断になります。黙って別の意味に解釈されることはありません。

- 複数アンカー、相互再帰、アンカー途中のワイルドカード、1 本のパスに 2 つ目の `**`
- 再帰 setter、接尾辞が構造そのものを名指す `**` getter（`get "nodes.**.children"()`）、`**` getter の展開形と同名の具体 getter、そして代入による `**` 経由の書き込み（`this["nodes.**.x"] = v`、`++` も含む）
- 再帰 `$setAll` の mapper・`{ spread: true }`・添字省略・非空の接頭辞・配列でない `indexes`。書き込み API には深さを束縛する評価文脈が無いので、`[]` は必須です
- 再帰 `$getAll` の非空の接頭辞・配列でない `indexes`。**添字省略は正当です** —— 再帰 getter の中では束縛形で、評価中の深さを読みます
- `data-wcs` / `$watch` や `$listKeys` のキー / `$resolve` / `$postUpdate` / `$dependOn` への `**`
- ボリューム（`mount=`）やマウントされたコンポーネント（`bind-component`）の `$recursion` と `**` getter —— ルートの state に置きます
- 再帰 `<template>`、`$depth` 変数、公開の `maxDepth` オプション（3 つとも存在しません）

## イベントハンドリング

`on*` プロパティでイベントハンドラをバインドします：

```html
<button data-wcs="onclick: handleClick">クリック</button>
<form data-wcs="onsubmit#prevent: handleSubmit">...</form>
```

ハンドラメソッドはイベントとループインデックスを受け取ります：

```javascript
export default {
  items: ["A", "B", "C"],
  handleClick(event) {
    console.log("clicked");
  },
  removeItem(event, index) {
    // index はループコンテキスト ($1)
    this.items = this.items.toSpliced(index, 1);
  }
};
```

```html
<template data-wcs="for: items">
  <button data-wcs="onclick: removeItem">削除</button>
</template>
```

ハンドラの中の `this` は書き込み可能な state です。ドットを含む名前はパスです: `onclick: cart.checkout` は `cart` にマウントされたボリュームのメソッドを呼びます。throw したハンドラや、reject する Promise を返したハンドラは `console.error` で報告され、イベントには影響しません。

### 委譲されるイベント

`click`・`dblclick`・`input`・`change`・`submit`・`keydown`・`keyup`・`mousedown`・`mouseup`・`pointerdown`・`pointerup` の `on*:` バインディングは**委譲**されます: イベント種別ごとに 1 つのリスナーが、state がバインドするルート —— document、shadow root、あるいは Light DOM のマウントされたコンポーネントの中ではホスト要素 —— に置かれ、イベントが通過した要素のハンドラを内側から順に実行します。そのため:

- ハンドラの中の `event.currentTarget` は要素ではなく、そのルートです。要素は `event.target` から探すか（`event.target.closest("li")`）、ハンドラが受け取るループインデックスを使ってください（`removeItem(event, index)`）。
- 内側の `on*:` バインディングの `#stop` は、それより外側の `on*:` ハンドラを止めます。自分のコードが祖先に付けたリスナー（クリックできるカードへの `addEventListener`）は止められません: そのリスナーは、イベントがルートに届く前に実行済みです。
- 自分のコードが祖先で `stopPropagation()` を呼ぶと（モーダルの中身がオーバーレイにクリックを渡さないようにする場合など）、その内側の委譲されたハンドラはまったく実行されません。
- 別のルートの下へ移した要素（shadow root から `document.body` へ移したダイアログ）では、委譲されたハンドラはもう実行されません。
- 1 つの要素に同じ種別のハンドラが 2 つあれば（`onclick: a; onclick: b`）、どちらも実行されます。DOM と同じく、1 つ目の `#stop` は 2 つ目を止めません。

それ以外のイベント種別と、カスタム要素が `bubbles: false` で dispatch するイベントは、要素自身で受け取ります。双方向バインディング（`value:`・`checked:`・`radio:`・`checkbox:`）と `eventToken.` バインディングは、リスナーを要素に置いたままです。

### `#direct`

`on*#direct:` は、リスナーを委譲せずに要素自身に付けます: `currentTarget` は要素で、`#stop` は祖先に自分で付けたリスナーを止め、祖先の `stopPropagation()` に実行を妨げられず、要素が別のルートの下へ移った後も実行されます。`#prevent`・`#stop` と組み合わせられ、`for:` / `if:` の中では行ごとに付けられ、行とともに外されます。

```html
<!-- 自分のコードがクリックリスナーを付けたカードの中のボタン -->
<button data-wcs="onclick#direct,stop: save">保存</button>
```

ハンドラは DOM が置く場所で実行されます。外側の `#direct` ハンドラは、その内側の委譲されたハンドラより**先に**実行されます。委譲されたハンドラは、イベントが外側の要素を通過した後にルートで実行されるからです。そのため、内側の `#stop` が外側の `#direct` ハンドラを止められるのは、内側のバインディングも `#direct` の場合（`onclick#direct,stop:`）だけです。イベントバインディングでないバインディングの `#direct` は何もしません（`@wcstack/lint` が警告します）。

## フィルタ

47 種類の組み込みフィルタが入力（DOM → 状態）と出力（状態 → DOM）の両方向で利用できます: core に 24 個のロジックフィルタ（比較・算術・型変換・真偽値 / デフォルト）、`formats` アドオンに 23 個の書式フィルタ（数値フォーマット・文字列・日付 / 時刻）があり、全部入りのエントリには両方が含まれます。

3.x が 3.2 の改名の別名として残していた名前（`inc`・`dec`・`fix`・`uc`・`lc`・`cap`・`rep`・`rev`・`pad`・`null`）と `substr` フィルタは存在しません: 未知の名前と同じく失敗し、メッセージが代わりに書くものを示します（`"uc" was renamed "upper" in 3.2 and removed in 4.0 — write "upper".`。`substr(start, length)` は `slice(start, start + length)`）。

### 比較

| フィルタ | 説明 | 例 |
|---|---|---|
| `eq(value)` | 等しい | `count\|eq(0)` → `true/false` |
| `ne(value)` | 等しくない | `count\|ne(0)` |
| `not` | 真偽性を反転 — `0` / `""` / `null` / `undefined` はすべて `true` | `isActive\|not` |
| `lt(n)` | より小さい | `count\|lt(10)` |
| `le(n)` | 以下 | `count\|le(10)` |
| `gt(n)` | より大きい | `count\|gt(0)` |
| `ge(n)` | 以上 | `count\|ge(0)` |

### 算術

| フィルタ | 説明 | 例 |
|---|---|---|
| `add(n)` | 加算 | `count\|add(1)` |
| `sub(n)` | 減算 | `count\|sub(1)` |
| `mul(n)` | 乗算 | `price\|mul(1.1)` |
| `div(n)` | 除算 | `total\|div(100)` |
| `mod(n)` | 剰余 | `index\|mod(2)` |
| `abs` | 絶対値 | `delta\|abs` |
| `clamp(min, max)` | 範囲内に丸める | `ratio\|clamp(0,100)` |

### 数値フォーマット

| フィルタ | 説明 | 例 |
|---|---|---|
| `toFixed(n?)` | 固定小数点桁数（既定 0） | `price\|toFixed(2)` → `"100.00"` |
| `round(n?)` | 四捨五入 | `value\|round(2)` |
| `floor(n?)` | 切り捨て | `value\|floor` |
| `ceil(n?)` | 切り上げ | `value\|ceil` |
| `locale(loc?)` | ロケール数値フォーマット | `count\|locale` / `count\|locale(ja-JP)` |
| `percent(n?)` | パーセンテージフォーマット | `ratio\|percent(1)` |
| `unit(u)` | 単位（任意の接尾辞）を付加 | `width\|unit(px)` → `"40px"` |

### 文字列

| フィルタ | 説明 | 例 |
|---|---|---|
| `upper` | 大文字変換 | `name\|upper` |
| `lower` | 小文字変換 | `name\|lower` |
| `capitalize` | 先頭大文字 | `name\|capitalize` |
| `trim` | 空白除去 | `text\|trim` |
| `slice(start, end?)` | 文字列スライス（`end` は長さではなく位置） | `text\|slice(5)` / `code\|slice(2,5)` |
| `padStart(n, char?)` | 先頭を埋める（既定 `0`） | `id\|padStart(5,0)` → `"00001"` |
| `padEnd(n, char?)` | 末尾を埋める（既定は空白） | `code\|padEnd(8)` |
| `repeat(n)` | 繰り返し | `text\|repeat(3)` |
| `reverse` | 反転 | `text\|reverse` |
| `truncate(n, suffix?)` | 切り詰めて省略記号を付加（既定は `…` — U+2026 の 1 文字） | `title\|truncate(20)` |
| `join(sep?)` | 配列を連結（既定 `", "`） | `tags\|join` / `tags\|join(/)` |

### 型変換

| フィルタ | 説明 | 例 |
|---|---|---|
| `int` | 整数パース | `input\|int` |
| `float` | 浮動小数点パース | `input\|float` |
| `boolean` | 真偽値に変換 | `value\|boolean` |
| `number` | 数値に変換 | `value\|number` |
| `string` | 文字列に変換 | `value\|string` |
| `nullIfEmpty` | 空文字を `null` にする（それ以外はそのまま） | `value\|nullIfEmpty` |

### 日付 / 時刻

| フィルタ | 説明 | 例 |
|---|---|---|
| `date(loc?)` | 日付フォーマット | `createdAt\|date` / `createdAt\|date(ja-JP)` |
| `time(loc?)` | 時刻フォーマット | `createdAt\|time` |
| `datetime(loc?)` | 日付 + 時刻 | `createdAt\|datetime(en-US)` |
| `ymd(sep?)` | YYYY-MM-DD（既定は `-`） | `createdAt\|ymd` / `createdAt\|ymd(/)` |
| `hms(sep?)` | HH:MM:SS（既定は `:`） | `createdAt\|hms` / `createdAt\|hms(-)` |

**5 つとも `Date` を取ります**（タイムスタンプではありません）。他の型は「requires a date value」で拒否されます。JSON から読み込んだ state は数値か ISO 文字列を持つので、束縛ではなく読み出し側で変換してください: `get createdAt() { return new Date(this.createdAtMs); }`。`loc?` の既定はページのロケール（[ロケール](#ロケール)）で、**適用のたびに**読み直されるため、束縛を組み立てた後に確定したロケールも反映されます（明示引数 `date(ja-JP)` は束縛式の一部なので組み立て時に固定されます）。

### 真偽値 / デフォルト

| フィルタ | 説明 | 例 |
|---|---|---|
| `truthy` | truthy チェック — JavaScript の真偽判定そのもので `boolean` と同じ（そのため `0n` は偽） | `value\|truthy` |
| `falsy` | falsy チェック（JavaScript の真偽判定。`defaults` も同じ判定を使う） | `value\|falsy` |
| `defaults(v)` | 偽値（`0`・`false`・`""` を含む）のときのフォールバック値 | `name\|defaults(Anonymous)` |
| `coalesce(v)` | `null` / `undefined` のときだけのフォールバック値（`0`・`false`・`""` は残す） | `count\|coalesce(0)` |

### フィルタチェーン

フィルタは `|` で連結できます：

```html
<div data-wcs="textContent: price|mul(1.1)|round(2)|locale(ja-JP)"></div>
```

フィルタは束縛計画の段で解決されます。未知の名前は `[wcs/filter-unknown]`（`#501`。`diagnostics` アドオンがあれば did-you-mean 付き）で、受け付ける個数の外の引数は `[wcs/filter-arity]`（`join(a,b)`: "accepts at most 1 argument(s) (2 given)"）で落ちます — lint と同じコード・同じ範囲です。どちらも `<wcs-state>` の初期化を止めます（[初期化の失敗](#初期化の失敗)）。引数は構造のままキャッシュされるので、`join('a,b')` と `join(a)` を取り違えません。

**引数のリテラルは型を持ちます。** 引用符の無い `true` / `false` / `null` / 数値はその値、引用符付きの引数は文字列です。比較フィルタは真偽値と `null` の比較にこれを使います: `done|eq(true)` は `true` に一致し、`eq('true')` は一致せず、`eq(null)` は `null` に一致します。数値と文字列は値で比べます — 数値の値は数と、文字列の値は原文と比べるので、フォームの値 `"1"` も `eq(1)` に一致します。**数値**の値と型付きの `true` / `false` / `null` は単に「一致しない」です: `selectedId|eq(null)` は id が `null` の間は `true`、数値になれば `false` になります。型の食い違いとして報告されるのは、引用符の無い非数値（数値の値に対する `eq(abc)`）だけです — `eq` は値の型を選ばないので、`status|eq(active)` は値が分かるまで判定できません。`defaults(v)` は型付きの値を返します: `defaults(0)` は `0`、`defaults('0')` は `"0"`、`defaults(null)` は `null`。

**引用符の規則。** 引用符（`'` / `"`）は「ここはリテラル」という宣言で、引数の文法は意図的に小さく保たれています:

- 引用符の中では `,` `;` `|` `:` はただの文字です。`join(', ')`・`join(': ')`・`join(';')` はそのまま通ります。
- 空白のトリムは**引用符の外側だけ**です: `padStart(5, ' ')` は空白で埋め、`toFixed( 2 )` は `toFixed(2)` と同じです。
- **エスケープ文字はありません。** 同じ種類の引用符をリテラルの中に入れることはできません — `'it\'s'` ではなく `"it's"` と書いてください（前者は未終端の引用符として `[wcs/binding-syntax]` で落ちます）。
- 隣り合う並びは 1 つの引数に連結されます: `'a' 'b'` は 1 個の文字列 `a b`、`1'2'` は文字列 `12` です（引数のどこかに引用符があれば、その引数は文字列になります）。
- 未終端の引用符は受理しません。末尾の空引数は落とされ（`filter()` は引数 0 個）、先頭・中間の空引数は位置を保ちます（`defaults(,)` は空文字 1 個を渡します）。

## Web Component バインディング

`@wcstack/state` は Shadow DOM または Light DOM を使用したカスタム要素との双方向状態バインディングに対応しています。

多くのフレームワークでは、コンポーネント間の状態共有に props のバケツリレー、Context Provider、あるいは外部ストア（Redux, Pinia など）といったパターンが用いられます。`@wcstack/state` はこれらとは異なるアプローチを採ります。親コンポーネントと子コンポーネントは**パスの契約**によって結びつけられます。親は `data-wcs` 属性を使って外部の状態パスを子コンポーネントのプロパティにバインドし、子は自身の状態として通常通り読み書きを行うだけです：

1. 子コンポーネントは、自身の状態プロキシを通じて親の状態を参照・更新します。props の受け渡しやイベント発行など、親の存在を意識したコーディングは必要ありません。
2. 親の状態が変更されると、Proxy の `set` トラップが影響するパスを参照している子のバインディングへ自動的に通知します。
3. 結合点は**パス名のみ**であるため、親と子は疎結合に保たれます。Shadow DOM のコンポーネントは単体でも動作しますが（[独立した Web Component への状態注入](#独立した-web-component-への状態注入__e2e__single-component)）、Light DOM はホストからの配線が必須です。
4. 実行コストは、パスの解決と、依存グラフを通じた変更の伝播です。

これは、コンポーネントレベルの抽象化ではなく「パスの解決」に基づくコンポーネント間の状態管理です。得られるのは、配線が宣言的で検査可能であることで、そのコストは[パフォーマンス](#パフォーマンス)で計測しています。

### コンポーネント定義（Shadow DOM）

```javascript
class MyComponent extends HTMLElement {
  state = { message: "" };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div>{{ message }}</div>
      <input type="text" data-wcs="value: message" />
    `;
  }
}
customElements.define("my-component", MyComponent);
```

### コンポーネント定義（Light DOM）

Light DOM コンポーネントは Shadow DOM を使用しません。v2 では Shadow 形と同じ書き方になります —— コンポーネントのバインディングはマウント位置でホストのツリーへ変換されるため、**name も `@` セレクタも不要**で、同じコンポーネントをリストの行ごとに置けます:

```javascript
class MyLightComponent extends HTMLElement {
  state = { message: "" };

  connectedCallback() {
    this.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div data-wcs="text: message"></div>
      <input type="text" data-wcs="value: message" />
    `;
  }
}
customElements.define("my-light-component", MyLightComponent);
```

- `<wcs-state>` はコンポーネント要素の直下に配置する必要があります
- **ホストからの配線が必須**です（`<my-light-component data-wcs="state.message: user.name">` または `state: user`）。配線の無い plain な Light DOM `bind-component` は v2 では成立しません（親と root を共有したまま独立ツリーは持てない）—— 誘導文付きで loud に失敗します: shadow を付けるか、ホストから配線してマウントにしてください。

> **注意**: Shadow DOM コンポーネントの `getBindingsReady(shadowRoot)` は、その `<wcs-state bind-component>` を
> コンポーネントのバインディングが構築されるまで待ち、マウントに失敗すれば reject します。Light DOM
> コンポーネントはページのルートの中身をバインドしますが、`getBindingsReady(document)` はそれを待ちません:
> コンポーネント自身の `<wcs-state>` を待ってください（`initializePromise`、`$connectedCallback` まで含めるなら
> `connectedCallbackPromise`）。

### ホスト側の使用方法

```html
<wcs-state>
  <script type="module">
    export default {
      user: { name: "Alice" }
    };
  </script>
</wcs-state>

<!-- コンポーネントの state.message を外側の user.name にバインド -->
<my-component data-wcs="state.message: user.name"></my-component>
```

- `bind-component="state"` でコンポーネントの `state` プロパティを `<wcs-state>` にマッピング
- `data-wcs="state.message: user.name"` でホスト要素上の外部状態パスを内部コンポーネント状態プロパティにバインド
- 変更はコンポーネントと外部状態間で双方向に伝播

### 丸ごとマウント（`state: path`）

プロパティ単位で配線する代わりに、ホストは自分の状態の**サブツリーを丸ごと**コンポーネントのルートとしてマウントできます。コンポーネントの中のパスは、すべてマウント先からの相対になります:

```html
<!-- ホスト側 -->
<wcs-state json='{"user":{"name":"Alice","email":"alice@example.com"},"theme":{"mode":"light"}}'></wcs-state>
<user-card data-wcs="state: user"></user-card>
```

```javascript
// コンポーネント側（Shadow DOM）
class UserCard extends HTMLElement {
  state = {
    // マウント先の上で計算する getter — `this.name` はツリーの `user.name`
    get display() { return `${this.name} <${this.email}>`; },
  };
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <span data-wcs="textContent: name"></span>
      <span data-wcs="textContent: display"></span>
      <input data-wcs="value: name">
    `;
  }
}
customElements.define("user-card", UserCard);
```

- `state: user` はコンポーネントのルートをツリーのパス `user` に置きます。中の `name` は `user.name` **そのもの**です。読み・書き（`value: name`、`this.state.name = ...`）・getter・`for:` はすべてツリーに対して解決され、ホストの丸ごと差し替え（`this.user = {...}`）も部分書き込み（`this["user.name"] = ...`）もコンポーネントに届きます
- 部分マウントを併用できます: `state: user; state.theme: theme` は `theme` を 2 つ目の入口としてマウントします（最長接頭辞が勝つので、中の `theme.mode` はツリーの `theme.mode` を読みます）
- ループでは**行そのもの**をマウントします: `<template data-wcs="for: users"><user-row data-wcs="state: ."></user-row></template>`。行コンポーネントの中の `name` は `users.*.name`、中の `for: tags` は `users.*.tags.*` を回します
- **自前のキーは私有**です（[docs/state-mount-design.md](../../docs/state-mount-design.md) §4-3 の R1）: コンポーネントが自分で宣言したデータキー（`state = { mode: "view" }`）はその要素のもので、ツリーには書かれません。マウント先に同名のキーがあってそれを隠す形（`user.name` の上に `state = { name: "" }`）では、ランタイムが 1 回だけ warn します（`wcs/mount-own-key-shadow`）— ツリーを読みたければ既定値を消し、私有のままにしたければ名前を変えてください
- `element.state` から取り出したメソッド（`card.state.toggle()`）は、イベントのバインディング（`onclick: toggle`）から呼んだときと同じに動きます。自前のキーへの書き込みもツリーのキーへの書き込みも描き直され、行マウントではその行に着地し、同期メソッドは値を、async メソッドは Promise を返します
- 配列そのものをルートにマウントする形（`state: rows` ＋ 中で `for`）は非対応です。行をマウントする（`state: .`）か、配列を持つオブジェクトをマウントして中で `for` を回してください（`state: group` ＋ `for: children`）。どちらも契約テストで固定されており、マウントがツリー拡張の唯一の手段です

> プロパティ単位の形（`state.message: user.name`）はそのまま動きます — 同じ機構の上の部分マウントです。
> **明示した部分マウントはコンポーネント自前のキーに勝ちます:** マップされるキーに既定値を
> 宣言しているコンポーネント（`state = { message: "" }` ＋ `state.message: ...`）もホストの値を読み、
> 既定値は使われません。マップしていない自前のキーは今も R1 で私有です。
> これは**1 段のエントリ**の話です: より深いエントリ（`state.a.b: outer.b`）は `a` の私有性に
> 触らないので、コンポーネントが `a` を自分で宣言していれば `a` とその配下は私有のままで、
> エントリは届きません。名前がコンポーネントの getter / setter / メソッドと一致するエントリも同じで、
> コンポーネント自身の面が勝ちます。いずれの形も `wcs/mount-own-key-shadow` で 1 回報告されます —
> どちらかの名前を変えてください。
> コンポーネント側のパスに `*` を含む対応付け（`state.list.*: items`）は throw します — リストそのものを
> 対応付けてください（`state.list: items`）。同じキーを 2 回対応付けるのも throw します。
>
> **マウントの `#ro` を尊重します:** `state#ro: user` や `state.title#ro: doc.title` では、
> コンポーネントはそのエントリを読めても書けません — `element.state.title = …`・メソッド内の
> `this.title = …`・`$setAll` / `$resolve` の書き込みは `[wcs/mount-readonly]` で落ち、コンポーネント内の
> 双方向束縛（`value: title`）は書き戻しません。ホストはそのパスに書けます。Light DOM のマウントに
> `name` は不要で、`element.state`（および getter / メソッド内の `this`）の `$getAll` / `$setAll` /
> `$resolve` / `$postUpdate` はコンポーネント自身の語彙で書けます — パスはマウント先へ翻訳され、ホスト行の
> 添字は自動で前置されます。

#### 公開 getter（コンポーネントの getter を外から読む）

マウントされたコンポーネントの getter はマウント先に**公開**されます: **ツリーに無いキーの読みは、その位置にマウントされたコンポーネントの getter で答える。ツリーにあるキーはツリーが勝つ。私有キーとメソッドは見せない。** 上の `user-card` なら、ホスト側のマークアップからコンポーネントの派生値をそのまま読めます:

```html
<user-card data-wcs="state: user"></user-card>
<span data-wcs="textContent: user.display"></span>   <!-- "Alice <alice@example.com>" — コンポーネントの getter -->
```

- 行マウントは行ごとに公開されます: `$getAll("users.*.display")` や同じ `for` 内の `text: .display` は各行のコンポーネントの getter を読みます。依存も流れます — `user.name` が変われば `user.display` を読んだものはすべて再描画されます
- `get "children.*.label"()` のようにコンポーネント内のパスにワイルドカードを含む accessor は、内部では使えますが**公開されません**。各子行にマウントしたコンポーネントの `get label()` として定義してください。公開対象は、公開パスのワイルドカード数がマウント先のワイルドカード数と一致する accessor だけです
- 親は子コンポーネントの登録より先に評価されるので、初回の読みは `undefined` になりえます。コンポーネントがマウントされ次第、値は収束します。派生式は `(x ?? 0)` のように防御的に書いてください
- 未存在パスの警告は `getBindingsReady` とは独立に 1 マクロタスク（`setTimeout(0)`）だけ遅延します。autoloader や遅延したカスタム要素定義を使う場合、最終的にバインドが解決しても、登録前の初回警告が出ることがあります
- ツリーに同名のキーがある場合（継承したプロパティも含む）はツリーが勝ち、ランタイムが 1 回だけ warn します（`wcs/mount-export-shadowed`）。同一インスタンスに同名キーを公開するコンポーネントが 2 つある形は設定ミスで、候補走査時に検出して throw します（`wcs/mount-export-ambiguous`）。検証付きキャッシュに命中すると他の候補は再走査しないため、初回解決後に追加した競合コンポーネントは検出されない場合があります
- 公開キーへの外からの書き込みは accessor の setter を実行し、getter しか無ければ throw します（getter を隠すキーをツリーに作ることはありません）。`in` は公開キーを見ません
- **自己再帰コンポーネント**（深さが有界でない木）が書けるようになります: 自分自身を `<template data-wcs="for: children"><tree-node data-wcs="state: ."></tree-node></template>` で入れ子にするコンポーネントは、`get total() { return this.value + this.$getAll("children.*.total").reduce((a, b) => a + (b ?? 0), 0); }` と各段 1 段の式で書け、再帰は依存グラフが解きます。パス自体は再帰を表現できない（ワイルドカードの個数が固定）ので、再帰は DOM に置き、パスはその展開形になります。設計: [docs/state-overlay-export-design.md](../../docs/state-overlay-export-design.md)

### 独立した Web Component への状態注入（`__e2e__/single-component`）

ホストの外部状態に依存しないコンポーネントでも、`bind-component` で `state` を注入してリアクティブにできます。

```javascript
class MyComponent extends HTMLElement {
  state = Object.freeze({
    message: "Hello, World!"
  });

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div>{{ message }}</div>
    `;
  }

  async $stateReadyCallback(stateProp) {
    console.log("state ready:", stateProp); // "state"
  }
}
customElements.define("my-component", MyComponent);
```

- 初期 `state` は `Object.freeze(...)` で定義できます（注入後は書き換え可能なリアクティブ状態に置き換え）
- `bind-component="state"` により `this.state` が `@wcstack/state` の状態プロキシとして利用可能になります
- `this.state.message = "..."` のような代入で、Shadow DOM 内の `{{ message }}` が即時に更新されます
- `async $stateReadyCallback(stateProp)` は、Web Component 側で状態が利用可能になった直後に呼ばれます（`stateProp` は `bind-component` のプロパティ名）

### 制約事項

- `bind-component` 付きの `<wcs-state>` はコンポーネント要素の**直下**（トップレベル）に配置すること
- 親要素は**カスタム要素**（ハイフンを含むタグ名）であること
- Light DOM コンポーネントはホストからの配線が必須（plain 形は v2 で廃止）
- コンポーネントの state はホスト要素のプロパティである: `state`・`src`・`json`・内包スクリプトを持つ `<wcs-state bind-component>` は拒否され、1 つのコンポーネントの中の 2 つ目の接続済み `<wcs-state bind-component>` も拒否される（`<tag> already has a connected <wcs-state bind-component="state">.`）
- **マウントされた**スコープは、自身のバインディングとリストに対して `$listKeys`・`$commandTokens` / `$eventTokens` / `$on`・`$errorCallback` を実行し、自身の `$behavior` / `$features` も実行する。`$watch`・`$stream`・`$renderedCallback` は実行せず（`wcs/mount-dollar-declaration` を 1 回警告）、`$recursion` / `**` getter は `[wcs/mount-dollar-declaration]` を throw する。これらはルート state に宣言すること。配線されていない Shadow DOM の子は独立したツリーを持つため、いずれも宣言できる
- コンポーネントが state を読み込んだ後に追加されたホストの配線（後からバインドした `state.a: x`）はコンポーネントに届かず、throw する —— ホストの配線は、コンポーネントが読み込む前にバインドすること
- マウントに失敗したコンポーネントは `connectedCallbackPromise` を reject する —— 初期化に失敗したルートに配線されたコンポーネントも含む（`<tag>.state will not mount: the root state failed to initialize.`）—— [初期化の失敗](#初期化の失敗) 参照
- 古い `<wcs-state bind-component>` がバインド・描画したノードが残っている間に、コンポーネントがそれを新しい `<wcs-state bind-component>` に置き換えると、新しい要素がスコープを引き継ぐ: それらのバインディング・行・`{{ }}` のテキストはそのまま残り、その横に追加されたバインディング付きのノードはバインドされない（`console.warn` がそう伝える）。その中身を新しい要素で描画し直すと、新しい要素が改めてバインドする。新しい要素を外して古い要素を元の場所に戻すと、古い要素が同じようにスコープを引き継ぎ直す
- ページがバインドしなかったホスト —— ページの state が読み込まれる前にページから外され、あるいは後から `for:` / `if:` やルーターではなくコードで挿入されたもの —— は、その `<wcs-state bind-component>` が接続したときに配線される: ホストの `data-wcs` はそのとき、あるいはページの `<wcs-state>` がページに入ったときにバインドされる（Light DOM コンポーネントの中では、そのコンポーネントがマウントされたときに、そのコンポーネントが）

### ループ内でのコンポーネント使用

```html
<template data-wcs="for: users">
  <my-component data-wcs="state.message: .name"></my-component>
</template>

<!-- または行そのものをマウントする: コンポーネントの中の `name` は `users.*.name` -->
<template data-wcs="for: users">
  <user-row data-wcs="state: ."></user-row>
</template>
```

行の中のコンポーネントは自分の行を読み書きします。`$connectedCallback` / `$disconnectedCallback` の `this`（と、そこからタイマーや `await` の先へ取っておいた `this`）は要素の行に付いていきます — `if:` が要素を隠している間もその行に書きます。ホストの行への要素の書き込み（`this["users.1"] = obj`）はその位置の値を置き換えます: コンポーネント要素はそのまま残り、その私有キーも残りますが、行から読む値は新しい値になります。行が消えると、そのコンポーネントも一緒に消えて、もう描画しません: `$disconnectedCallback` はコンポーネント自身のキーを読み書きできます（`this.tid` に取っておいたタイマーの id を解除する）が、行のキー（`this.name`）を読み書きすると、別の行に届く代わりに `The host row of <user-row> was removed.` を throw します。

### コンポーネント側でリストを描画する

配列をコンポーネントに束ね、`for:` をコンポーネントの内側で回すこともできます。
値の正本は外側の状態のままで、行の追加・削除・並べ替え・行フィールドの書き込みは双方向に届きます。

```html
<!-- ホスト側 -->
<wcs-state json='{"rows":[{"name":"Alice"},{"name":"Bob"}]}'></wcs-state>
<my-list data-wcs="state.items: rows"></my-list>
```

```javascript
// コンポーネント側（Shadow DOM）
this.shadowRoot.innerHTML = `
  <wcs-state bind-component="state"></wcs-state>
  <ul>
    <template data-wcs="for: items">
      <li data-wcs="textContent: .name"></li>
    </template>
  </ul>
`;
```

- ホストが `rows` を差し替えても、行フィールド（`rows.0.name`）だけを書いても、コンポーネント内の行に反映されます
- コンポーネント側から `items.*.name` を書き戻すと、ホストの `rows` に届きます

#### 入れ子とスコープの重ね方

コンポーネント自身がホスト側の `for` の中にあり、**さらにコンポーネント内でも `for` を回す**入れ子構成にも対応しています。外側の行と内側の行の対応はフレームワークが保ちます：

```html
<template data-wcs="for: groups">
  <my-list data-wcs="state.items: groups.*.children"></my-list>
</template>
```

コンポーネントの中にさらにコンポーネントを置いて、**スコープを重ねる**こともできます。途中のコンポーネントが配列を素通しするだけで自分では `for` を回さなくても、正本スコープ起点の行フィールド書き込みは最下層の行まで届きます。

コンポーネントの作者が自分の置かれる深さを意識する必要はありません。`$1` / イベントハンドラのインデックス / `$getAll` はいずれも**自分のスコープ内の位置**を報告します。

## Command Token（メソッドバインディング）

プロパティバインディング（`state.message: user.name`）はコンポーネントへ流れ込むデータを扱いますが、**state からコンポーネントのメソッドを起動する**こと —— `<wcs-fetch>.fetch()`、`<wcs-dialog>.open()` など —— はカバーしません。**command token** は型付きの pub/sub チャネルでこの隙間を埋めます：

- 要素は `command.<methodName>: $command.<tokenName>` で購読する
- state は `this.$command.<tokenName>.emit(...args)` で emit する
- `emit` に渡した引数はそのまま要素のメソッドへ転送される
- 1つの token は複数の要素へファンアウトでき、subscribe 順は保持される

これによりパス契約は保たれます。state は要素への参照を一切保持せず、要素も state から何もインポートしません。共有されるオブジェクトは token のみです。

### 基本的な使い方

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["fetchUsers", "refreshOrders"],

      onClickFetch() {
        this.$command.fetchUsers.emit("/api/users", { method: "GET" });
      },
      onClickRefresh() {
        this.$command.refreshOrders.emit();
      }
    };
  </script>
</wcs-state>

<!-- 購読者 — wc-bindable なカスタム要素であること -->
<wcs-fetch data-wcs="command.fetch: $command.fetchUsers"></wcs-fetch>
<wcs-fetch data-wcs="command.fetch: $command.refreshOrders"></wcs-fetch>

<button data-wcs="onclick: onClickFetch">Fetch users</button>
<button data-wcs="onclick: onClickRefresh">Refresh orders</button>
```

`onClickFetch` が実行されると、`fetchUsers` token を購読しているすべての要素の `fetch(...)` メソッドが転送された引数とともに呼び出されます。

### `$commandTokens` 宣言

`$commandTokens` 配列は、state 上の `$command` 名前空間に公開するチャネルを宣言します。token は `this.$command.<name>` でアクセスでき、memo 化されます —— 同じ名前は常に同一の token インスタンスを返します。

```javascript
export default {
  $commandTokens: ["fetchUsers", "refreshOrders"],

  click() {
    this.$command.fetchUsers.emit("/api/users");
  }
};
```

- エントリは空でない文字列であること
- 重複するエントリは初期化時にエラーになる
- 予約名 `$command` 自体は配列に含められない
- token は `$command` 配下にまとめられるためトップレベルの state 名前空間を汚さない。token と同名のリアクティブプロパティが共存できる
- `$command` 上の未宣言の名前にアクセスする（例: `this.$command.typo`）と `undefined` が返る。typo はその後の `.emit()` 呼び出しで `TypeError` として、あるいはバインディングの右辺で使った場合は、バインディングの取り付け時に `[wcs/token-undeclared] "$command.typo" is not declared in $commandTokens.`（`#1302`、did-you-mean 付き）として表面化する

### `command.<methodName>:` バインディング

```html
<wcs-fetch data-wcs="command.fetch: $command.fetchUsers"></wcs-fetch>
```

| 部位 | 説明 |
|---|---|
| `command.` | 固定の prefix |
| `<methodName>` | 起動する要素のメソッド。名前は `static wcBindable.commands` に `{ name: "<methodName>" }` として現れること |
| `$command.<tokenName>` | `CommandToken` に解決される明示的な名前空間パス。`<tokenName>` は `$commandTokens` で宣言された名前であること |

右辺は `$command.<tokenName>` と書く必要があります —— ベア名の省略形（`fetchUsers`）は非対応です。`$command.` 名前空間を経由することでバインディングの意図が HTML 上で明示され、トップレベルの state 名前空間を token 名で汚さずに済みます。

`wcBindable.commands` は wc-bindable v1 仕様の形 —— `{ name: string; async?: boolean }` の配列 —— に従います：

```javascript
class MyFetcher extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [],
    commands: [
      { name: "fetch", async: true },
      { name: "reset" },
    ],
  };
  fetch(url) { /* ... */ }
  reset()    { /* ... */ }
}
```

> `commands` のエントリは `{ name, async? }` オブジェクトでなければなりません。素の文字列のエントリ（`commands: ["fetch"]`）は何も宣言しないので、それへのバインディングは `[wcs/token-misconfigured] <my-fetcher> declares no command "fetch".` を throw します。

検証ルール（バインディング時に強制）：

- 要素は `protocol: "wc-bindable"` かつ整数 `version` が `1` 以上（現行プロトコルは `1`。1 以上のすべてのバージョンが core 互換）の `static wcBindable` を公開するカスタム要素であること
- `methodName` は `wcBindable.commands` に（`name` で）現れること
- `<tokenName>` は `$commandTokens` で宣言されていること（`$command.typo` は `[wcs/token-undeclared]` を throw する）

カスタム要素はクラスが定義された時点で検査され、ネイティブ要素はその場で拒否されます（`[wcs/token-misconfigured]`）。ページのバインド中に見つかった違反は `<wcs-state>` の初期化を失敗させます。`for:` / `if:` の行の中で見つかった違反や、ページのバインド後にクラスが定義されて見つかった違反は、そのバインディング 1 本の失敗として `$errorCallback` に届き、行はそのまま構築されます（[初期化の失敗](#初期化の失敗)）。

### Token API

```typescript
interface CommandToken {
  readonly name: string;
  readonly size: number;                            // 現在の購読者数
  subscribe(fn: (...args) => unknown): () => void;  // unsubscribe を返す
  unsubscribe(fn: (...args) => unknown): boolean;
  emit(...args: unknown[]): unknown[];              // subscribe 順に購読者の戻り値を返す
}
```

`emit` は各購読者の戻り値の配列を（subscribe 順で）返します。`Promise` を返すメソッドは `Promise.all(token.emit(...))` でラップしてすべてを待ち受けてください。

**1 つの購読者が throw しても、残りへの配信は止まりません。** token はファンアウトの口で購読者どうしは互いを知らないため、`emit` は全員を呼びます。投げた購読者は `console.error`（token 名つき）で報告され、結果配列のその位置は `undefined` になり、残りの購読者には届きます。例外は emitter へは**届きません** — state のイベントハンドラと同じ規則で、発火経路はハンドラの完了を待たず、DOM イベント起点では投げ返す呼び出し元が存在しないためです。呼び出し側に知らせたいときは throw ではなく戻り値（または reject した `Promise`）で返してください。`Promise` を返す購読者の reject はここでは捕捉しません。そのための `Promise.all(token.emit(...))` です。

### 購読のライフサイクル

- 購読者は要素を `WeakRef` でだけ保持する: token が要素を生かし続けることはない。`emit` 時、要素が回収済みの購読者は自分で購読を解除する
- `for:` の行や `if:` の枝の中の要素は、その行や枝が消えるときに購読を解除する
- token が emit されたときに接続されていない要素（ノードを保持したまま隠れているルートなど）は呼ばれず、購読は残る: 文書に戻れば次の `emit` を受け取る
- 所有する `<wcs-state>` が disconnect されても token は保持されるので、付け直した後（ホストを DOM 上で移動したときなど）も購読に命令が届く。再設定（`setInitialState()`）は、新しい state が改めて宣言する名前の token をすべて保持する

要素のメソッドは `emit` の引数で呼び出されます：

```javascript
this.$command.fetchUsers.emit(url, options);
// → すべての購読者で element.fetch(url, options)
```

### DOM イベントから command を emit する

command token は state コードから emit する必要はありません。DOM イベントバインディングの右辺を、state メソッド名ではなく `$command.<name>` パスに向けることで、直接 emit できます：

```html
<button data-wcs="onclick: $command.refreshList">Refresh</button>
```

| 形式 | 右辺 | イベント時の動作 |
|---|---|---|
| `onclick: someMethod` | state メソッド名 | `state.someMethod(event, ...listIndexes)` |
| `onclick: $command.someToken` | `$command.<name>` パス | `state.$command.someToken.emit(event, ...listIndexes)` |

これは純粋な配線です。イベント端点を command token 端点に接続するだけで、間にロジックは入りません。`emit` の引数はハンドラ呼び出しとまったく同じく透過されます —— まず DOM の `Event`、続いて内包するリストインデックス —— なので購読者は `(event, ...listIndexes)` を受け取ります。購読者の中で必要なものをイベントから取り出してください（`event.target.value`、`event.detail` など）。

- 右辺は `$command.<name>` であり、`<name>` は `$commandTokens` で宣言されていること。`CommandToken` に解決されないパス（例: typo）はイベント時に失敗する。DOM のイベントには投げ返せないので、伝播ではなくイベントごとに 1 回 `console.error` で報告される（reject した state ハンドラと同じ着地）。
- 修飾子はそのまま機能する: `onclick#prevent: $command.someToken` は emit の前に `preventDefault()` を呼ぶ（`#stop` も同様）。
- これは state が emit するのと同じ token を emit するので、`command.<method>: $command.someToken` で配線された要素の購読者は、誰がトリガを引いたかに関わらず受け取る。

```html
<!-- click が command を全購読者へファンアウトする。state メソッドは不要 -->
<button data-wcs="onclick: $command.reset">Reset all</button>
<my-field data-wcs="command.clear: $command.reset"></my-field>
<my-list  data-wcs="command.reset: $command.reset"></my-list>
```

## Event Token（イベントバインディング）

command token はコンポーネントへ *押し込み* ます（state がメソッドを起動）。**event token** はその正確な双対 —— コンポーネントから *引き出し* ます（要素がイベントを dispatch し、state が受信）。両者で要素 ↔ state 境界の双方向をカバーし、どちらの側も相手への参照を一切持ちません。共有されるのは token のみです。

| Token | 方向 | 購読者 | emit する側 |
|---|---|---|---|
| **command token** | state → 要素 | 要素（`command.<method>:`） | state（`$command.<name>.emit`） |
| **event token** | 要素 → state | state（`$on`） | 要素（DOM イベントリスナー） |

- 要素側は wc-bindable カスタム要素に `eventToken.<property>: <tokenName>` を配線する
- state 側は `$eventTokens` でチャネルを宣言し、`$on` マップで受信する
- 購読者は `(state, event, ...listIndexes)` で呼び出される —— command token の emit 規約と対称

### 基本的な使い方

```html
<wcs-state>
  <script type="module">
    export default {
      users: [],
      error: null,

      $eventTokens: ["userCreated", "createFailed"],
      $on: {
        userCreated(state, event) {
          state.users = state.users.concat(event.detail);
        },
        createFailed(state, event) {
          state.error = event.detail;
        }
      }
    };
  </script>
</wcs-state>

<!-- emitter — wc-bindable なカスタム要素であること -->
<my-form data-wcs="eventToken.created: userCreated; eventToken.error: createFailed"></my-form>
```

`<my-form>` が自身の `created` プロパティに対応する DOM イベントを dispatch すると、`userCreated` token が発火し、`$on.userCreated` ハンドラが `(state, event)` で実行されます。

### `$eventTokens` 宣言

`$eventTokens` 配列は、`eventToken.<prop>:` バインディングと `$on` キーが参照できるチャネル名を宣言します。宣言された名前のみが有効です（typo 耐性）。

```javascript
export default {
  $eventTokens: ["userCreated", "createFailed"],
};
```

- エントリは空でない文字列であること
- 重複するエントリは初期化時にエラーになる
- ここで宣言されたが `$on` に無い token は購読者ゼロ —— emit しても no-op

### `$on` —— state 側での受信

`$on` は各 event-token 名をハンドラに対応づけます。state は **第1引数** として渡される（`this` ではない）ため、ハンドラはメソッド省略記法でもアロー関数でも書けます —— `this` を束縛しない点は command token の emit 規約と同じです：

```javascript
$on: {
  // どちらの形式でも可 —— state は常に第1引数
  userCreated: (state, event) => { state.lastId = event.detail.id; },
  rowFailed(state, event, ...listIndexes) {
    const [i] = listIndexes;          // `for` 内から発火した場合のループインデックス
    state.failedRows = state.failedRows.concat(i);
  }
}
```

- `$on` のすべてのキーは `$eventTokens` で宣言済みであること（さもなくば初期化時に throw）
- 各値は関数であること
- シグネチャは `(state, event, ...listIndexes)` —— まず DOM の `Event`、続いて内包するループインデックス

### `eventToken.<property>:` バインディング

```html
<my-target data-wcs="eventToken.error: createFailed"></my-target>
```

| 部位 | 説明 |
|---|---|
| `eventToken.` | 固定の prefix |
| `<property>` | **wcBindable プロパティ名** —— 生の DOM イベント名ではない。実イベント名は `wcBindable.properties[].event` から解決される |
| `<tokenName>` | `$eventTokens` で宣言されたベアな event-token 名（command token と違い `$` 名前空間 prefix は付けない） |

キーを生イベント名ではなくプロパティ名にすることで、command バインディングと同じ `wcBindable` 契約を経由でき、namespaced なイベント名（`ns:evt`）がバインディングの `:` 区切りと衝突しません。フレームワークは `properties[].event` を引いてその実イベントのリスナーを attach します：

```javascript
class MyTarget extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [
      { name: "error",   event: "thing-error" },     // eventToken.error → "thing-error" を listen
      { name: "created", event: "thing-created" },
    ],
  };
}
```

検証ルール：

- 要素は wc-bindable なカスタム要素であること（`static wcBindable`・`protocol: "wc-bindable"`・整数 `version` が 1 以上。1 以上のすべてのバージョンが core 互換）。非 wc-bindable 要素は attach 時に拒否される。
- `<property>` は `wcBindable.properties` に現れること —— **attach 時** に検証（fail-fast。クラス参照のみで足り、DOM 接続に非依存）。
- `<tokenName>` は `$eventTokens` で宣言されていること —— **発火時** に検証。token はイベント発火時に引かれるので、再設定した state の `$on` ハンドラにも届く。未宣言の名前は `console.error` で報告される（`[wcs/token-undeclared]`、did-you-mean 付き）。
- 修飾子 `#prevent` / `#stop` は通常のイベントバインディングと同様に機能する: `eventToken.error#prevent: createFailed`。

### ループ内での使用

emitter が `for` ブロック内にある場合、`on*` ハンドラと同じく、内包するループインデックスがイベントの後ろに付与されます：

```html
<template data-wcs="for: rows">
  <my-row data-wcs="eventToken.failed: rowFailed"></my-row>
</template>
```

```javascript
$on: {
  rowFailed(state, event, ...listIndexes) {
    const [i] = listIndexes;          // 発火した行のインデックス
    state.failedRows = state.failedRows.concat(i);
  }
}
```

### ファンインとチェイン

複数の要素が同じ token を配線できます（`eventToken.x: shared`）—— すべての dispatch が1つの `$on` ハンドラに届き、command token のファンアウトと対称です。さらに `$on` ハンドラは `state` を受け取るため、そこから command token を再 emit して 要素 → state → 要素 のチェインを組めます：

```javascript
$commandTokens: ["doRefresh"],
$eventTokens: ["completed"],
$on: {
  completed(state) {
    state.$command.doRefresh.emit();  // event in → command out
  }
}
```

### Token API

event token は command token と同じ `Token` pub/sub プリミティブを共有します —— `name` / `size` / `subscribe` / `unsubscribe` / `emit`、subscribe 順の保持つき（[Token API](#token-api) 参照）。token はイベントごとに registry から解決されるため、`setInitialState()` による再構築後も最新の `$on` 購読者に届きます。所有する `<wcs-state>` が disconnect されても、その event token と `$on` ハンドラは保持されます。

## 時間を扱う機構の選び方

続く節は、それぞれ別の 3 つの問いに答えるものです。取り違えが起きやすいので、データの出どころではなく**何を宣言しているか**で選んでください。

| 宣言 | 宣言するもの | 値を持つか | 発火 | 主な用途 |
|---|---|---|---|---|
| [パス getter](#パス-getter算出プロパティ) | その値が現在の state から見て**何であるか** | 持たない（アドレス単位で再計算・キャッシュ） | 評価需要が読んだときに遅延評価 | 小計、分類、集計 |
| [`$stream`](#streamstream) | 非同期の供給元と、**1 回の実行の中で** fold される値 | 持つ（出力は runtime の所有） | chunk ごと。`args` が変われば `initial` に戻して restart | フィード、ソケット、継続的な観測 |
| [`$watch`](#watchwatch) | 変更への反応 | 持たない —— ただしハンドラが自分のキーに書くことはできる | 変化したアドレスごとにバッチ 1 回 | 副作用、「条件が成立したとき」、時間をまたぐ累積 |

混乱のほとんどは、次の 2 点で解けます。

- **`$renderedCallback` はこの表に入りません。** 適用されたバインディングを報告するものなので、そこに処理をぶら下げると描画内容に暗黙に依存します。[評価のきっかけ](#評価のきっかけdemand-root)を参照してください。
- **`$stream` の fold は restart のたびに戻ります。** 累積した値を restart を越えて保ちたいときは、それを普通のキーとして持ち、供給元のパスに付けた `$watch` ハンドラから書き込んでください（状態ではなく出来事を数えるなら `$on` ハンドラから）—— リセットは、初期値を書き戻す `$watch` ハンドラです。その値は自分が所有する素の state になり、再設定ではほかのキーと同じく置き換えられます。

## Stream（`$stream`）

command token / event token が運ぶのは離散的なやり取りです。**`$stream`** は残る形 —— 連続的なフローをカバーします。非同期 producer（async iterable / async generator / `ReadableStream`）を宣言すると、フレームワークがそれを **fold して単一の reactive プロパティに畳み込みます** —— 各チャンクは通常のパス代入を通るため、バインディング・パス getter・`$renderedCallback` は自分で値を代入した場合とまったく同じように反応します。`args` 関数が読んだ state パスが変化すると、実行中の producer は abort され、新しい引数で source が張り直されます（switchMap 型の依存駆動 restart）。stream は `$connectedCallback` 完了後に eager に起動し、要素の disconnect で abort されます。`$stream` は `temporal` アドオンです（全部入りのエントリに含まれる）。3.x の名前 `$streams` は `[wcs/declaration-alias] $streams was removed: write $stream.`（`#1601`）を throw します。

`$renderedCallback` は引き続き binding 駆動です。stream 宣言だけでは headless な購読にならず、その value/status/error の live DOM binding が実際に適用されたときだけ callback の path に現れます。描画せずに stream の値へ反応したい場合は、そのパスに [`$watch`](#watchwatch) を宣言してください。観測契約は [stream リファレンス](docs/streams.md) を参照してください。

```html
<wcs-state>
  <script type="module">
    export default {
      prompt: "",

      $stream: {
        // フル形: LLM トークンストリームを累積
        tokens: {
          args:    (state) => state.prompt,                 // 依存はここでのみ捕捉される
          source:  (prompt, signal) => llmStream(prompt, signal),
          fold:    (acc, chunk) => acc + chunk,             // reduce（累積）
          initial: "",                                      // fold 指定時は必須
        },

        // 最小形: fold 省略 = latest（最新チャンクで置換）、args 省略 = 一度だけ起動
        ticker: {
          source: (_args, signal) => priceStream(signal),
        },
      },
    };
  </script>
</wcs-state>
```

| フィールド | 必須 | 契約 |
|---|---|---|
| `source` | ✔ | `(args, signal) => AsyncIterable \| ReadableStream \| Promise<同>`。**`AbortSignal` を必ず尊重すること** —— restart / 破棄はこの signal で駆動される |
| `args` | — | readonly な state proxy を受ける同期・純粋関数。ここで読んだパスが依存として捕捉される。省略時は一度だけ起動し restart しない |
| `fold` | — | 同期関数 `(acc, chunk) => next`。省略時は latest（チャンクで置換）。毎回新しい値を返すこと —— `acc` の in-place 変異は非サポート |
| `initial` | `fold` 指定時 ✔ | 初期値。起動・restart のたびにプロパティはこの値にリセットされる |

stream の値は普通のプロパティで、コンパニオンの status / error は読み取り専用の名前空間から参照できます：

```html
<p data-wcs="textContent: tokens"></p>
<p data-wcs="textContent: $streamStatus.tokens"></p>  <!-- "idle" | "active" | "done" | "error" -->
<p data-wcs="textContent: $streamError.tokens"></p>   <!-- 直近のエラー。(re)start で null -->
```

error 時、プロパティは直前の fold 結果を保持し、エラーは `$streamError.<name>` に入ります。`done` / `error` の stream も依存の変化で restart します（再試行 = 依存の叩き直し）。

**イベント API の橋渡し** —— 実際の source の多くはコールバック型（`EventSource`・`WebSocket`・DOM イベント）で、async iterable ではありません。標準の `ReadableStream` で包んでください: `start` で enqueue し、`cancel` でリソースを解放します。`AbortSignal` には一切触れません —— restart / 破棄時は runtime が reader を cancel し、parked read を強制解放して `cancel()` まで届けます：

```js
$stream: {
  metrics: {
    args: (state) => ({ host: state.host }),
    source: ({ host }) => {
      const es = new EventSource(`/api/metrics?host=${host}`);
      return new ReadableStream({
        start(controller) {
          es.addEventListener("metric", (e) => controller.enqueue(JSON.parse(e.data)));
        },
        cancel() { es.close(); },   // restart / 破棄時に走る
      });
    },
    fold: (acc, sample) => [...acc, sample].slice(-20),
    initial: [],
  },
},
```

手書きの async generator も producer 側の制御が要るときは引き続き完全サポートですが、abort 救済は*部分的*です: `signal` を無視して `await` で park した generator は外から強制解放できません。イベント API の橋渡しには `ReadableStream` 形を推奨します。

重要な規範：

- **協調キャンセル（MUST）** —— `source` は渡された `AbortSignal` を必ず監視し、発火したら生産を停止すること。`ReadableStream` の source はこの契約を `cancel()` コールバック経由で自動的に満たします（abort 時に runtime が reader を cancel します）。自前の async iterable だけが `signal` を自分で監視する必要があります。
- **有界 fold** —— 需要は producer に逆流しません（backpressure は明示的に放棄）。無限 / 長寿命ストリームでは latest・count・last-N（`(acc, chunk) => [...acc.slice(-99), chunk]`）・ウィンドウ集計など有界な fold を使うこと。生の全チャンク累積は有限ストリーム限定。
- **`args` は同期** —— Promise を返すとエラー。`args` 内での wildcard 読みも拒否されます。
- **自己依存・相互サイクルの禁止** —— `args` が自 stream の値や status を読むとエラーになります。2 つの stream の相互サイクル（A の `args` が B の値を読み、B の `args` が A の値を読む）は宣言時には拒否されません: source が実行開始と同じタスクの中で値を出す場合は連鎖の上限がサイクルを断ち切りますが（[Watch](#watchwatch) 参照）、値が後のタスクで届く場合（ネットワークの応答、メッセージ）は周回ごとに数え直しになり、サイクルは無限に restart します —— 組まないでください。一方向のチェイン（A の値を B の `args` が読む）は正当です。
- **プロパティは runtime の所有物** —— エントリ名が state の getter / setter / メソッドと衝突すると、宣言時にエラーになります（検査が無いと、そのメソッドは起動時の `initial` リセットで無言に上書きされます）。
- **SSR では起動しない** —— サーバーでは宣言のパースとプロパティの実体化（`initial`）のみ行い、source は実行されません。クライアント側は通常どおり起動します。

完全な契約 —— ライフサイクルと所有権・restart セマンティクス・flush 粒度・スコープ外リスト —— は [docs/streams.ja.md](docs/streams.ja.md) を参照してください。

## 評価のきっかけ（demand root）

パス getter は **lazy** です。誰も読まなければ一度も評価されません。したがって「この getter は走るか」は getter 自身を読んでも決まりません —— **需要（demand）がどこから来るか**で決まります。

需要の根は **3 つだけ**です：

| 根 | 場所 | 描画に依存するか |
|---|---|---|
| **live DOM バインディング** | `data-wcs` / mustache / コメントバインディング | **する**（その要素が消えると需要も消える） |
| **`$watch` の宣言** | state 側 | しない（headless） |
| **`$stream` の `args`** | state 側 | しない（起動・restart のたびに評価される） |

**`$renderedCallback` は根ではありません。** それは「バインディングが適用された結果」の報告であり、需要を作りません。

### 描画がプログラムの意味論を変えうる

この 3 つのうち 1 つ目が DOM にあることの帰結として、**表示専用のつもりの要素が購読の実体になり得ます**。実際に踏んだ例が [`examples/state-intersect-scroll`](../../examples/state-intersect-scroll) にあります：

```html
<!-- 表示のつもりだった要素。これが唯一の需要の根だった -->
<b data-wcs="textContent: $streamStatus.pageResult"></b>
```

```javascript
// $renderedCallback は binding 駆動 —— 上の <b> を消すと paths に現れなくなり、
// フィードの commit が黙って止まる
$renderedCallback(paths) {
  if (!paths.includes("$streamStatus.pageResult")) return;
  this.items = this.items.concat(this.pageResult.items);
}
```

**規則:** 描画に依存させたくないロジックは、`$watch` か `$stream` の `args` に根を置いてください。`$renderedCallback` は「描かれたものに追随する」用途に限ります。

上の例はいまは stream の値に付けた `$watch` で着地したページを feed へ畳み（sentinel の再武装は feed の `$watch`）、`<b>` は表示専用に戻っています。この形（`$renderedCallback` が、どのバインディングにも現れないパスを判定に使っている）は **`wcs/updated-callback-unbound`** として静的に検出されます。

### 残る制約

需要の根が 3 か所に分かれること自体は変わりません。**ある getter が評価されるかを知るには、その 3 か所（ページの全バインディング・全 `$watch`・全 `$stream.args`）を見る必要があり、getter の定義だけを読んでも分かりません。** lint と DevTools の配線カバレッジはこの照合を機械にやらせるためのものです。

なお `$watch` に宣言した getter は **eager** になります: 接続時に 1 回、以後は依存に触れたバッチの終わりごとに評価されます。ワイルドカードの行 getter はリストの全行について評価されるので、長いリストの上のものを watch すると、そのリストを舐めるコストがかかります。

## Watch（`$watch`）

`$renderedCallback` は **binding 駆動** です。その更新で live DOM binding が実際に適用された path だけを報告するため、**描画していない値の変化は見えません**。**`$watch`** はその headless 版で、ページ上でそのパスがバインドされているかどうかに関わらず、行パスも含めて、state の変化で発火します。`temporal` アドオンです（全部入りのエントリに含まれる）。

```html
<wcs-state>
  <script type="module">
    export default {
      isLoading: false,
      items: [],
      startedAt: 0,
      lastPriceChange: "",

      $watch: {
        // 立ち上がり検出は cur/prev を自分で比較する
        isLoading(cur, prev) {
          if (cur === true && prev === false) { this.startedAt = Date.now(); }
        },

        // ワイルドカードパスは変化した行ごとに 1 回発火する
        "items.*.price"(cur, prev, index) {
          this.lastPriceChange = `#${index}: ${prev} → ${cur}`;
        },
      },
    };
  </script>
</wcs-state>
```

ハンドラの `this` は **writable** な state proxy なので書き戻せます。その書き込みは次の更新バッチに乗ります。戻り値は無視され、await もされません。

| 引数 | 契約 |
|---|---|
| `cur` | drain 時点の値（そのバッチの確定値） |
| `prev` | **バッチ開始時点**の値（first-write-wins）。記録されるのは、watch しているパスそのものに**プリミティブを書いたときだけ**（書く前の値はオブジェクトでもよい。下記）。getter では前回の評価値 |
| `...indexes` | ワイルドカードパスのときのみ。そのスコープ自身のループ添字（`$1` / `$2` と同じ規約） |

**`prev` はプリミティブの書き込みにだけ付きます。** same-value guard がプリミティブを書く前に読む旧値を再利用するため watch のための追加読みは発生せず、その帰結として書く値が参照型（in-place 変異では同じ参照になるため）・パスより上のオブジェクトが書かれたとき・`$postUpdate` 経由・リストに入ってきた行・`$behavior.sameValueGuard` オフのときは `undefined` になります。オブジェクトの上にプリミティブを書いたときは、そのオブジェクトが `prev` に渡ります。

**`$watch` は独自の発火条件をほとんど持ちません。** 更新バッチに載ったものをそのまま発火します: 同値の primitive 書き込みは enqueue 前に落ちている（＝実質的に変化時のみ発火）一方、occurrence（`semantics: "event"` の property）は**意図的に**落とされないので `cur === prev` で発火します。値を比べるのは 2 つの場合です: 数値の添字を含むキー（`"items.0.v"`）は、その位置の値が変わったときだけ発火し、リストの代入や並べ替えで据え置かれた行の行 getter（`items.*.label`）は、値が変わったときだけ発火します —— ただし、同じバッチの書き込みが、getter が行の外で読んだもの（`now`・`items.length`・それらを読むルートの getter）を変えた場合や、別の行の同じパスを書いた場合は別です。エッジ検出が要るならハンドラ内で `cur` と `prev` を比較してください。

**getter を watch すると eager になります。** computed は本来 lazy で、依存は評価時にしか記録されません —— つまり描画していない getter は本来一度も発火しません。`$watch` に宣言すると接続時に 1 回 —— ワイルドカード getter（`items.*.tax`）なら全行について —— 評価され、以後は依存に触れたバッチの終端で毎回評価されます。`prev` は前回の評価値で、変更が届けば、値が変わったかどうかに関わらず watch は発火します（上の 2 つの場合を除く）。重い computed を watch すればその評価コストが毎バッチ乗り、getter 内の例外は眠ったままにならず watch 経由で表面化します。接続時の評価が throw した場合は報告され（`$watch initial evaluation of "…" threw.`）、その watch の最初の `prev` は `undefined` になり、ほかはすべて続行します。

発火順序は 3 層に分かれ、利用者が意思を持てるのは真ん中の層だけです。

| 層 | 順序 | 制御 |
|---|---|---|
| 機構間 | `$renderedCallback` → `$watch` → `$stream` restart | 固定 |
| ハンドラ間 | `$watch` の宣言順 | **宣言を並べ替える** |
| 同一パスの行間 | `indexes` 昇順 | 固定 |

**機構間の層を動かす唯一のもの**が、`state` 参加者を受け付ける `<wcs-view-transition>` です。バインディング適用 —— したがって `$renderedCallback` —— がフレームで着地する一方、`$watch`・`$stream` restart は state アドレスを消費し DOM を見ないので、drain がキューされた microtask に留まります。タグがある間の順序は `$watch` → `$stream` restart → `$renderedCallback` です。この層を並べ替えるものはページ上でこれ 1 つだけです。[docs/timing-and-firing-contract.ja.md](https://github.com/wcstack/wcstack/blob/main/docs/timing-and-firing-contract.ja.md) §4.3 を参照してください。

主なルール:

- **ツリーのパスのみ** —— キーは空にできず、`$` で始めることも、`@`（v1 の名前セレクタ）を含むことも、`Object.prototype` のメンバ（`toString`）を名指すこともできません。そうした宣言は throw します（`$watch path "…" is not a path of the state tree.`）。`**` を含むキーは `[wcs/recursion-unsupported]` を throw します。state 上で解決しないキーは `diagnostics` アドオンが警告します（`wcs/watch-path-missing`）。
- **中間値は観測できません** —— 1 バッチ内の `a → b → c` は `cur = c` / `prev = a` で 1 回だけ発火します（binding 更新と同じ契約）。
- **行は drain の時点のリストに従います** —— 同じ job で行を書いてから取り除いた・置き換えた・リストを短くした行は発火せず、位置だけが移った行も発火しません。1 つの位置が発火するのは多くても 1 回です。配列を代入すると、リストに入ってきた行が発火します。同一性で据え置かれた行は変化していないので発火しません。
- **行単位の差分を見たいなら `$listKeys`** —— 新しいオブジェクトとして届くデータ（再取得）は全行が新しい行として入ってくるので、行 watch は**全行**について `prev === undefined` で発火します。`$listKeys` を宣言すればキー突合が代入を per-field 書き込みに分解するので、変化した行だけが発火し `prev` もスカラで取れます。
- **行 watch も headless です** —— `for:` も `$listKeys` も要りません: watch は、自分が範囲とするリストを自分で追従させます。同じ配列やその写しの代入と `$postUpdate("items")` では発火しません —— どの行もリストに入っておらず、どの行パスも書かれていないためです —— が、行を読む getter（`$getAll("items.*.price", [])`）はその場で変えた値を読みます。
- **共有配列は位置ごとに発火します** —— 複数の外側の行が同じ配列を持っているとき、その要素の 1 つへの書き込みは、その配列を持つ外側の行ごとに 1 回ずつ、それぞれの添字で `$watch("groups.*.items.*")` を発火させます: それらのどのパスでも値が変わったからです。
- **ハンドラの例外は隔離されます** —— throw は報告され（`$watch "…" failed; the other watches still run.`）、残りの watch（と stream の restart）は続行します。
- **書き込みの連鎖には上限があります** —— ハンドラの書き込みは新しいバッチを作るため、相互に書き合う watch は無限ループになり得ます。書き込みはそれぞれ連鎖の深さを持ちます: その書き込みをしたハンドラを起こした書き込みの深さに 1 を足したものです。32 段より深くで起こされたハンドラは実行されません: 連鎖は断ち切られ、`console.error`（`$watch handlers / $stream restarts kept writing for 32 batches; the chain is cut (nothing is rolled back).`）と DevTools の `state:watch-chain-limit` で 1 回報告され、そのバッチのほかのハンドラは実行されます。値と DOM は巻き戻しません。同じバッチに載る書き込み —— 描画の書き戻し —— は連鎖を伸ばしもリセットもしないので、長い有限の描画の連鎖（`$renderedCallback` が描画ごとに見出しを 1 段ずつ詰める）を見るハンドラは打ち切られません。`$stream` の restart もハンドラと同じく数えます: restart の書き込み（`initial` への戻し・status）は `args` に届いた書き込みの連鎖の続きで、上限を越えた restart は行いません。実行が（再）開始と同じタスクの中で書くもの —— source が出した値、status の `done` / `error` —— はその実行の連鎖に数え、それが起こすハンドラも restart も連鎖の続きになります。そのため、すぐに値を出す source を通るループはページを固まらせずに打ち切られます: `args` で互いの値を読む 2 つの stream も、stream の値を見る `$watch` がその `args` の読むものを進める形も。後者の 1 周（ハンドラ → restart）は 2 段なので、有限かどうかに関わらず 16 周ほどで止まります（メモリ上の source を使う自動ページ送りも）。後のタスク（ネットワークの応答、メッセージ、タイマー）から来た値と、それが起こすハンドラは、数え直しになります。
- **マウントされた `bind-component` スコープでは実行されません** —— マウントされたコンポーネントの `$watch` 宣言は、ルート state へ誘導する `wcs/mount-dollar-declaration` の警告を 1 回出して無視されます。`$stream` と `$renderedCallback` も同様です。ボリュームは `$watch` を拒否します（[`mount=`](#追加の状態をマウントするmount)）: ルートにフルパス（`"cart.total"`）で宣言してください。plain な（配線なし Shadow の）子は独立ツリーを持つので宣言できます。
- **SSR では実行されません** —— ハンドラの副作用がサーバーとクライアントで二重に走るためです。

## Inputs と属性ミラー

`wcBindable.inputs` は一方向のプロパティ入力（state → 要素）を宣言します。エントリに `attribute` を設定すると、フレームワークはプロパティを書き込むたびにその値を当該 HTML 属性へも書き込むため、`attributeChangedCallback`・CSS の属性セレクタ・DevTools がすべてプロパティ値と同期し続けます。

`inputs` は属性ミラーのためだけのメタデータではありません。方向認識初期同期（既定 ON）の下では、メンバが **state から settable であること**を示すのが `inputs` です。settable なのに `properties` にしか宣言されていないメンバは output-only 扱いになり、state からの書き込みが抑止されます — [バインディング authority](#バインディング-authority-init--sync) を参照してください。

```javascript
class MyChip extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [],
    inputs: [
      { name: "data", attribute: "data" },        // プロパティ名 === 属性名
      { name: "labelText", attribute: "label-text" }, // kebab-case ミラー
      { name: "internal" },                       // ミラーなし、プロパティのみ
    ],
  };
}
```

```html
<my-chip data-wcs="data: chip.payload; labelText: chip.title"></my-chip>
```

state が値を更新すると、プロパティと属性の両方が書き込まれます：

```text
chip.payload = { id: 1 }    → element.data = { id: 1 } かつ setAttribute("data", '{"id":1}')
chip.title   = "新着"        → element.labelText = "新着" かつ setAttribute("label-text", "新着")
chip.payload = null          → element.data = null かつ removeAttribute("data")
```

属性値のエンコード：

| 値の型 | ミラーされる属性 |
|---|---|
| `string` / `number` / `boolean` / `bigint` | `String(value)` |
| `null` / `undefined` | 属性を削除 |
| `object` / `array` | `JSON.stringify(value)`（循環参照時は `String(value)` にフォールバック） |

補足：

- `attribute` を**持たない** `inputs` エントリはプロパティのみ —— 値はプロパティに書き込まれるが属性には触れない
- ミラーはベストエフォート: `setAttribute` の失敗は握りつぶされ、プロパティ書き込みをブロックしない
- ネイティブ HTML 要素は `inputs` を完全に無視する —— ミラーは `static wcBindable` を公開するカスタム要素でのみ有効になる

## コンポーネント機構の選び方

カスタム要素に独自の状態を持たせる機構は 2 つあり、**排他**です。コンポーネントごとにどちらか一方を選びます。

| | [DCC](#宣言的カスタムコンポーネント-dcc) | [`bind-component`](#web-component-バインディング) |
|---|---|---|
| 要素の定義方法 | HTML だけ（`data-wc-definition` + Declarative Shadow DOM） | 自分で書く `class extends HTMLElement` |
| 状態の在処 | テンプレート内のインライン `<script type="module">`（インスタンスごとにロード） | コンポーネントインスタンスのプロパティ（`this.state`） |
| `static wcBindable` | `$bindables` / `$commands` から生成 | **無し** — wc-bindable の producer ではない |
| 親から値をバインド | `count: parentCount`（双方向・変更イベントあり） | `state.msg: user.name`（パスマッピング） |
| 親からメソッド起動 | `command.bumpBy: $command.bump` | 不可 — クラス側に公開して自分で呼ぶ |
| spread（`...: obj`） | 使える | 使えない（`wcBindable` 宣言が必要） |
| コンポーネント自身の読み書き | 要素の `this.count` | `this.state.msg` |

判断の目安は「**JavaScript クラスが無いなら DCC、既にクラスを書いているなら `bind-component`**」です。併用はエラーになります。`data-wc-definition` ホストの中に `<wcs-state bind-component>` を置くのは設定ミスです — DCC の状態はテンプレートに属し、インスタンスごとにロードされるためです。

`bind-component` のコンポーネントが wc-bindable プロトコルの外に留まっているのは意図的です。宣言されたプロパティ面ではなく**パス**で配線するのがこの機構だからで、`wcBindable` 宣言を必要とする spread と command token が使えないのはその帰結です。

## 宣言的カスタムコンポーネント (DCC)

JavaScript のクラス定義なしで、**HTML だけ**でカスタム要素を定義できます。`data-wc-definition` と Declarative Shadow DOM (`<template shadowrootmode>`) を使い、リアクティブな状態を持つ再利用可能なコンポーネントをインラインで宣言します。

### 基本的な定義

```html
<!-- 1. コンポーネントを定義（CSSで非表示） -->
<my-counter data-wc-definition>
  <template shadowrootmode="open">
    <p>{{ count }}</p>
    <button data-wcs="onclick: increment">+1</button>
    <wcs-state>
      <script type="module">
        export default {
          count: 0,
          increment() { this.count++; },
          $bindables: ["count"]
        };
      </script>
    </wcs-state>
  </template>
</my-counter>

<!-- 2. 使う — 各インスタンスが独自の状態を持つ -->
<my-counter></my-counter>
<my-counter></my-counter>
```

`<wcs-state>` が `data-wc-definition` 付きのホスト内にあることを検出すると：

1. 状態オブジェクトをロード（`<script type="module">` または `src="*.js"`）
2. getter/setter/メソッドをプロトタイプに定義したカスタム要素クラスを生成
3. `customElements.define()` で登録

定義要素は非表示になり、各インスタンスはテンプレートを自身の Shadow DOM にクローンして、独自の `<wcs-state>` を初期化します。

### 推奨 CSS

```css
:not(:defined) { display: none; }
[data-wc-definition] { display: none; }
```

### `$bindables` / `$commands` と wc-bindable プロトコル

`$bindables` は変更イベント付きのコンポーネント**プロパティ**として公開する状態プロパティを、`$commands` は起動可能な**コマンド**として公開する状態メソッドを宣言します。この 2 つで [wc-bindable プロトコル](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/README.md)の宣言が組み立てられます：

```javascript
export default {
  count: 0,
  bumpBy(step) { this.count += step; },
  $bindables: ["count"],
  $commands: ["bumpBy"]
};
```

これにより以下が生成されます：

- クラスの `static wcBindable` — フレームワークアダプタ用のプロトコルメタデータ。各 `$bindables` メンバは `properties` と `inputs` の両方に宣言され（双方向）、方向認識初期同期の下でも親 state → DCC の書き込みが機能します — [バインディング authority](#バインディング-authority-init--sync) 参照。各 `$commands` メンバは `commands` エントリになります
- `$bindables` はプロトタイプの getter/setter、`$commands` はメソッド — いずれもリアクティブプロキシ経由
- `CustomEvent` のディスパッチ — `$bindables` メンバが変更されるたび（メンバ自体の書き込み、その下のパスの書き込み、その `$postUpdate`）に `my-counter:count-changed` が発火。`detail` が書き込まれた値を運ぶのはメンバ自体への書き込みのときだけで、宣言された `getter` はメンバを要素から読む

`commands` エントリは常に `async: true` です。DCC のメソッドは内側の `<wcs-state>` の初期化に chain するため、状態側のメソッドが `async` でなくても戻り値は Promise になります。

どちらの宣言もコンポーネント定義時に `$commandTokens` と同じ強度で検証されます。次はいずれもエラーになります。

- 配列でない
- 非空文字列でないエントリ
- `$` 始まりのエントリ（内部プロパティはコンポーネントの prototype に公開されません）
- 重複したエントリ — これは従来サイレントに壊れていました。重複名があると `wcBindable` 宣言全体が読み取り不能になり、その要素が黙って双方向バインド不可になります
- 状態に存在しないエントリ（自身とプロトタイプチェーンの両方を探索します。`$stream` の名前は値プロパティがインスタンスごとに実体化されるため「存在する」と見なされます）
- `$bindables` にメソッドを書いた場合、または `$commands` に値プロパティを書いた場合

### DCC のメソッドを起動する

`$commands` メンバは、I/O ノードと同じように親 state から [command token](#command-tokenメソッドバインディング) で起動できます：

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["bump"],
      fire() { this.$command.bump.emit(3); }
    };
  </script>
</wcs-state>

<button data-wcs="onclick: fire">bump</button>
<my-counter data-wcs="command.bumpBy: $command.bump"></my-counter>
```

位置引数はそのまま素通しされるので、`emit(3)` はコンポーネント側の状態の `bumpBy(3)` を呼びます。

### DCC プロパティへのバインディング

他の `<wcs-state>` インスタンスから、通常の Web Component と同じように DCC プロパティにバインドできます：

```html
<my-counter data-wcs="count: parentCount"></my-counter>

<wcs-state>
  <script type="module">
    export default { parentCount: 0 };
  </script>
</wcs-state>
<div data-wcs="textContent: parentCount"></div>
```

### Shadow Root モード

`open` と `closed` の両モードに対応しています：

```html
<my-component data-wc-definition>
  <template shadowrootmode="closed">
    <!-- closed shadow DOM -->
  </template>
</my-component>
```

### 内部プロパティ

`$` プレフィックス付きのプロパティは内部用で、コンポーネントのプロトタイプには公開されません：

| プロパティ | 用途 |
|----------|---------|
| `$bindables` | 観測可能プロパティの宣言 |
| `$commands` | 起動可能メソッドの宣言 |
| `$connectedCallback` | ライフサイクルフック（各インスタンスで実行） |
| `$disconnectedCallback` | クリーンアップフック |
| `$renderedCallback` | バインディングの適用後に呼ばれる |

## SVG サポート

全てのバインディングが `<svg>` 要素内で動作します。SVG 属性には `attr.*` を使用します：

```html
<svg width="200" height="100">
  <template data-wcs="for: points">
    <circle data-wcs="attr.cx: .x; attr.cy: .y; attr.fill: .color" r="5" />
  </template>
</svg>
```

## ライフサイクルフック

状態オブジェクトに `$connectedCallback` / `$disconnectedCallback` / `$renderedCallback` / `$errorCallback` を定義すると、初期化・クリーンアップ・更新時・バインディング失敗時のフックとして利用できます。

> `$renderedCallback` が受けるのは**適用されたバインディング**の更新で、state の更新全体ではありません（それには `$watch`）。3.x の名前 `$updatedCallback` は `[wcs/declaration-alias] $updatedCallback was removed: write $renderedCallback.`（`#1601`）を throw します。

```html
<wcs-state>
  <script type="module">
    export default {
      timer: null,
      count: 0,

      // <wcs-state> が DOM に接続された時に呼ばれる
      async $connectedCallback() {
        const res = await fetch("/api/initial-count");
        this.count = await res.json();
        this.timer = setInterval(() => { this.count++; }, 1000);
      },

      // <wcs-state> が DOM から切断された時に呼ばれる（同期のみ）
      $disconnectedCallback() {
        clearInterval(this.timer);
      }
    };
  </script>
</wcs-state>
```

| フック | タイミング | 非同期 |
|---|---|---|
| `$connectedCallback` | 初回接続時は state が読み込まれてバインディングが構築された後、再接続時は毎回呼び出し | 可（await される） |
| `$disconnectedCallback` | 要素が DOM から削除された時 | 不可（同期のみ） |
| `$renderedCallback(paths, indexesListByPath)` | live binding に更新が適用された後に呼び出し | 可（await されない） |
| `$errorCallback(error, info)` | バインディングの適用に失敗した drain の後 — 失敗した本数ぶん、`$renderedCallback` の後に呼び出し | 可（await されない） |

`$disconnectedCallback` を除くすべてのフックで `async` を使用できます。リアクティブ Proxy はすべてのプロパティへの代入を変更として検知します。そのため、標準の `async/await` による処理とプロパティへの直接代入だけで非同期ロジックが完結します。ローディングフラグの切り替え、取得したデータの格納、エラーメッセージの更新といった処理もすべて単なるプロパティ代入で行えるため、非同期状態を管理するための複雑な抽象化機能は必要ありません。

- フック内の `this` は読み書き可能な状態プロキシです。
- `$connectedCallback` は要素が接続される**たびに**呼ばれます（一度削除された後の再接続も含みます）。再確立が必要なセットアップ処理に適しています。
- `$disconnectedCallback` は同期的に呼び出されます。タイマーのクリア、イベントリスナーの削除、リソースの解放といったクリーンアップ処理に使用してください。
- `$renderedCallback(paths, indexesListByPath)` は、その drain で live binding が適用された path の一覧を受け取ります。binding のない state 書き込みでは呼ばれず、`paths` にも現れません。ワイルドカードをもつパスが更新された場合は、`indexesListByPath` から対象のインデックス情報も取得可能です。マウントされたコンポーネントのバインディングは、したがってその私有キーも、ホストの `paths` には決して現れません。`async` を使用できますが、戻り値は await されません。throw または reject した場合は `console.error` で報告されます。
- `$errorCallback(error, info)` はバインディングの**ページ内エラー境界**です。バインディングの適用が throw したとき（パス getter やフィルタが throw した、構造ディレクティブが失敗した）、その失敗は隔離され（同じバッチの残りは適用され、値も DOM も巻き戻されません）、このフックが無ければ `console.error` で報告されます。フックを宣言すると報告はそこへ届きます: `error` は throw された値、`info` はバインディングを識別する `{ path, bindingType, node }`（`path` は `data-wcs` に書いた形のまま。ワイルドカードもそのまま。`for:` で描画していないリスト —— `$getAll` か `$watch` だけが保持しているリスト —— では `node` は `null`）。`for:` / `if:` の行の中で取り付け時に拒否されたバインディング（未宣言の token、要素が宣言していないメンバ）も、そのバインディングの失敗としてここに報告され、行はそのまま構築されます。`this` は書き込み可能な state proxy なので、メッセージを state に書いて普通に描画するのが基本形です:

  ```js
  export default {
    user: null, loadError: "",
    get title() { return this.user.profile.name; },   // user が null の間は throw する
    $errorCallback(error, { path }) {
      this.loadError = `${path}: ${error.message}`;   // <p data-wcs="textContent: loadError">
    },
  };
  ```

  フックはバッチの後（`$renderedCallback` の後）に走り、await されず、フック内で throw しても console に報告されるだけで drain は壊れません。DevTools にはフックの有無に関わらず全失敗が `state:binding-apply-error` として届きます。ボリューム（`<wcs-state mount>`）は実行しません（`console.warn`）。マウントされたコンポーネントのフックは、そのコンポーネント自身のバインディングの失敗を受け取ります。`$watch` ハンドラの失敗（別途隔離・報告）、throw した `$renderedCallback`（`console.error` で報告）、失敗した `$connectedCallback`（[初期化の失敗](#初期化の失敗)）は対象外です。
- Web Component を使用している場合は、コンポーネント側に `async $stateReadyCallback(stateProp)` を定義おくことで、`bind-component` でバインドした状態が利用可能になった瞬間にフックとして呼び出されます。

## 遷移アニメーション

入場アニメーションにこのパッケージは要らない。新しい `for` 行も mount する `if` 分岐も「新しく挿入された要素」なので、素の CSS で足りる。

```css
li {
  transition: opacity 0.2s, transform 0.2s;
  @starting-style { opacity: 0; transform: translateY(-4px); }
}
```

そこへ届かないのが**退場**と**移動**。削除された行は同期で detach され、並べ替えには中間状態が無い。[`@wcstack/view-transition`](https://github.com/wcstack/wcstack/tree/main/packages/view-transition) を足すと drain の DOM 変更が View Transition の中で行われ、変更前の状態はブラウザがスナップショットしてくれる。

```html
<script type="module" src="https://esm.run/@wcstack/view-transition/auto"></script>
<wcs-view-transition naming="auto"></wcs-view-transition>
```

そのタグが `state` 参加者を受け付けている間、知っておくべき帰結が 2 つある。

- drain は microtask ではなくフレームで着地する。state に書いてから `await Promise.resolve()` で DOM を読むコードは遷移を待つ必要がある。`$renderedCallback` はバインディング適用の直後という*位置*こそ変わらないが、その適用ごと 1 フレーム後ろへずれる。
- `$watch`・`$stream` restart は元の microtask に留まるため、`$renderedCallback` の**前**に走る。

適用すべきバインディングが実際にあるバッチだけがタグへ渡されるので、headless なパスへの書き込みが遷移を起こすことはない。タグが無ければ drain は従来どおり。[docs/timing-and-firing-contract.ja.md](https://github.com/wcstack/wcstack/blob/main/docs/timing-and-firing-contract.ja.md) §4.3 参照。

## 診断と失敗の扱い

### エラーメッセージと番号

メッセージはすべて `[@wcstack/state]` で始まります。`@wcstack/lint` と VS Code 拡張も検査する事柄についてのメッセージは同じ診断 code（`[wcs/filter-unknown]`）を持ち、ほとんどのメッセージは番号（`#501`）を持ちます。番号の百の位がその code を表します —— 1xx `binding-syntax`、2xx `template-syntax`、3xx `binding-path-missing`、4xx `binding-type-expectation`、5xx `filter-unknown`、6xx `filter-arity`、7xx `getter-cycle`、8xx `getter-depth-exceeded`、9xx `index-arity`、10xx `index-param-range`、11xx `recursion-unsupported`、12xx `token-misconfigured`、13xx `token-undeclared`、14xx `wildcard-rank`、15xx `spread-no-bindable`、16xx `declaration-alias`、17xx `name-alias`。1〜99 は code を持ちません。番号は追加されるだけなので、番号の意味はバージョンをまたいで変わりません。

番号付きメッセージの文章 —— いちばん近い名前（lint と同じ規則による did-you-mean）、直し方、そして lint が検出できる場合は lint への案内 —— は、`@wcstack/state` と `/auto` に含まれる `diagnostics` アドオンが出します。それを入れていない `/core` のページでは、メッセージは code・番号・表示するはずだった値だけになります:

```
[@wcstack/state] [wcs/filter-unknown] filter not found: uc. "uc" was renamed "upper" in 3.2 and removed in 4.0 — write "upper". Validate statically: npx @wcstack/lint <file>.
[@wcstack/state] [wcs/filter-unknown] #501 "uc"
```

1 行目が `@wcstack/state` と `/auto` の出力、2 行目が `features/diagnostics` なしの `/core` の出力です。`/core` で開発するときは `diagnostics` を入れてください。アドオンなしのページが意図して突き当たる障壁（`[wcs/feature-not-installed]`、`formats` なしの書式フィルタ）は、core の中でも完全な文章です。

<details>
<summary>番号付きメッセージ</summary>

| # | Code | メッセージ（`diagnostics` あり） |
|---|---|---|
| 1 | | `$scan was removed (use $watch or $on)` |
| 2 | | `"<path>" is a getter without a setter` |
| 3 | | `no row for "<path>"` |
| 4 | | `cannot write "<path>": its parent is <value>` |
| 5 | | `"<name>" is not a method` |
| 6 | | `$getAll("<path>"): no loop level in common with the context` |
| 7 | | `$eqIndex("<path>") needs a list row scope.` |
| 8 | | `This state is readonly.` |
| 9 | | `$setAll("<path>") needs indexes ([] for every match)` |
| 10 | | `$setAll("<path>", …, { spread: true }) needs an array of <n> values` |
| 11 | | `updates did not settle after 32 passes` |
| 12 | | `binding "<type>: <path>" failed to apply.` |
| 13 | | `failed to load "<src>": <status>` |
| 14 | | `this <wcs-state> failed to initialize; create a new one` |
| 15 | | `state is not initialized` |
| 16 | | `no <script> with id "<id>"` |
| 17 | | `a subscriber of token "<name>" threw.` |
| 18 | | `<key> must be an array of strings.` |
| 19 | | `<key> entries must be non-empty strings.` |
| 20 | | `<key> entry "<name>" conflicts with the reserved namespace name "<reserved>".` |
| 21 | | `<key> entry "<name>" is duplicated.` |
| 22 | | `$on must be an object of handlers.` |
| 23 | | `$on entry "<name>" is not declared in $eventTokens.` |
| 24 | | `$on entry "<name>" must be a function.` |
| 25 | | `view-transition naming-limit (<limit>) reached.` |
| 26 | | `filter <name> requires at least one option` |
| 27 | | `filter <name> requires a number as option` |
| 28 | | `filter <name> requires a number value` |
| 29 | | `filter <name> requires a date value` |
| 30 | | `filter <name> requires an array value` |
| 31 | | `init=/sync= modifiers require enableDirectionalInitialSync.` |
| 32 | | `"<text>": the "@name" selector was removed in v2 — there is a single state tree. …` |
| 33 | | `Unknown binding modifier "<key>" in "<modifier>".` |
| 34 | | `Binding modifier "<key>" may only be specified once.` |
| 35 | | `Invalid <key> modifier value "<value>".` |
| 36 | | `Event bindings only allow init=none.` |
| 37 | | `Binding type "<type>" does not support init=<init>.` |
| 38 | | `Property "<name>" is not declared by wcBindable.` |
| 39 | | `init=<init> is incompatible with wcBindable member "<name>".` |
| 40 | | `sync=connect requires observable property "<name>".` |
| 41 | | `render chain depth limit exceeded (100 drains that rendering itself started); bindings for this batch were not applied.` |
| 42 | | `The inline <script> of <wcs-state> was blocked by Content-Security-Policy. …` |
| 43 | | `Failed to evaluate the inline <script> of <wcs-state>: <detail>. …` |
| 44 | | `<where>: "<key>" is not one of its options, or not of the option's type.` （`<where>` は `bootstrapState`、`$behavior`、またはオブジェクトでない `$behavior` に対しては `state`） |
| 45 | | `a re-set state may not change $behavior: create the element again.` |
| 46 | | `$features must be an array of add-on names (["temporal", "formats"]).` |
| 47 | | `a second <wcs-state> on the same root: there is one state tree per root — …` |
| 48 | | `the locale "<locale>" (<html lang> or bootstrapState's locale) is not a language tag Intl takes (en-US, not en_US): the locale filters use "en".` |
| 49 | | `<wcs-state src="…"> failed to initialize.` |
| 50 | | `<wcs-state src="…"> $connectedCallback failed.` |
| 51 | | `<wcs-state src="…"> $disconnectedCallback failed.` |
| 101 | `binding-syntax` | `Invalid bindText: "<text>". Missing ':' separator between propPart and statePart.` |
| 102 | `binding-syntax` | `"<text>": "<keyword>" takes no modifiers or filters on its left side — write "<keyword>:".` |
| 103 | `binding-syntax` | `"<text>": "else" takes no value — write "else:".` |
| 104 | `binding-syntax` | `Invalid spread binding "<text>": spread target path is required.` |
| 105 | `binding-syntax` | `Invalid spread binding "<text>": filters are not allowed on spread targets.` |
| 106 | `binding-syntax` | `"<prop>": a leading "." binds an element property by name — …` |
| 107 | `binding-syntax` | `unterminated <quote> quote in the filter arguments "(<args>)". Close the quote.` |
| 108 | `binding-syntax` | `Invalid filter format: missing closing parenthesis in "<filter>".` |
| 109 | `binding-syntax` | `Invalid filter format: missing opening parenthesis in "<filter>".` |
| 110 | `binding-syntax` | `Invalid filter format: ")" comes before "(" in "<filter>".` |
| 111 | `binding-syntax` | `"<filter>": unexpected "<text>" after the filter's closing ")" — separate filters with "\|" …` |
| 112 | `binding-syntax` | `an empty filter in "<source>" — remove the extra "\|" or name the filter.` |
| 113 | `binding-syntax` | `"<name>" is not a filter name: a modifier list "#<modifiers>" comes before the input filters, not inside one` |
| 114 | `binding-syntax` | `"<name>" is not a filter name: "#" cannot appear in one.` |
| 115 | `binding-syntax` | `"<prop>": a binding takes one modifier list after a single "#"` |
| 116 | `binding-syntax` | `"<prop>": the left side of a binding must name a property — …` |
| 117 | `binding-syntax` | `"<path>" has <n> path segments — the limit is 512.` |
| 119 | `binding-syntax` | `"<text>": the right side of a binding must name a state path — …` |
| 120 | `binding-syntax` | `"<path>": a state path cannot go through "__proto__" or "prototype" (it would reach every object's prototype).` |
| 121 | `binding-syntax` | `"<text>": "for:" takes no filters — … Declare a getter that returns the filtered list and loop over it ("for: <getter>").` |
| 201 | `template-syntax` | `Invalid bindText: "<text>". 'if', 'elseif', 'else', and 'for' bindings must be single binding.` |
| 202 | `template-syntax` | `"<type>:" must follow an "if:" template` |
| 203 | `template-syntax` | `"<name>:" replaces its element, so it cannot be used inside a "for" / "if" template …: bind innerHTML: on a wrapper element instead.` |
| 204 | `template-syntax` | `a "<type>:" template at the top of inserted content was not rendered, … wrap it in an element.` |
| 301 | `binding-path-missing` | `Path "<path>" does not exist on the state tree.` |
| 401 | `binding-type-expectation` | `class.<name> needs a boolean, got <type>.` |
| 501 | `filter-unknown` | `filter not found: <name>.` |
| 601 | `filter-arity` | `filter "<name>" requires at least <min> argument(s) (<given> given).` |
| 602 | `filter-arity` | `filter "<name>" accepts at most <max> argument(s) (<given> given).` |
| 701 | `getter-cycle` | `"<path>" depends on itself` |
| 801 | `getter-depth-exceeded` | `"<path>"` |
| 901 | `index-arity` | `<api>("<path>") takes <depth> index(es), got <n>.` |
| 902 | `index-arity` | `<api>("<path>") takes at most <depth> index(es), got <n>.` |
| 1001 | `index-param-range` | `"<key>": list index parameters run from $1 to $128.` |
| 1101 | `recursion-unsupported` | `"<path>" uses "**", which is not accepted here.` |
| 1201 | `token-misconfigured` | `"<prop>: <path>": the right-hand side must be $command.<name>` |
| 1202 | `token-misconfigured` | `<tag> declares no static wcBindable (<binding>).` |
| 1203 | `token-misconfigured` | `<tag> declares no command "<method>".` |
| 1204 | `token-misconfigured` | `<tag> declares no property "<prop>".` |
| 1301 | `token-undeclared` | `eventToken "<name>" is not declared in $eventTokens.` |
| 1302 | `token-undeclared` | `"$command.<name>" is not declared in $commandTokens.` |
| 1401 | `wildcard-rank` | `"<path>" needs <depth> enclosing loop level(s); the scope provides <n>.` |
| 1402 | `wildcard-rank` | `"<path>" is relative: it needs an enclosing "for" template` |
| 1403 | `wildcard-rank` | `"<path>" ranges over the rows of "<list>", but the enclosing "for" template at that level renders "<loop>".` |
| 1501 | `spread-no-bindable` | `<tag> declares no static wcBindable (<binding>).` |
| 1601 | `declaration-alias` | `<old> was removed: write <name>.` (`$streams`, `$updatedCallback`) |
| 1701 | `name-alias` | `<old> was removed: write <name>.` (`$trackDependency`, `$untrackDependency`) |

番号と文章の出典は `src/diagnostics/messages.ts` です。

</details>

### 存在しないパスへの配線は報告されます

配線したパスが state 上で解決しないことが**確実**なとき、`diagnostics` アドオンが、バインディング（または `$watch` のキー）を組み立ててから 1 マクロタスク後に、1 回だけ警告します。診断 code はコンソール・`@wcstack/lint`・VS Code 拡張で共通です：

```
[@wcstack/state] [wcs/binding-path-missing] Bound path "user.nmae" does not resolve on the state tree:
"nmae" is not declared. Did you mean "name"? Updates to this path will be silently
dropped. Validate statically: npx @wcstack/lint <file>.
```

| 状況 | 挙動 |
|---|---|
| ネストしたパスの打ち間違い（`user.nmae`） | `console.warn`（`wcs/binding-path-missing`）。更新は届かないままなので、直すのは書き手 |
| トップレベルのパスの打ち間違い（`cout`） | 読み取り時に throw —— `[wcs/binding-path-missing] Path "cout" does not exist on the state tree. Did you mean "count"?`（`#301`）—— そのためバインディングの適用が失敗し、ほかのバインディングの失敗と同じく報告される |
| `$watch` のキーの打ち間違い | `console.warn`（`wcs/watch-path-missing`）。単一セグメントでも報告する |

判定は**過小近似**です。静的に決められない形では黙ります —— 誤検知でページを騒がせないことを優先しているためで、以下はすべて警告しません：

- 親が `null` / `undefined`（初期値 `null` に後から代入する形）
- 初期値が空配列のリストの行フィールド（行の形が分からない）
- 途中の getter の戻り値のサブプロパティ
- まだ読み込み中のボリュームのマウントパス配下のパス —— ボリュームが決着した時点で検査される
- `$` 始まりの予約名前空間（`$command.*` など）

裏を返すと、**警告が出ない ＝ 正しい保証にはなりません**。網羅した検査は `npx @wcstack/lint <file>` 側で行ってください。再設定（`setInitialState()`）では、すべてのパスを新しい state に対して検査し直します。

### 添字の本数・階数・循環も検査されます

パス文字列から機械的に決まる整合は、実行時にも lint にも同じ診断 code で現れます。ただし下表の 5 つ —— `wcs/getter-depth-exceeded` / `wcs/recursion-context` / `wcs/recursion-shared-list` / `wcs/recursion-cycle` / `wcs/recursion-depth-exceeded` —— は**実行時専用**で、lint は出しません。

| 診断 | 何を見るか | 直し方 |
|---|---|---|
| `wcs/index-arity` | `$resolve(path, indexes)` は `*` の本数と**厳密一致**、`$getAll(path, indexes)` / `$setAll(path, indexes, …)` は**上限**（不足は「残りの階層を全展開」という正当な接頭辞） | 本数を合わせる |
| `wcs/wildcard-rank` | マークアップで、パスの `*` の本数（と `$N` の N）が囲む `for` の段数を超えていないか（`#1401`）、`.` パスを囲む `for` があるか（`#1402`）、各 `*` がその段で囲んでいる `for` の行であって、別のリストの行ではないか（`for: a` の中の `{{ b.*.y }}`、`#1403`） | `for` を足すか、別のリストの行は getter の中で `$resolve(path, indexes)` で読む |
| `wcs/getter-cycle` | パス getter どうしが循環参照していないか: 評価が、すでに評価中の getter の出現に戻ってきた | 循環を断つ |
| `wcs/getter-depth-exceeded` | getter の評価が 1 パスで評価できる深さ（128 段）を超え、かつ同じ出現を 2 度通っていない ＝ データが単に深い | 集計の段数を減らすか、木を平らにする |
| `wcs/index-param-range` | `$N` は実在するワイルドカード段を指すこと（`$1`〜`$128`・先頭ゼロ不可） | 実在する段を使う |
| `wcs/recursion-unsupported` | `**` を解釈しない場所へ `**` が渡った —— markup・`$watch` / `$listKeys` のキー・`$resolve` / `$postUpdate` / `$dependOn`・代入、あるいは state が `$recursion` を宣言していない | 具体パスを使うか、アンカーを宣言する |
| `wcs/recursion-declaration-invalid` | `$recursion` 宣言か `**` getter のキーが、このバージョンが受け付けない形 —— 要素を指さない・途中に添字セグメントを持つ（`"nodes.0.items.*"`）アンカー / 反復サブパス、複数アンカー、getter でない・setter を持つ `**` キー —— そして `diagnostics` アドオンがあれば、構造を名指す getter、同じ具体パスへ展開する 2 本の getter、展開形と同名の具体 getter。lint が先に出し、実行時は宣言を読んだ時点で throw する | 文面のとおり宣言を直す |
| `wcs/recursion-anchor` | 宣言済みのアンカーと合致しない `**` パス（このバージョンは state ごとに単一の自己再帰アンカー）、または `**` の後ろが整形されていない —— 何も無い（`get "nodes.**"`）、空セグメント（`nodes.**.` / `nodes.**..x`）や `**` 直後の素の `*`（`nodes.**.*`） | 宣言どおりに綴り、その後ろに実在するパスを書く |
| `wcs/recursion-context` | **束縛**形の `**` を、束縛先の深さが無い場所で読んだ —— トップレベル、またはアンカー外の getter | 再帰 getter か行 getter の中から読むか、`[]` で全深さを合併する |
| `wcs/recursion-getall-form` / `wcs/recursion-setall-form` | `**` に対して定義できない `indexes` の形。コードが付くのは非空の接頭辞（両 API）と、`$getAll` の配列でない `indexes`（`null`・文字列など）。`$setAll` の省略・mapper・`{ spread: true }` も同じ誤りで、lint は同じコードで報告する。実行時は mapper と `{ spread: true }` が `[wcs/recursion-setall-form]` で、添字の省略は `indexes` の無い `$setAll` と同じく `#9` で throw する | 現在の深さなら省略、全深さなら `[]` |
| `wcs/recursion-structural-write` | 再帰 `$setAll` が構造そのもの（ノード・子リスト・その `length`・子ノード・反復サブパスが多段なら子リストへ至る途中のオブジェクト）を指している | 葉のプロパティへブロードキャストする（子ノードの下の葉 `nodes.**.children.*.value` もその 1 つ） |
| `wcs/recursion-readonly` | 書き込みが再帰 getter、またはその導出値の内側を指している —— 再帰 `$setAll` の `nodes.**.total` でも、`nodes.*.children.*.total` のような具体的な展開形への書き込み（固定本数の `$setAll`・値付き `$resolve`・直接代入）でも | getter の導出元を書く |
| `wcs/recursion-shared-list` / `wcs/recursion-cycle` | 走査が同じ配列インスタンスに 2 度到達した —— 2 つのノードが 1 本の子リストを共有、または自分の祖先から到達可能 | 各ノードに自分の子配列を持たせる |
| `wcs/recursion-depth-exceeded` | 展開後のパスがワイルドカード 128 段を超える —— 木がエンジンのアドレス可能な深さより深いか、循環している | 木を平らにするか、循環を探す |

`wcs/recursion-*` の各行がどの形を拒否していて、代わりに何を書けばよいのかは、[再帰パス](#再帰パスrecursion)の節に書いてあります。

添字の超過が黙って捨てられることはありません: 取り違えたまま「もっともらしい値」を返すはずの呼び出しは、代わりに throw します。

```javascript
// ❌ "*" は 1 本しか無いのに 2 本渡している → [wcs/index-arity] を throw
this.$resolve("items.*.price", [row, col]);

// ✅ 2 次元なら 2 本
this.$resolve("matrix.*.*", [row, col]);
// ✅ $getAll の不足は「残りを全部」の意味なので正当
this.$getAll("matrix.*.*", [row]);
```

### 初期化の失敗

初期化に失敗した `<wcs-state>` は `console.error` で 1 回報告されます —— まず要素とその state の出どころ、続いてエラー:

```
[@wcstack/state] <wcs-state src="./state.js"> failed to initialize. SyntaxError: …
```

見出し（`#49`）は、要素が持っていれば `mount=`・`bind-component=`・`state=`・`src=` を名指します。その要素の `connectedCallbackPromise` はエラーをそのまま（ラップせずに）伴って reject し、`initializePromise` は resolve するので、1 つの要素の失敗がページの残りを止めることはありません。

初期化を失敗させるもの:

- 読めないソース（[状態の初期化](#状態の初期化)）。
- 不正な宣言: 削除された名前（`$scan`・`$streams`・`$updatedCallback`）、形の誤った `$behavior` / `$features` / `$commandTokens` / `$eventTokens` / `$on`、アドオンが入っていない宣言（`[wcs/feature-not-installed]`）。
- ページのバインド中に見つかったマークアップの誤り: 構文エラー、未知のフィルタや誤った引数の個数、wildcard-rank のエラー、フィルタ付きの `for:`、テンプレートの中の `outerHTML:`、クラスが定義済みの要素での wc-bindable の設定ミス。走査はそのエラーで止まります: 文書順でそれより前はバインドされ、後はバインドされません。デプロイの前に `npx @wcstack/lint` を実行してください。
- 別の `<wcs-state>` がすでにバインドしているルートの上の、2 つ目のルート `<wcs-state>`（`#47`）。state ツリーはルートごとに 1 本です。部分木は `mount=` で接ぎ木してください。

`for:` / `if:` の行の中で、バインディングの取り付け時に見つかったエラー（未宣言の token、要素が宣言していないメンバ）は、初期化の失敗ではなく、そのバインディングの失敗になります: `$errorCallback` に届き、行はそのまま構築されます。state にないトップレベルのキーへのバインディングは、初期化の失敗ではなく適用の失敗です。初期化に失敗した要素は再始動できません —— `setInitialState()` は throw します（`#14`）。取り除いて新しい要素を作ってください。

**失敗した `$connectedCallback` は初期化の失敗ではありません。** `$connectedCallback` はバインディングが構築された後に走ります。throw または reject したものは `<wcs-state …> $connectedCallback failed.`（`#50`）に続けてエラーとして報告され、`connectedCallbackPromise` はそのエラーで reject します —— ただしページはバインドされています: `getBindingsReady()` は resolve し、要素は再設定もできます。再接続時に throw または reject したルートの `$connectedCallback` も同じ形で報告され、throw または reject したルートの `$disconnectedCallback` は `<wcs-state …> $disconnectedCallback failed.`（`#51`）に続けてエラーとして報告されます —— どちらも要素のコールバックの外へは漏れません。マウントされたコンポーネントの再接続時に失敗した `$connectedCallback` は `console.error` で報告されます。

**各 Promise が約束すること:**

| | `initializePromise` | `connectedCallbackPromise` |
|---|---|---|
| ルートの `<wcs-state>` | state が読み込まれ、バインディングが構築されたら resolve —— 初期化に失敗したときも resolve | `$connectedCallback` の後に resolve。初期化の失敗と、失敗した `$connectedCallback` で reject |
| DCC の定義（`data-wc-definition` の shadow root の中の `<wcs-state>`） | resolve | タグが定義されたら resolve。定義が失敗すると reject（state の読み込みの失敗、`$bindables` / `$commands` のエラー、そこにある `bind-component`）—— その場合タグは定義されない |
| マウントされたコンポーネント（`<wcs-state bind-component>`） | コンポーネントのバインディングが構築されたら resolve —— 失敗したときも | マウントが失敗すると reject: ホストのプロパティがオブジェクトでない、配線のエラー、1 つのコンポーネントの中の 2 つ目の接続済み `<wcs-state bind-component>`、初期化に失敗したルートに配線されたコンポーネント（`<tag>.state will not mount: the root state failed to initialize.`）、コンポーネントの描画後に失敗した `$connectedCallback` |
| ボリューム（`<wcs-state mount>`） | resolve | 常に resolve —— 失敗した・拒否されたボリュームは報告して、接ぎ木せずに決着する（`scopes` アドオンが無いときは reject） |

`getBindingsReady(root)` は、`root`（`document` または shadow root）のバインディングが、そこに接続された `<wcs-state>` によって構築されたら resolve します —— `$connectedCallback` は、どれほど遅くても、決着しても throw しても待ちません。reject するのは、そのルートに接続されたすべての `<wcs-state>` がバインディングを構築する前に失敗した場合だけで、最初の失敗を伴います。はぐれた要素（`#47` で拒否された 2 つ目のルート、ソースの読み込みに失敗したもの）は、別の要素がそのルートをバインドしている間は何も変えません。ルートの `<wcs-state>` が置き換えられた（取り除かれ、新しいものが追加された）ときは、新しいものが決めます。そこにある唯一の `<wcs-state>` が `setInitialState()` を待っている間は pending のままで、そこに 1 つも無いとき —— 初めから無い、またはそのルートから外されたものしか無い —— はすぐに resolve します。DCC の定義や Shadow DOM コンポーネントの shadow root では、その `<wcs-state>` に従います: コンポーネントのバインディングが構築されたら resolve し、マウントが失敗したら reject します。Light DOM コンポーネントはページのルートの中身をバインドし、その失敗は `getBindingsReady(document)` には届きません。ボリュームがこれを reject させることはありません。

`@wcstack/server` の `renderToString()` と `@wcstack/testing` の `mount()` は、Light DOM コンポーネントのものも含めてすべての `connectedCallbackPromise` を待つので、上の場合にはこれらも reject します。これらのケースは [`__tests__/init-failure.test.ts`](__tests__/init-failure.test.ts) で固定されています。

### バインディング 1 本の失敗は 1 本に閉じ込められます

バインディングの適用が throw しても、そのバッチの残り・`$renderedCallback`・`$watch`・`$stream` の restart はすべて続行します。失敗は握り潰されず、`$errorCallback` に、それが無ければ `console.error` にエラーを続けて出し、DevTools（`state:binding-apply-error`）にも届きます。

```
[@wcstack/state] binding "text: items.*.label" failed to apply.
```

同期や描画に失敗したリスト（キーが無い、getter が throw した）も、その `for` バインディングの失敗として同じように報告され、それまでの行を保ちます。

### 描画中の書き込みは無限ループになりません

描画そのものが書き込みを送り返すことがあります: 要素の書き戻し（双方向の入力欄、wc-bindable のイベント —— バインディングが要素のプロパティを設定したときに要素がその場で同期に出すものも含む ——、出力専用メンバーの初期値）と、`$renderedCallback` の中での書き込み（その中の `await` の後も、決着するまで）、`$watch` ハンドラの中での書き込み、`$stream` の restart による書き込みです。こうした書き込みはそれぞれ新しいバッチを作り、そのバッチがまた描画されます。描画が毎回新しい値を書く形 —— たとえば行の要素の出力を、その一覧の getter が読むキーそのものへ束ね、要素がインスタンスごとに違う値を返す —— では、microtask が回り続けてページが固まります。描画だけが送り込んだバッチが続いた数を数え、100 を超えると次のバッチは描画せず（値は state に残ります）、そのバッチに載っていたパスを 1 回だけ報告します：

```
[@wcstack/state] render chain depth limit exceeded (100 drains that rendering itself started); bindings for this batch were not applied. ["mode", "view", "view.*", "view.*.m"]
```

上限がほかの 2 つ（32）より大きいのは、ここの 1 段が 1 回の描画だからです。描いて測って直す連鎖は、32 段を超えても正当に収まります —— 見出しの文字サイズを 64px から 18px まで 1px ずつ詰めると描画は 47 回、400 行を 10 行ずつ描くと 40 段です。

コードからの書き込み —— イベントハンドラ、`$connectedCallback`、`$stream` の値、自分のコードの中の `await` の続き —— は連鎖を終わらせ、1 タスクの間が空いたときも同じです: 数は 0 からやり直しになります。値を microtask で出す要素（Lit の `updated()` など）は連鎖の中に残るので、そうした要素を通るループも打ち切られます。`$watch` を挟む循環（要素が `x` へ書き、`$watch: { x(v) { this.mode = v } }`、一覧が `mode` を読む）も、描画 1 回で 1 段ずつ伸びて打ち切られます。これは `$watch` の上限には掛かりません —— ハンドラの書き込みは、直接別のハンドラを起こすのではなく、描画を挟んで戻ってくるからです。`$stream` の restart の書き込みも数えます: microtask 1 つ分の間隔で stream を restart させる要素の書き戻しは、描画 50 回ほどで打ち切られます（stream が無ければ 100 回）。普通の一覧の行の初期同期のように収まる書き戻しは 1 段で止まり、`$watch` でつないだ有限の連鎖は 100 段を分け合います。報告は連鎖ごとに 1 回で、次のコードからの書き込みは普通に描画されます。DevTools には `state:render-chain-limit` が届きます。

1 回の更新が自分の中で仕事を生み続ける場合 —— バインディングの適用中に書き込みが起きる場合 —— は、32 周回で止められ、連鎖ごとに 1 回、パスを添えて `updates did not settle after 32 passes` と報告されます（DevTools: `maxDepth: 32` 付きの `state:render-chain-limit`）。

### 値と DOM は巻き戻しません

異常系はすべて「報告して続行」で、適用済みの値を戻すことはありません。これは以下で共通の姿勢です：

| 機構 | 上限 | 超過時 |
|---|---|---|
| 1 回の更新の中の周回 | 32 | その更新を止める。まだ描画するはずだったものは次の変更を待つ |
| `$watch` / `$stream` restart の連鎖 | 32 | 上限を越えた書き込みが起こすハンドラと stream の restart をスキップ。そのバッチのほかのハンドラは実行される |
| 描画中の書き込みの連鎖 | 100 | そのバッチのバインディング適用をスキップ |
| getter の入れ子 | 128 | `wcs/getter-depth-exceeded` を throw |
| バインディングの適用失敗 | — | その 1 本のみスキップ |

## 3.x からのアップグレード

4.0 は `@wcstack/state` の中のエンジンを置き換えます。書く対象は変わりません —— `<wcs-state>`、`data-wcs`、`{{ }}` とコメントバインディング、`for` / `if`、パスとパス getter、`$` API、`bind-component`、`mount=`、`enable-ssr`、そしてパッケージのエントリ。違いはすべて、その理由と代わりに書くものとともに [3.x → 4.0 移行ガイド](https://github.com/wcstack/wcstack/blob/main/docs/migration-v4.ja.md) にあります。手順は: まず 3.5 に上げて、その `[wcs/v4-migration]` 警告と 3.5 の lint が報告するものを片付け、それからすべての `@wcstack/*` パッケージを一度に 4.0 へ上げます —— `@wcstack/server` もクライアントと一緒に。

要点:

- **削除:** `$scan`（`$watch` か `$on` のハンドラで畳む）、3.2 の旧名 —— フィルタ `inc` `dec` `fix` `uc` `lc` `cap` `rep` `rev` `pad` `null`、`$trackDependency` / `$untrackDependency`、`$updatedCallback` / `$streams` ——、`substr` フィルタ（`slice(start, start + length)`）、`bootstrapState()` のオプション `debug`・`commentTextPrefix`・`enablePropagationContext`、`IStateElement.listPaths` / `getterPaths` / `setterPaths` / `nextVersion()`。
- **設定:** `enableMustache`・`sameValueGuard`・`enableDirectionalInitialSync` は `bootstrapState()` から各ルート state の `$behavior` へ移り、すべてのパッケージの `bootstrapXxx()` は持たないオプションで throw します（[設定](#設定)）。
- **イベント:** よく使うバブリングイベントの `on*:` ハンドラはルートへ委譲されるので、`event.currentTarget` はルートです。`#direct` でバインディングを委譲から外せます（[イベントハンドリング](#イベントハンドリング)）。
- **リスト:** リストの要素への書き込みはその位置の値を置き換えます —— 行を動かすには新しい配列を代入します（[`$resolve`](#resolve--明示的なインデックスでのアクセス)）。`for:` はフィルタを取りません（[ループ](#ループ-for)）。行と枝の要素からは `data-wcs` が取り除かれ、テンプレートの中では `outerHTML:` / `outerText:` を使えません（[ページ走査が何をバインドするか](#ページ走査が何をバインドするか)）。
- **ボリューム:** ボリュームはもう `$watch`・`$listKeys`・`$renderedCallback` を実行せず、注入も受けません（[`mount=`](#追加の状態をマウントするmount)）。
- **SSR:** 3.x のサーバーの出力は、クライアントで描画し直されます（[サーバーサイドレンダリング](#サーバーサイドレンダリング)）。
- **`$watch`:** 行の watch は `for:` も `$listKeys` も無くても発火し、行 getter の watch はすべての行で評価され、配列を丸ごと代入すると入ってきた行だけが発火します（[Watch](#watchwatch)）。
- **TypeScript:** `defineState` は `@wcstack/state/define` から import します —— `@wcstack/state` から import すると、バンドルにエンジンが残ります（[TypeScript サポート](#typescript-サポート)）。

`@wcstack/lint`・`@wcstack/typescript`・VS Code 拡張（2.0.0 から）は、4.0 と同時に公開されるリリースで 4.0 の規則を持ちます。3.x のプロジェクトでは 3.5 時代のバージョンを使い続けてください: 4.0 の規則は、3.x がまだ受け付ける書き方を報告します。

## セキュリティ

`@wcstack/state` は値を DOM に入れます。値をサニタイズはせず、値をマークアップとして読むこともありません。マークアップとして読むのはページそのものです —— そのため、規則は「何がページに届くか」と「何をどこにバインドするか」についてのものになります。

**自分で書いていないマークアップをページ走査に届かせてはいけません。** `<wcs-state>` は自分のルートをバインドするとき、マークアップの中のすべての `{{ … }}`、すべての `data-wcs` 属性、すべてのコメントバインディング（`<!--@@: …-->`）を読みます（[ページ走査が何をバインドするか](#ページ走査が何をバインドするか)）。サーバーのテンプレートやページのコードが、state ではなくページのマークアップへ書き込んだユーザーの内容も同じように読まれます: `{{ apiKey }}` と入力されたユーザー名は state の `apiKey` を描画し、投稿されたメッセージの中の `data-wcs` 属性はバインドされます —— クライアントサイドテンプレートインジェクション（CSTI）です。コメントバインディングは `$behavior.enableMustache: false` でもバインドされるので、`{{ }}` を OFF にしても防げません。4.0 には除外用の属性はありません（`data-wcs-ignore` はありません）。代わりに:

- ユーザーの内容は **state** に入れ、`textContent:`（または、テキストである `{{ }}` / コメントバインディング）でバインドしてください —— 値がマークアップとして読まれることはありません。
- ユーザーの HTML を `innerHTML:` / `html:` でバインドするのは、サニタイズした後だけにしてください。HTML のシンク（`innerHTML:`・`outerHTML:`・`srcdoc:`・`html:`）は、すでに `TrustedHTML` であるものを除くすべての値を、設置したポリシー（`setTrustedTypesPolicy()`、または `globalThis[Symbol.for("wcstack.trustedTypes.policy")]`）に通します。ブラウザに Trusted Types があってもなくても同じなので、設置したサニタイザは必ず走ります。このパッケージが identity ポリシーで値に署名することはありません（[docs/csp.ja.md §7](../../docs/csp.ja.md)）。
- サーバーのテンプレートや自分のコードに、ユーザーの内容をページのマークアップへ書かせないでください: データとして届けてください（state の中に入れるか、state へ取得する）。HTML エスケープでは足りません —— `{{ }}` はそのまま残ります。

**値は検査しません。** `href:`・`src:`・`attr.href:` にバインドした `javascript:` URL や、`attr.onclick:`（任意の `attr.on*:`）にバインドしたハンドラ文字列は、そのまま書き込まれます。URL は自分で検証し、`script-src` に `unsafe-inline` を含まない Content-Security-Policy の下でページを動かしてください。そうすればどちらも実行されません（[docs/csp.ja.md](../../docs/csp.ja.md)）。

**SSR の出力のコメントは残してください。** `@wcstack/server` の出力では、テキストバインディングと、行や枝のマーカーはコメントです。後段でそれを取り除く（html-minifier の `removeComments` など）とハイドレーションが壊れ、さらにサーバーで描画された値の中の `{{ }}` がクライアントでバインディングとして読まれることがあります。

## 設定

設定は、何を決めるかで分かれています:

| どこで | 何を決めるか | いつ読まれるか |
|---|---|---|
| `bootstrapState({ … })` | このページでのマークアップの綴り —— タグ名、バインディング属性、アンカーのコメント —— と既定のロケール | 1 回だけ、ページ全体で、要素が定義されるとき |
| state の中の `$behavior` | その state ツリーの振る舞い —— `{{ }}`、同値ガード、方向認識の初期同期 | その state が読み込まれるとき |
| state の中の `$features`（と、分割版の auto エントリでのルートの `features=`） | その state が必要とするアドオン | その state が読み込まれるとき |

### `bootstrapState()` のオプション

`bootstrapState()` に部分的な設定オブジェクトを渡します：

```javascript
import { bootstrapState } from '@wcstack/state';

bootstrapState({
  locale: 'ja-JP',
  bindAttributeName: 'data-wcs',
  tagNames: { state: 'my-state' },
});
```

全オプションとデフォルト値：

| オプション | デフォルト | 説明 |
|---|---|---|
| `bindAttributeName` | `'data-wcs'` | バインディング属性名 |
| `tagNames.state` | `'wcs-state'` | 状態要素のタグ名 |
| `tagNames.ssr` | `'wcs-ssr'` | SSR ハイドレーションデータ要素のタグ名 |
| `commentForPrefix` | `'wcs-for'` | `for:` テンプレートが自分の位置にアンカーとして残すコメントのテキスト |
| `commentIfPrefix` / `commentElseIfPrefix` / `commentElsePrefix` | `'wcs-if'` / `'wcs-elseif'` / `'wcs-else'` | `if:` / `elseif:` / `else:` の連なりが残すアンカーコメントのテキスト |
| `locale` | `<html lang>`（モジュールの評価時に読む）、無ければ `'en'` | ロケール依存フィルタ（`locale` / `date` / `time` / `datetime`）のロケール — [ロケール](#ロケール)を参照 |
| `enableContractAnalyzer` | `false` | opt-in の開発時 contract analyzer（`analyzeContract` を公開） |

`bootstrapState()` は、持たないオプション —— 4.0 が `$behavior` へ移したもの・削除したものも含む ——、既定値と型の違う値（`null`、オブジェクトが要る場所の配列）、`tagNames` の下の `state` / `ssr` 以外の名前、文字列でないタグ名で throw します（`#44`）。どれかを適用する前にすべてのオプションを検査するので、throw したときは何も適用されていません。`undefined` の値は読み飛ばされます（`bootstrapState({ locale: maybeLocale })`）。

```
[@wcstack/state] bootstrapState: "enableMustache" is not one of its options, or not of the option's type. 4.0 moved it to the state's $behavior.
```

すべてのパッケージの `bootstrapXxx()` —— `bootstrapRouter`・`bootstrapFetch`・`bootstrapAutoloader` … —— が同じ規則に従います。`/auto` のエントリを読み込むだけのページはこれらをオプションなしで呼ぶので、既定値のままで、ロケールは `<html lang>` で設定します。`getConfig()` は現在の設定（読み取り専用）を返します。

### `$behavior`

state ツリーの振る舞いは、ページではなくその state が宣言します:

```javascript
export default {
  $behavior: { enableMustache: false, sameValueGuard: false },
  count: 0,
};
```

| キー | デフォルト | 説明 |
|---|---|---|
| `enableMustache` | `true` | テキストの中の `{{ }}` はバインディング（[Mustache 構文](#mustache-構文)）。`false` なら波括弧はテキストのまま残る。コメントバインディングはどちらでもバインドされる |
| `sameValueGuard` | `true` | 現在値と `Object.is` で同値なプリミティブ書き込みを enqueue 前に落とす — バインディングと `$watch` は実質「変化時のみ」発火する（参照型は常に通す）。`false` で同値書き込みを通し、`$watch` の `prev` は `undefined` になる |
| `enableDirectionalInitialSync` | `true` | 方向認識のバインディング authority（`#init=` / `#sync=` バインド modifier）— [バインディング authority](#バインディング-authority-init--sync) 参照。`false` で opt-out: `#init=` / `#sync=` は throw し、すべての初期同期で state が勝つ |

- 各キーは boolean です。未知のキー、boolean でない値、オブジェクトでない `$behavior`（`null` と配列も含む）は throw します（`#44`）。
- 宣言した `<wcs-state>` のツリーに、そのボリュームも含めて適用されます。**ルートの state はそれぞれ自分で宣言します** —— ページのルート、shadow root の中のルートの `<wcs-state>`、マウントされたコンポーネント、DCC: ホストから継承されるものはありません。ボリュームは宣言できません（[`mount=`](#追加の状態をマウントするmount)）。
- 再設定（初期化済みの要素への `setInitialState()`）でこれを変えることはできません: 変えると `#45` を throw します —— 要素を作り直してください。`$behavior` を持たない再設定の state は既定値と比べられるので、宣言を繰り返し書いてください。
- `/auto` のページでも JSON の state（`"$behavior": { "enableMustache": false }`）でも使えます。SSR ではサーバーが同じ state を読むので、サーバーとクライアントの振る舞いは一致します。

### `$features`

`$features: ["temporal", "formats"]` は、その state が必要とするアドオンを名指します。分割版の auto エントリは、state を組み立てる前に足りないものを読み込みます。それ以外のエントリは入っているかを確かめ、入っていなければその state を `[wcs/feature-not-installed]` で失敗させます。配列でない値は `#46` を throw し、ボリュームは宣言できません。名前と、分割版の auto エントリがどの state よりも先に読むルートの `features=` 属性については [分割版の auto エントリ](#分割版の-auto-エントリ) を参照してください。

### ロケール

ロケールで書式化するフィルタは 4 つある — `locale` / `date` / `time` / `datetime`（`formats` アドオン）。
これらはページのロケール（`getConfig().locale`）を読み、その既定は **`<html lang>`** である。

```html
<html lang="ja-JP">
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

他に何も要らない。`<html lang>` はページの言語を書く HTML 標準の場所であり、
そこを既定にすればロケールの正本が 1 つで済む。同時に、オプションを取らない CDN 一発の
ページもロケールを設定できる。`<html lang>` はモジュールの評価時に読まれるので、
マークアップに書くこと。明示指定（`bootstrapState({ locale })`）は常に優先する。
`Intl` が受け付けないタグ（`<html lang="en_US">`）は、`Intl` の中で throw させる代わりに
1 回報告し（`#48`）、フィルタは `"en"` を使う。`getConfig().locale` は設定された値を返し続ける。

**ロケールを後から変えても何も再描画されない。** これは state ではなく
グローバル設定なので、依存グラフに載らない。フィルタ自体はバインド構築時に
取り込むのではなく**適用のたびに読む**ので、別の理由で再描画されたバインドは新しい値を
拾う — 起動順序の事故から復帰するには足りるが、ページの言語を切り替えるには足りない。
言語はページが描画される前に決めること。マークアップに `<html lang>` を書くか、
`<head>` の同期スクリプトで書けば構造的にそうなる。

呼び出しごとの上書き（`price|locale(fr-FR)`）は従来どおり使え、こちらはバインド式の
一部なのでバインド時に固定される。リロードなしで言語を切り替えたい場合は
[docs/i18n-design.md](../../docs/i18n-design.md) を参照。短く言えば、翻訳はフィルタでは
なくパスに置く。

**i18n の位置づけと、決めたこと。** i18n パッケージもライブな言語切替も、意図して
持たない。辞書はロケールごとに選ばれる ES モジュールで、ボリューム
（`<wcs-state mount="i18n" src="/i18n/state.js">`）としてマウントし、普通のパス
（`i18n.checkout.title`）で読む。
ロケールはページが描画される**前**に決める — フィルタは `<html lang>` から、router は
URL から。router 側のロケールはルートパラメータではなく **basename**（`/ja/…`）に置く。
したがって言語切替は state への書き込みではなく、別の basename への実ナビゲーションで
ある: router は自分の basename 配下のリンクだけを intercept するので、`/:lang` パラメータ
にすると言語が変わらないまま静かに壊れ、ライブ切替はロケール依存の全モジュールの
再評価を要求する。basename を運ぶ `<base href>` には実コストがある（ページ内アンカー・
SVG フラグメント参照・CSP 下の相対 `src` が全てそこを基準に解決される）。代替 2 案 —
router 自身が `<html lang>` を読む案と、リンク単位の intercept オプトアウト — も検討し、
記録として残した。別の形を選ぶ前に [docs/i18n-design.md](../../docs/i18n-design.md)
§9-1 を読むこと。`examples/router-i18n` が参照レイアウト。

> `$behavior.enableDirectionalInitialSync` と `enableContractAnalyzer` は **architecture-hardening** 機能で、
> 規範は `docs/architecture-hardening/` にあります。`enableDirectionalInitialSync` は**既定 on**:
> プロパティ単位で初期同期の authority を割り当て（output-only な `wcBindable` メンバは初期値を
> element→state で読み取り、双方向 / input メンバは state→element を維持）、このキーは恒久的な
> opt-out として残します。`enableContractAnalyzer` は opt-in
> （既定 `false`・無効時ランタイムコストゼロ）で、有効な場合、公開 API `analyzeContract()`
> が稼働中の `static wcBindable` サーフェスと sidecar manifest の drift を開発時診断として
> 報告します。

## ページをテストする

`<wcs-state>` で組んだページは素の DOM なので、[happy-dom](https://github.com/capricorn86/happy-dom) でヘッドレスにテストできます — ブラウザ不要・ビルド不要・テスト専用 API 不要。レシピは 3 つ、いずれも書いてあるとおりに動きます。

1 import で済ませたいなら [`@wcstack/testing`](../testing/README.ja.md) がレシピ 1 を `mount()` / `settle()` / `fire()` にまとめています（`<wcs-router>` も待ちます）。以下の素のレシピはそれ無しでも有効です。

### 1. vitest + happy-dom

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "happy-dom", setupFiles: ["./tests/setup.ts"] },
});
```

`tests/setup.ts` — 要素の登録を 1 回だけ行い、インラインの `<script type="module">` state を `data:` URL ローダーに回します（Node は `blob:` URL を import できないため、この行が無いとインライン script の state は永久に読み込み中になります）:

```ts
import { bootstrapState } from "@wcstack/state";

bootstrapState();
URL.createObjectURL = undefined as any;
```

テスト:

```ts
import { expect, it } from "vitest";
import { getBindingsReady } from "@wcstack/state";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

it("描画・再描画・ハンドラ実行", async () => {
  // 1. テスト対象の断片をマウント
  document.body.innerHTML = `
    <wcs-state json='{"count": 1, "items": ["apple", "banana"]}'></wcs-state>
    <p id="count" data-wcs="textContent: count"></p>
    <ul id="items">
      <template data-wcs="for: items">
        <li data-wcs="textContent: items.*"></li>
      </template>
    </ul>
  `;

  // 2. state 要素を待ち、続けて `document` 配下の全バインドを待つ
  const stateEl = document.querySelector("wcs-state") as any;
  await stateEl.connectedCallbackPromise;
  await getBindingsReady(document);

  // 3. 初期描画を検証
  expect(document.querySelector("#count")!.textContent).toBe("1");
  expect(document.querySelectorAll("#items li").length).toBe(2);

  // 4. writable プロキシ経由で書く — ハンドラがやっていることと同じ
  await stateEl.createStateAsync("writable", async (state: any) => {
    state.count = 42;
    state.items = [...state.items, "cherry"];
  });
  await settle();

  // 5. 再描画を検証
  expect(document.querySelector("#count")!.textContent).toBe("42");
  expect(document.querySelectorAll("#items li").length).toBe(3);
});
```

ユーザー操作と同じ経路で動かすなら、state はインライン（メソッド込み）のまま DOM イベントを発火します。`data-wcs="onclick: up"` のハンドラは `button.click()` で走り、`settle()` 1 回の後に DOM へ反映されます。

- `getBindingsReady(root)` は `root`（`document` か shadow root）配下のバインド構築が終わると resolve し、その root のルート `<wcs-state>` が初期化に失敗した場合は reject します —— ロードされなかったルートを「ready」と報告せず、失敗を報告します（[初期化の失敗](#初期化の失敗)）。`$connectedCallback` は待たないので、それには `connectedCallbackPromise` を await してください。
- 更新はマイクロタスク境界で収束します。書き込み後の `setTimeout(0)` 1 回で十分です。
- `state.items = [...state.items, "cherry"]` がリアクティブな書き方です — `state.items.push()` は観測されません（ハンドラ内と同じ規則）。
- happy-dom は `customElements.define` 時に既存ノードを**差し替えて**アップグレードします。「遅れて define された同一ノードに値が届く」はヘッドレスでは検証できません。happy-dom と実ブラウザのイベントタイミング差ももう 1 つの死角なので、そこは実ブラウザ e2e（Playwright）を 1 本残してください。

### 2. 素の Node（vitest なし）

`@wcstack/server` が SSR に使っているグローバル差し替えをそのまま export しているので再利用します。**`@wcstack/state` は `installGlobals` の後に動的 import** してください — 要素クラスはモジュール評価時に基底クラスを決めるので、ファイル先頭で静的 import すると happy-dom が構築できない要素が登録されます:

```js
import { Window } from "happy-dom";
import { installGlobals } from "@wcstack/server";

const window = new Window({ url: "http://localhost/" });
const restore = installGlobals(window);   // document, customElements, HTMLElement, ...（GLOBALS_KEYS）
try {
  const { bootstrapState, getBindingsReady } = await import("@wcstack/state");
  bootstrapState();
  // ... 以降はレシピ 1 と同じ mount / await / assert
} finally {
  restore();
  await window.happyDOM.close();
}
```

`installGlobals` は `URL.createObjectURL` の無効化も行うので、インライン script の state はレシピ 1 と同じ経路で読み込まれます。

### 3. 描画結果のスナップショット

`@wcstack/server` の [`renderToString()`](../server/README.ja.md) は描画済みマークアップを文字列で返します。保存したスナップショットと比較してください:

```ts
import { expect, it } from "vitest";
import { renderToString } from "@wcstack/server";

it("描画結果がスナップショットと一致する", async () => {
  const html = await renderToString(`
    <wcs-state json='{"items": ["apple", "banana"]}' enable-ssr></wcs-state>
    <ul><template data-wcs="for: items"><li data-wcs="textContent: items.*"></li></template></ul>
  `);
  expect(html).toMatchSnapshot();
});
```

## TypeScript サポート

`defineState()` で状態オブジェクトをラップすると、メソッドや getter 内の `this` に型補完が効きます。ランタイムコストはゼロ（アイデンティティ関数）です。**`@wcstack/state/define`** から import してください。`defineState` と型だけを持ち、ほかには何も持ちません（69 B）:

```typescript
import { defineState } from '@wcstack/state/define';

export default defineState({
  count: 0,
  users: [] as { name: string; age: number }[],

  increment() {
    this.count++;            // ✅ number
    this["users.*.name"];    // ✅ string（ドットパス型解決）
    this.$getAll("users.*.age", []); // ✅ API メソッド
  },

  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  }
});
```

`@wcstack/state` と `/core` も `defineState` を export しますが、バンドラはそれらの入口からエンジンを落とせません: `defineState` を `@wcstack/state` から import した state ファイルは、バンドルにエンジン全体（gzip で約 21 KB）を残します。どのみちエンジンを動かすバンドルでは害はありませんが、state ファイルだけを束ねるところ（ランタイムを CDN から読む、型検査やテストのビルド）では無駄になるので、`/define` を使ってください。

ユーティリティ型 `WcsPaths<T>` と `WcsPathValue<T, P>` もエクスポートされます。詳細は [docs/define-state.ja.md](docs/define-state.ja.md) を参照してください。

`defineState()` が型を付けるのは state ファイルです。その型を HTML まで運ぶのが [`@wcstack/typescript`](../typescript/README.ja.md) の 2 つの CLI で、`wcs-schema` は `@wcstack/lint` と VS Code 拡張が `data-wcs` パスの検証に使う `stateSchema` sidecar を書き出し、`wcs-tsc` はインラインの `<script type="module">` state に TypeScript コンパイラを掛けます。全体像は [docs/typescript.ja.md](../../docs/typescript.ja.md)。

## API リファレンス

### `bootstrapState()`

```javascript
import { bootstrapState } from '@wcstack/state';
bootstrapState(config?, registry?);
```

すべてのアドオンを入れ（`@wcstack/state` の場合。`/core` エントリの `bootstrapState()` は何も入れないので、先に `installFeatures([...])` を呼ぶ）、`config` を適用し（[`bootstrapState()` のオプション](#bootstrapstate-のオプション)）、`<wcs-state>` —— と、入っているアドオンのタグ `<wcs-ssr>` —— を `registry` に登録します。`registry` の既定はグローバルの `customElements` で、スコープ付きの `CustomElementRegistry` も渡せます（グローバルのレジストリの定義は継承しません）。`/auto` のエントリは、オプションなしで同じことをします。

### その他のエクスポート

| エクスポート | 説明 |
|---|---|
| `getBindingsReady(root)` | `root`（`document` または shadow root）配下のバインディングが構築されたら、`$connectedCallback` を待たずに解決。その root のルート `<wcs-state>` が初期化に失敗した場合は reject — [初期化の失敗](#初期化の失敗) 参照 |
| `buildBindings(root)` | `getBindingsReady(root)` と同じく、`document` / `ShadowRoot` 配下のバインディングを待つ: root のバインディングは、その `<wcs-state>` が state を読み込んだときに構築される |
| `getConfig()` | 現在の設定（読み取り専用ビュー） |
| `defineState(obj)` | メソッドと getter 内の `this` に型を付けるアイデンティティ関数 — [TypeScript サポート](#typescript-サポート) 参照。state ファイルでは `@wcstack/state/define` から import する |
| `setTrustedTypesPolicy(policy)` / `getTrustedTypesPolicy()` / `TRUSTED_TYPES_POLICY_SLOT` | HTML のシンクが使う Trusted Types のポリシー — [セキュリティ](#セキュリティ) と [docs/csp.ja.md §7](../../docs/csp.ja.md) 参照 |
| `VERSION` | パッケージのバージョン。`<wcs-ssr>` に刻印され、ハイドレーション時に照合される |
| `Ssr` | `<wcs-ssr>` 要素のクラス（`ISsrElement`: `version`・`stateData`・`templates`・`getTemplate()`・`verifyVersion()`。`hydrateProps` は常に空） |
| `getWcsManifest()` / `WCS_MANIFEST_VERSION` | バインディング構文・組み込みフィルタ・予約名・`$behavior` のオプション（`behaviorOptions`）・アドオン名（`features`）の機械可読 manifest — 実装から導出され、`@wcstack/lint` と VS Code 拡張が消費する |
| `builtinFilterMeta` | 全組み込みフィルタの引数・戻り値メタデータ |
| `builtinFilterAliases` | それを読むツールのために残してある。中身は空（4.0 にフィルタの別名はない） |
| `analyzeContract()` | 開発時の contract analyzer。`enableContractAnalyzer` が off なら no-op |

`@wcstack/state/core` は `bootstrapState`・`installFeatures`・`getBindingsReady`・`buildBindings`・`getConfig`・Trusted Types の関数・`defineState`・`VERSION` を export し、各 `@wcstack/state/features/<name>` は自分のアドオンを default export します。ツール向けのサブパスエントリ: `@wcstack/state/parser`（`data-wcs` パーサを DOM 非依存の純関数として公開）、`@wcstack/state/manifest`、`@wcstack/state/wcs-manifest.json`（manifest をビルド済み JSON として公開）。型 `IStateElement` も export されます。

### `<wcs-state>` 要素

| 属性 | 説明 |
|---|---|
| `mount` | この state をルートツリーへ**ボリューム**として接ぎ木する静的ツリーパス（v2 — 撤去された `name` 属性の後継。ツリーは 1 root に 1 本） |
| `state` | `<script type="application/json">` の ID — まず要素自身のルート（shadow root）で、次に document で探す。その id の JSON script だけが対象 |
| `src` | `.json` または `.js` ファイルの URL |
| `json` | インライン JSON 文字列 |
| `bind-component` | Web Component バインディングのプロパティ名 |
| `enable-ssr` | SSR を有効化: サーバーはこの state の `<wcs-ssr>` ハイドレーションデータを出力し、クライアントは再描画せずそこから復元する — [サーバーサイドレンダリング](#サーバーサイドレンダリング) 参照 |
| `features` | 文書のルートの `<wcs-state>` に書き、分割版の auto エントリだけが読む: `<wcs-state>` を定義する前に読み込むアドオン — [分割版の auto エントリ](#分割版の-auto-エントリ) 参照 |

### IStateElement

| プロパティ / メソッド | 説明 |
|---|---|
| `initializePromise` | state が読み込まれ、バインディングが構築されたら解決される Promise —— **初期化に失敗したときも解決**します（1 要素の失敗がページの他のバインディングを止めないため）。エラーは `connectedCallbackPromise` に届きます |
| `connectedCallbackPromise` | `connectedCallback` の完了（state のロード、バインディングの構築、`$connectedCallback` の実行）で解決される Promise — テストのレシピが await するもの。初期化に失敗したルート要素は、**元のエラーのまま reject** します。`$connectedCallback` が失敗した要素、失敗した DCC の定義やコンポーネントのマウントも同じです。ボリュームは常に解決します。[初期化の失敗](#初期化の失敗) 参照 |
| `createState(mutability, callback)` | 状態プロキシを作成（`"readonly"` または `"writable"`）。state が読み込まれる前は `state is not initialized`（`#15`）を throw |
| `createStateAsync(mutability, callback)` | `createState` の非同期版。readonly のプロキシはコールバックの `await` をまたいでも readonly のままで、`$setAll` と `$resolve(path, indexes, value)` の書き込みも拒否する |
| `setInitialState(state)` | プログラムから状態を設定 — 下記参照 |

`setInitialState(state)` は、初期化前なら初期 state を渡します。初期化済みの要素では state 全体を入れ替え、戻る前にすべてのバインディングを新しい state で適用し直します。再設定は書き込みではないので、`$watch` のハンドラも `$renderedCallback` も呼びません。新しい state に無いパスは、深さによらず `undefined` と読みます。そこへのバインディングは空になり（要素の入力は、ほかの `undefined` の値と同じく自分の値を保ちます）、新しい state にキーが無いリストは行を描かず、それを読む getter は `undefined` を得ます。古い state にあったトップレベルのキーは、クラスの state のプロトタイプにある getter も含めて、書き込まれるまでこのままです。どの state にも無かったキーは、どこでも同じく読むと失敗します（`#301`）。この扱いは要素の側で覚えていて、新しい state のオブジェクトには書き込まないので、凍結した state（Immer・Redux Toolkit）でも再設定できます。読めないリスト（getter が throw する）はその `for` の失敗として報告され、再設定は続行します。リストは配列の同一性で突き合わせるので、長さが変わったリストは新しい配列で渡してください（push や splice でその場で長さを変えた同じ配列インスタンスでの再設定は非対応です）。新しい state の `$behavior` が違う場合（`#45`）や、宣言の形が誤っている場合は throw し、古い state をそのまま残します。読み込み済みのボリューム（`<wcs-state mount="…">` —— データはルートの木へ複製済みなので、ルートのマウントパスの下へ書いてください）、コンポーネント（`bind-component`）や DCC の定義、ボリュームやマウント済みコンポーネントのあるツリー、初期化に失敗した要素（`#14`）では throw します —— 失敗した要素は再始動できないので、取り除いて作り直してください。バインディングの構築後に `$connectedCallback` が失敗したルートは再設定できます。再設定の後の `Object.keys(this)`・`in`・`delete`・`for…in`・スプレッド（`{ ...this }`）・`JSON.stringify(this)` は、新しい state に対して働きます。

## アーキテクチャ

```
bootstrapState(config?, registry?)
  ├── installFeatures(全アドオン)        // @wcstack/state と /auto。/core は何も入れない
  ├── setConfig(config)                  // まずすべてのオプションを検査し、それから適用
  └── define(registry)                   // <wcs-state>（+ アドオンのタグ）、バインダ

<wcs-state> connectedCallback
  ├── アドオン（scopes）が引き受ける — ルートではない:
  │   ├── ボリューム（mount=）           // その state をマウントパスの位置でルートツリーへ接ぎ木
  │   ├── DCC の定義                     // タグを定義。各インスタンスは自分のルートを持つ
  │   └── コンポーネント（bind-component）// 自前のエンジン。ホストのエンジンに配線される
  └── ルート:
        ├── state を読み込む             // state= / src= / json= / インラインスクリプト / setInitialState()
        ├── $features を読み込む／検査する
        ├── new Engine(state)            // $behavior・宣言・アクセサ
        ├── mount(engine, root)          // ルートを 1 回走査: プラン・ビュー・バインディング —— そして描画
        ├── バインディング構築完了       // initializePromise、getBindingsReady()
        └── $connectedCallback           // その後に connectedCallbackPromise
```

### リアクティビティフロー

1. state proxy を通した書き込み（`this["user.name"] = …`）が、パスをパターンと行に解決し、データを書き込みます。
2. 依存の走査が、それを読む getter の出現を dirty にし、そのパスとその下のバインディングをキューに入れます。
3. microtask で drain がリストを同期し直し、行を描画し、キューに入ったバインディングを適用します —— ページに view-transition の arbiter があれば、それを通して。
4. drain の後: `$renderedCallback`、バインディングの失敗、それからアドオン（`$watch` のハンドラ、`$stream` の restart）。

### 状態アドレスシステム

`users.*.name` のようなパスは 2 つの部分でアドレスされます：

- **パターン** — `*` で綴ったパス（`users.*.name`）ごとに 1 つ: そのセグメント、深さ（`*` の数）、親、getter や setter、それを読む getter、ルートでそのパスに登録されたバインディング。
- **リストと行** — `for:`・`$getAll`・`$watch` が読む配列の値ごとにリストが 1 つ、その要素ごとに行が 1 つ: 要素、その位置、getter のキャッシュ、その中のバインディングと入れ子のリスト。具体パス（`users.0.name`）はパターンと行の組で、行を捨てるとそこにぶら下がるものはすべて捨てられます。

マウントされたコンポーネントは自前のエンジンを動かし、そのマウントされたキーはホストのエンジンのパスを読み書きします。ボリュームの getter・setter・メソッドは、マウントパスの位置でルートツリーのアクセサになります。ツリーは 1 root に 1 本なので、アドレスに状態名はありません。

## パフォーマンス

4.0 のエンジンは書き直しで、操作ごとの数値はまだリポジトリのドライバで記録していません: リリースの一部として 4.0 のビルドで計測します。開発中、公式の [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) で計測した 4.0 エンジンの CPU 加重幾何平均は 1.08〜1.11 で、[`@wcstack/signals`](../signals/) は 1.21〜1.25、`@wcstack/state` 3.3.0 は 1.51 でした（小さいほど速い）。

手元のハードウェアで比べるには、`e2e/bench/` のドライバ（`jsfb-verify.mjs`・`memory-profile.mjs`）を実行してください: 標準の 1,000 / 10,000 行テーブルページを headless Chromium で、両実装を同一セッションで連続して、中央値で計測します。絶対値はマシン状態で ±20% 揺れます。

## サーバーサイドレンダリング

`@wcstack/state` は [`@wcstack/server`](../server/) パッケージと連携して SSR をサポートしています。クライアント用に書いたテンプレートがそのままサーバーでレンダリングされます — 変更不要。

### クイックセットアップ

1. `<wcs-state>` に `enable-ssr` を追加:

```html
<wcs-state enable-ssr>
  <script type="module">
    export default {
      items: [],
      async $connectedCallback() {
        const res = await fetch("/api/items");
        this.items = await res.json();
      }
    };
  </script>
</wcs-state>
<template data-wcs="for: items">
  <div data-wcs="textContent: items.*.name"></div>
</template>
```

2. サーバーでレンダリング:

```javascript
import { renderToString } from "@wcstack/server";

const html = await renderToString(template, {
  baseUrl: "http://localhost:3000"
});
```

これだけです。クライアント側の `@wcstack/state` は `<wcs-ssr>` 要素を見つけ、そのスナップショットからサーバーのデータを受け取り、サーバーの DOM を描画し直さずにその場でバインドします。

### 仕組み

| フェーズ | 動作 |
|---------|------|
| **サーバー** | `renderToString()` が happy-dom でテンプレートを実行、`$connectedCallback`（`fetch()` 含む）を実行し、全バインディングを適用して、`<wcs-state>` の前に `<wcs-ssr>` 要素を置いたレンダリング済み HTML を出力。行・枝・テキストバインディングにはコメントで印を付ける。`$watch` のハンドラは実行されず、stream は `initial` の値のまま |
| **クライアント** | `<wcs-state enable-ssr>` は自分のソースから state を読み込み、その上にスナップショットのデータを被せ（getter・setter・メソッドは残る）、`$connectedCallback` をスキップし、サーバーの DOM をその場でバインドする。行と枝はその場で引き継がれ —— その中のカスタム要素は 1 回だけ接続され、切断・再接続されることはない —— バインディングを得る。テンプレートに合わなくなったサーバーの行はその場所で描画し直され、クライアントが描画しない行や枝（行が少ない、別の枝）はページがバインドされた時点で取り除かれる。ボリュームはマウントパスの位置でサーバーのデータを引き継ぐ |
| **バージョン不一致** | `<wcs-ssr version>` の major.minor が違うスナップショットは `console.warn` を 1 回出して破棄され、ページはサーバーが無かったかのようにクライアントで描画される: state は自分のソースから読み込まれ、`$connectedCallback` が走り、サーバーの行・枝・マーカーは、描画元のテンプレートに場所を譲る |

### `enable-ssr` の動作

| コンテキスト | 動作 |
|------------|------|
| **サーバー**（`renderToString`） | バージョン、state のデータの JSON、ページレベルのテンプレートを含む `<wcs-ssr>` を生成 |
| **クライアント**（ハイドレーション） | `<wcs-ssr>` を読み取り、データを復元、`$connectedCallback` をスキップ、サーバーの行と枝を引き継いでバインド |

規則:

- **`@wcstack/server` とクライアントは一緒に、同じ major.minor でデプロイしてください。** 4.0 のクライアントは 3.x のサーバーの出力をクライアントで描画し直します（`<wcs-ssr version="3.5.0"> does not match 4.0.0: its snapshot is discarded, and the page renders on the client from its own state.`）—— ページは動きますが、サーバーがしたことはもう一度行われ、`$connectedCallback` が取得するデータももう一度取得されます。3.5.2 までの 3.x サーバーの出力では、テンプレートの外のテキストバインディング（ページレベルや Light DOM コンポーネントの中身の `{{ }}` や `<!--@@: -->`）はパスだけを保つのでフィルタを失い、警告がそう伝えます。3.5.3 からはマーカーが式全体を保ちますが、HTML のコメントに入れられない式（`|defaults('--')` のように `--` を含むもの）はパスだけを保ちます。切り替えるときは、3.x のサーバーからキャッシュした HTML を破棄してください。4.0 のサーバーと 3.x のクライアントの組み合わせは非対応です。詳細は [移行ガイド §3.6](https://github.com/wcstack/wcstack/blob/main/docs/migration-v4.ja.md) にあります。
- **スナップショットは JSON です。** `Date`・`Set`・`Map`・クラスのインスタンスはそこを通り抜けられません: 文字列や素のオブジェクトとして届き、クライアントの値を置き換えます。SSR の state には JSON の値を持たせ、残りは getter で導出してください（`get created() { return new Date(this.createdIso); }`）。
- **出力のコメントは残してください** —— 取り除くとハイドレーションが壊れます（[セキュリティ](#セキュリティ)）。マーカーに基づいて出力を後処理するのもやめてください: その形式は API ではありません。
- `outerHTML:` / `outerText:` はサーバーではなくクライアントで適用されます: サーバーの出力には書いたとおりの要素が入るので、その値は、検索エンジンや JavaScript なしの表示が見る HTML にはありません。
- ページレベルでバインドされた Light DOM のカスタム要素が値から描画する子は、サーバーの出力に含まれず、クライアントが描画します。自分で書いた子は出力に残ります。

API の詳細は [`@wcstack/server` README](../server/README.ja.md) を参照してください。

## ライセンス

MIT
