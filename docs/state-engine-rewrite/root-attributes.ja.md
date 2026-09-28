# state エンジン再設計 — 分割エントリと設定を、root の `<wcs-state>` の属性や状態の `$config`・`$features` で指定する（検討）

作成 2026-09-28。対象は `research/state-engine` の `9d3ce6f0`（`packages/state-next`）。§9〜§12 は同じ日の続き（`fc3b5771` の後）。

**この文書は決定ではない。** §6 と §12 の論点を決めてから実装に入る。

## 0. 要約

1. 可能。ただし、要素が `connectedCallback` で自分の属性を読む形は成り立たない（§2）。auto 系のエントリが `define()` の前に、文書の root から 1 回だけ読む形にする（§3）。
2. この形なら core（`core.min.js`）は 0 B。core の上限までの残りは 632 B（19,368 / 20,000 B）。
3. 分割エントリの属性（`features`）には、同じビルドを構造的に保証できる利点がある。代わりに、読み込みの待ちが 1 段増え、バンドラでは使えない（§4）。
4. 設定を属性にする価値があるのは 3 キー（`enableMustache`・`sameValueGuard`・`enableDirectionalInitialSync`）だけ（§5）。
5. タグ名（`tagNames.*`）と束縛の属性名（`bindAttributeName`）は対象外（検討の前提）。
6. 続き（§9）: 設定値は、属性ではなく状態の `$config` に置く方向を推奨する。config の意味は「ページ全体の設定」から「その状態の木の振る舞い」に変わり、`bootstrapState` は表記（タグ名・束縛の属性名・コメントの接頭辞）だけを受け持つ。
7. `$features` は 8 つの後付けのうち 7 つで成り立つ。scopes は root の描画にも要るので、定義の前に入れる必要がある。その入れ方として属性が向く（§9.4）。
8. 試作で測った core の増分: 属性のみ 0 B、`$config`／`$features` のみ +429 B（上限まで残り 77 B）、属性＋`$config`／`$features` +314 B（残り 192 B）（§10）。推奨は属性＋`$config`／`$features`（§11）。

## 1. 動機

- `auto` は `bootstrapState()` を引数なしで呼ぶので、設定を渡す口が無い。ロケールは `<html lang>` を既定にして塞いだ（state README「ロケール」）が、ほかのキーは塞がっていない。
- 分割エントリは import map と module script が要る。`esm.run` から読むと、エントリごとに別のエンジンを抱えて `[wcs/feature-not-installed]` で落ちる（state README「分割エントリ」）。
- 1 行の `<script>` と `<wcs-state>` の属性だけで、使う機能と設定を書けるようにしたい。

## 2. 要素が自分の属性を読む形が成り立たない理由

| # | 理由 | 場所 |
|---|---|---|
| 1 | claim の判定が同期。root が `features` を読んで `import()` を始めても、その直後に子の `<wcs-state mount>` が upgrade される。scopes がまだ入っていないので claim は null になり、子は root として起動する | `src/element.ts` 108 行目 |
| 2 | 設定はモジュールに 1 つ。属性は「その要素に効く」ように見えるが、shadow root の中の別の root にも効く。tree order で先に起動した root は既定値で動くので、結果が起動順で変わる | `src/config.ts` 26 行目 |

1 を避けるには、すべての `<wcs-state>` の起動を「機能が揃うまで」待たせる必要がある。core の変更とバイト増が要る。

## 3. 案: エントリが `define()` の前に読む

```ts
// 新しいエントリ（仮: dist/split/auto.js）
const NAMES = ["formats", "diagnostics", "temporal", "list-keys", "scopes", "recursion", "ssr", "devtools"];
if (document.readyState === "loading") await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
const root = document.querySelector("wcs-state:not([mount]):not([bind-component])");
const names = root?.getAttribute("features")?.split(/\s+/).filter(Boolean) ?? [];
// 未知の名前は [wcs/feature-unknown] で throw
const mods = await Promise.all(names.map((n) => import(new URL(`./features/${n}.js`, import.meta.url).href)));
installFeatures(mods.map((m) => m.default));
bootstrapState(readConfigAttributes(root));
```

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state@4.0.0/dist/split/auto.js"></script>
<wcs-state features="temporal scopes" enable-mustache="false">…</wcs-state>
```

- 読むのは文書直下の root だけ（`mount`・`bind-component` を持たない最初の `<wcs-state>`）。shadow root の中の `<wcs-state>` と、後から挿入された要素（ルーターが描く中身など）は読まない。機能も設定もページ全体に効くので、文書の root にまとめて書く約束にする。
- 起動時に 1 回だけ読む。後から属性を変えても効かない（`config.locale` と同じ）。
- `auto.min.js` も設定の属性だけを読み、`features` は無視する（最初から全部入り）。同じマークアップが全部入りでも分割の形でも動く。
- 属性を読むのは auto 系のエントリだけ。`bootstrapState(config)` を手で呼ぶ形では読まない。これで優先順位の規則を作らずに済む。
- 読み取りのコードは `src/auto.ts` と新しいエントリに置く。`src/auto.ts` は `./exports` からだけ import する約束（[docs/sri.ja.md](../sri.ja.md) §6）なので、2 つで共有するなら置き場所を決める。
- `readyState` を待つのは `async` の module script のため。普通の module script は解析の後に走るので、待たずに進む。

## 4. 分割エントリ（`features`）

| 点 | 内容 |
|---|---|
| 同じビルドの保証 | `import.meta.url` からの相対で読むので、構造的に同じビルドになる。今の import map の形は、版を混ぜて書けてしまう |
| 安全 | 読めるのは既知の 8 つの名前だけ（許可リスト）。HTML に属性を注入されても、任意の URL を import させられない |
| `esm.run` | 使えないのは今と同じ。`+esm` では `import.meta.url` が別の URL になる。素の `/npm/` パスで読む |
| バンドラ | 対象外。実行時に組み立てた URL はバンドラが束ねられない。バンドラでは従来どおり `installFeatures` を呼ぶ |
| 待ち | core を読んで評価した後に features を読む、という順番待ちが 1 段増える（import map の形は並列に読める）。`<link rel="modulepreload">` で消せるが、書く量が戻る |
| SRI | 動的 import は `<script integrity>` の範囲の外。守れるのは import map の `integrity` だけ（[docs/sri.ja.md](../sri.ja.md) §5.1 と同じ扱い） |
| CSP | 問題ない。分割のファイルは `eval`・`new Function`・blob: を使わず、分割 auto はインラインのスクリプトを持たないので、要るのは配信元ホストの許可だけ（`auto.min.js` と同じ）。features は core と同じホストから読むので、許可の範囲は広がらない。起動の `<script>` に nonce を付ければ、nonce だけのポリシーや `'strict-dynamic'` でも features まで通る（最小構成で Chromium・Firefox・WebKit を確認、2026-09-28）。今の README の例（import map とインラインの起動スクリプト）は、2 つに nonce かハッシュが要る（[docs/csp.ja.md](../csp.ja.md) §2.1） |
| 読み込みの失敗 | define しないでエラーを出す案と、define して宣言ごとの `[wcs/feature-not-installed]` に任せる案がある。後者でも黙って誤動作はしない（`mount`・`bind-component`・DCC は `start()` の門で落ちる。`src/element.ts` 204 行目） |
| 推論 | `mount`・`bind-component` から scopes を、`enable-ssr` から ssr を推論することはできる。しかし `$watch` などの宣言は state を読むまで、フィルタは計画を作るまで分からない。推論できるのは一部だけなので、明示だけにする |

## 5. 設定値

| キー | 読まれる時点 | 属性にするか |
|---|---|---|
| `tagNames.*`・`bindAttributeName` | 定義時・走査時 | 対象外（検討の前提） |
| `enableMustache` | 走査時・計画を作る時（`src/dom/mount.ts` 73 行目、`src/dom/plan.ts` 320 行目） | ○ `enable-mustache="false"` |
| `sameValueGuard` | 書き込みごと（`src/engine.ts` 624 行目、`src/temporal/watch.ts` 120 行目） | ○ `same-value-guard="false"` |
| `enableDirectionalInitialSync` | 計画を作る時・wc の結線時（`src/dom/plan.ts` 70 行目、`src/dom/wc.ts` 108 行目） | ○（移行のために切れるようにする） |
| `locale` | フィルタを適用するたび | × `<html lang>` が正本。2 つ目の置き場を作らない |
| `commentForPrefix`・`commentIfPrefix`・`commentElseIfPrefix`・`commentElsePrefix` | 計画を作る時・SSR のアンカーの照合（`src/ssr/ssr.ts` 354 行目） | × サーバと値をそろえる必要があり、使われる見込みも薄い |
| `enableContractAnalyzer` | `analyzeContract()` | × JS から呼ぶ API。auto のページからは呼べない |
| `commentTextPrefix`・`enablePropagationContext`・`debug` | どこからも読まれない | × |

- 値は `"true"` / `"false"` の列挙で書く（HTML の `spellcheck="false"` と同じ）。対象の 3 キーはどれも既定が true で、使うのは「切る」ときなので、属性があれば真、という書き方では表せない。それ以外の値は throw する。
- 既存の `enable-ssr` は属性があれば真、という書き方なので、それとずれる（§6）。
- **SSR**: `@wcstack/server` は HTML を入れる前に `bootstrapState()` を呼ぶ（`packages/server/src/render.ts` 390〜408 行目）ので、この属性を読まない。`enable-mustache` がサーバとクライアントで食い違うと、ハイドレーションがずれる。
- 設定はモジュールに 1 つなので、サーバが同じプロセスで属性の違うページを描くと、描画の間で値が漏れる。これは今の `bootstrapState(config)` と同じ性質で、属性で新しく生じる問題ではない。

## 6. 決めること

| # | 論点 | 選択肢 |
|---|---|---|
| A1 | 新しいエントリの名前と、`exports` に載せるか | バンドラでは使えないので、素のパス専用にする案もある |
| A2 | 設定の属性の対象キーと値の書き方 | 推奨は §5 の 3 キーと `"true"` / `"false"`。`enable-ssr` との書き方のずれを許すか |
| A3 | root 以外に書かれた属性 | 実行時に警告する、または lint だけにする |
| A4 | サーバが同じ属性を読むか | 読むなら `@wcstack/server` に、HTML を入れた後・起動の前に読む段が要る |
| A5 | 機能の読み込みに失敗したとき | define しない、または define して宣言ごとのエラーに任せる（§4） |

## 7. 付随する作業

- 新しいエントリと `build.mjs` の出力、サイズの計測。`auto.min.js` は読み取りの分で +100〜200 B と見積もったが、試作で測ると +250 B だった（§10）。
- state の README（ja / en）、[docs/sri.ja.md](../sri.ja.md) の分割エントリの節、[docs/csp.ja.md](../csp.ja.md) §2.1 の表（分割 auto の行を足す。en も）。
- vscode-wcs の lint: 未知の機能名、値の誤り、root 以外に書いた属性。
- wcstack-skill の参照（`<wcs-state>` の属性を足すため）。
- manifest に root の属性を載せるか。

## 8. 検討中に見つけたこと

- state-next では `config.debug` がどこからも読まれていない。3.x では、スキップした書き込みなどを `console.debug` に出すのに使っていた。4.0 で外すか、実装し直すかを決める。

## 9. 続き: 状態の `$config`・`$features` で定義する方向

§3 の属性の代わりに（または一緒に）、状態オブジェクトの宣言キー `$config`・`$features` で書く方向。`$watch` などと同じ宣言キーで、状態を読んだ後・エンジンを作る前に処理する。

### 9.1 config を 3 つに分ける

| キー | 今の置き場所 | 行き先 | 理由 |
|---|---|---|---|
| `tagNames.*` | bootstrap | **bootstrap** | 定義の前に要る |
| `bindAttributeName` | bootstrap | **bootstrap** | マークアップの表記。lint・manifest・binder protocol が 1 つの名前を読む |
| `comment*Prefix`（4 つ） | bootstrap | **bootstrap** | 表記。SSR のアンカーの照合で、サーバとクライアントが一致している必要がある |
| `enableMustache` | bootstrap | **`$config`** | 読むのは走査時（`src/dom/mount.ts` 73 行目、`src/dom/plan.ts` 320 行目）。エンジンに届く |
| `sameValueGuard` | bootstrap | **`$config`** | 読むのは書き込み時（`src/engine.ts` 624 行目、`src/temporal/watch.ts` 120 行目）。エンジンに届く |
| `enableDirectionalInitialSync` | bootstrap | **`$config`** | 読むのは計画を作る時と wc の結線時（`src/dom/plan.ts` 70 行目、`src/dom/wc.ts` 108 行目）。エンジンに届く |
| `locale` | bootstrap か `<html lang>` | `<html lang>` | フィルタはエンジンを知らない（`FilterFactory` は文脈を受け取らない）。言語はページのもの（state README「ロケール」の立場） |
| `enableContractAnalyzer` | bootstrap | `analyzeContract` の引数、または bootstrap に残す | JS の API の開け閉め |
| `debug`・`commentTextPrefix`・`enablePropagationContext` | bootstrap | 削除 | どこからも読まれていない |

意味の変化:
- `bootstrapState` の設定は「このページで wcstack のマークアップをどう綴るか」（表記）になる。定義の前に決まり、サーバとクライアントで同じでなければならない。
- `$config` は「この状態の木がどう振る舞うか」になる。状態と一緒に運ばれるので、SSR ではサーバとクライアントで自動的に一致し（サーバも同じ状態を読む）、コンポーネントの振る舞いは置かれたページに左右されない。
- ページ全体の既定値は持たない（推奨）。ホストのページの設定でコンポーネントの振る舞いが変わると、コンポーネントを持ち運べなくなる。

### 9.2 `$config`

```js
export default {
  $config: { enableMustache: false, sameValueGuard: false },
  count: 0,
};
```

- エンジンを作るときに 1 回読み、既定値と合わせて固定する。読む箇所は §9.1 の 6 つで、どれもエンジンに届く。フィルタの解析結果はエンジンをまたいで共有されるが、設定には依存しない。
- 範囲: root の状態の `$config` は、その木全体（ボリュームを含む）に効く。ボリュームの状態は root のエンジンに接ぎ木されるので、ボリュームに書いた `$config` はエラーにする。コンポーネントの mount と DCC はエンジンが別なので、自分の `$config` を持ち、ホストからは継がない。
- 知らないキーと型の違う値は throw する。`setInitialState` の再セットで `$config` が変わる場合も throw する（エンジンを作り直す必要がある）。
- JSON の状態でも書ける。auto のページでも効くので、§1 の動機（auto では設定を渡せない）を満たす。

### 9.3 `$features`

- 値は名前の配列（`["temporal", "formats"]`）。全部入りでは名前の検査だけをする。同じ状態が全部入りでも分割の形でも動く。
- 分割の形では、足りない分を同じビルドから読み込む。読み込み関数は分割のエントリが受け口に置く（計測する `core.min.js` には入らない）。
- 待つのは、状態を読んだ後・エンジンを作る前（要素の `start`、コンポーネントの `start`、ボリュームの接ぎ木）。

| 後付け | 要る時点 | `$features` で |
|---|---|---|
| formats | 計画を作る時 | ○ |
| temporal・list-keys・recursion | エンジンの構築（宣言の検査） | ○ |
| ssr | 今は `start` の先頭で要求する | 検査を読み込みの後へ動かせば ○ |
| devtools・diagnostics | エンジンの構築、失敗の文面 | ○（状態を読む前の失敗は番号のまま） |
| **scopes** | `connectedCallback` の claim（同期、状態を読む前） | **×**（core を変えれば成り立つ見込み。§9.4） |

- 意味は「この状態が要る後付け」の宣言。入る先はページ全体（冪等）。diagnostics と devtools は開発環境の選択なので、この意味には合わない。
- バンドラでは、実行時に組み立てた URL を束ねられないので、`installFeatures` のまま。`$features` は検査になる。
- 再セットは同期なので待てない。検査だけにする。
- 状態を読んでから features を読む、順番待ちが増える（`modulepreload` で消せる）。
- 名前は 8 つの許可リスト、URL は分割のエントリを基準に組み立てる。状態の JSON をサーバから取っても、任意のモジュールを import させられない。
- 推論の案: temporal・list-keys・recursion は宣言（`$watch` など）から要否が分かる（`src/engine.ts` の `DECLARATIONS`）。formats は計画を作るまで分からない。

**読み込み関数の置き場所（試作で見つけた落とし穴）**: 読み込み関数は `import.meta.url` からの相対で `features/` を指すので、それを書いたファイルの位置が合っていなければならない。分割 auto のエントリが `./core`（別のエントリ）を import すると、esbuild は core.ts のコードを共有チャンク（`dist/split/chunks/`）へ移す。すると `./features/x.js` が `chunks/features/x.js` を指し、読み込めない。読み込み関数は、ほかのエントリから import されないエントリ（`dist/split/` 直下の `core.js`・`auto.js`）のそれぞれに置き、エントリ同士は import し合わない。読み込み関数が `dist/split/*.js` に入っていることをビルドで検査する。

### 9.4 scopes を属性で入れる

**子の属性（`mount`・`bind-component`）を見て、その場で読み込む形は成り立たない。** root の描画が、scopes の受け口を 3 つ使うため。

| 受け口 | 使う場所 | scopes が無いまま描くと |
|---|---|---|
| `componentScope` | root の走査（`src/dom/mount.ts` 72 行目、`src/dom/plan.ts` 319 行目） | Light DOM コンポーネントの中身まで root が結線してしまう |
| `hostBinding` | 束縛の適用（`src/dom/view.ts` 647 行目） | ホストの `state.x:` が mount の表に入らず、ただのプロパティ束縛になる |
| `element`（mounting） | エンジンの生成（`src/features/scopes.ts`） | root のエンジンが登録されず、ボリュームが接ぎ木されない |

子を見て読み込んだ時点で、root はもう描き始めているか、描き終えている。誤った結線は描き直さないと直らない。

**成り立つのは、エントリが `define()` の前に読む形（§3 と同じ）。**
- `customElements.define` は、文書と shadow root の中の `<wcs-state>` をその時点でまとめて upgrade する。scopes が入る前に起動する `<wcs-state>` は無い。子が root より前に書かれていても、別のライブラリが先に作ったコンポーネントの shadow root の中でも、後から挿入されても同じ。
- core は 0 B。
- 制約: 最初の HTML に要る。文書に root の `<wcs-state>` が無いページ（DCC やコンポーネントだけのページ）には書く場所が無い。そのときは全部入り、`installFeatures`、またはエントリの URL のクエリ（`auto.js?features=scopes`。モジュールは `document.currentScript` で自分のタグを取れないが、`import.meta.url` からクエリを読める。jsDelivr での扱いは未確認）。
- 入れ忘れは今と同じく `[wcs/feature-not-installed]`（`src/element.ts` 204 行目）で止まる。黙って誤動作はしない。

**`$features: ["scopes"]` も、core を変えれば成り立つ見込み。** scopes が無いときに `mount` などを持つ子を失敗にせず、同じ root node の root が `$features` を読み終えるまで待ってから claim し直す。root は「状態を読む → scopes を入れる → エンジンを作る → 描く」の順なので、描く時点で scopes が揃う。ボリュームが root のエンジンより先に来る場合は、今の待ち合わせで接ぎ木される。代わりに、root node ごとの Promise と子の待ちの分岐、子が root より先に解析される場合の待ち（`DOMContentLoaded`）、文書に root の無いページの扱いが要る。コードを読んだ範囲の判断で、動作は検証していない（大きさは §10 の試作 3）。

## 10. 3 案の大きさ（試作で計測）

state-next（`fc3b5771` の後の HEAD）に最小限の試作を入れてビルドし、gzip を測った。試作はコミットしていない。入っていないもの: scopes 側の変更（ボリュームの `$config` のエラー、コンポーネントとボリュームの `$features` の待ち）、テスト、短縮名の表への追加（入れれば数 B 減る）。

| 試作 | 中身 |
|---|---|
| 属性 | `auto.min.js` が root の 3 つの設定の属性を読む。分割 auto（新しいエントリ）が `features` と設定の属性を読む |
| 試作 1（`$config`） | 3 キーをエンジンごとに持つ。bootstrap は 3 キーを拒む。番号付きメッセージ 3 つ |
| 試作 2（`$features`） | 名前の検査、足りない分を読み込んで待つ、`enable-ssr` の検査を読み込みの後へ。読み込み関数は分割のエントリに置く |
| 試作 3（scopes の待ち） | scopes が要る子が、root の `$features` の確定を待ってから claim し直す |

結果（gzip、B。括弧は今の HEAD との差）:

| | 今（HEAD） | 属性のみ | `$config`／`$features` のみ（試作 1＋2＋3） | 属性＋`$config`／`$features`（試作 1＋2） |
|---|---|---|---|---|
| core（`core.min.js`、上限 20,000） | 19,494 | 19,494（0） | 19,923（+429） | 19,808（+314） |
| 上限までの残り | 506 | 506 | **77** | 192 |
| 全部入りの `auto.min.js` | 40,963 | 41,213（+250） | 41,446（+483） | 41,312（+349） |
| `index.esm.js` | 43,771 | 43,771（0） | 44,301（+530） | 44,173（+402） |
| 分割の core（`core.js` とチャンク） | 23,683 | 23,683（0） | 24,075（+392） | 23,989（+306） |
| 分割 auto（`dist/split/auto.js` の自分の分） | 166（定義するだけの場合） | 692 | 242 | 418 |

- core の内訳: 試作 1 が +164、試作 2 が +150、試作 3 が +115。`$config` だけなら +164（残り 342）。
- 読まれていない設定キー 3 つ（`debug`・`commentTextPrefix`・`enablePropagationContext`）を消すと、`auto.min.js` が −23、分割の core が −28（`core.min.js` は変わらない）。どの案でも使える。

## 11. 3 案の比較

### 属性のみ

利点:
- core は 0 B（残り 506 B を保てる）。
- 定義の前に読むので、scopes を含む 8 つの後付けと 3 つの設定を 1 か所で扱える。読む順番に左右されない。
- config の意味も bootstrap も変わらない。移行は要らない。

欠点:
- 設定はページ全体に効く（モジュールに 1 つ）。要素の属性なのに、shadow root の中の別の root にも効く。コンポーネントごとに変えられない。
- 最初の HTML に、文書の root が要る。root の無いページでは書けない。
- SSR: サーバは属性を読まないので、サーバ側に読む段が要る（`enable-mustache` のずれ）。
- 手で `bootstrapState` を呼ぶ形やバンドラでは使えない。書き方が入口ごとに分かれる（auto は属性、ほかは `bootstrapState(config)`）。

### `$config`／`$features` のみ

利点:
- 設定と要る後付けが状態と一緒に運ばれる。SSR ではサーバとクライアントで自動的に一致し、コンポーネントを持ち運べる。JSON の状態でも書ける。
- どの入口（全部入り・分割・バンドラ）でも書き方が同じ。
- HTML に新しい属性を足さない。

欠点:
- core +429 B で、上限までの残りが 77 B になる（ほぼ使い切る）。
- scopes のために、子の claim を遅らせる仕組み（試作 3）が要る。起動順の扱いが複雑で、動作は未検証。文書に root の無いページでは待つ相手がいない。
- diagnostics・devtools（開発環境の選択）まで状態に書くことになる。開発と本番の切り替えが、状態の編集になる。
- 4.0 の破壊的変更: 3 キーが bootstrap から `$config` に移る。
- 状態を読んでから features を読む、順番待ちが増える。

### 属性＋`$config`／`$features`

利点:
- 役割で分かれる。属性はページ単位のもの（状態より前に要る scopes と、開発環境の選択の diagnostics・devtools）、`$features` は状態が要る後付け、`$config` は状態の振る舞い。
- 試作 3 が要らないので、core は +314 B（残り 192 B）。
- 設定を `$config` に置くので、SSR・コンポーネント・JSON での利点は `$config`／`$features` のみと同じ。

欠点:
- 後付けを書く場所が 2 つ（`features=` と `$features`）。どちらに何を書くかを説明する必要がある（両方に書いても冪等なので害は無い）。
- 属性の制約（最初の HTML・文書の root）は、scopes と開発環境の分だけ残る。
- 4.0 の破壊的変更と順番待ちは、`$config`／`$features` のみと同じ。

### 推奨

- 属性＋`$config`／`$features`。設定の置き場所としての `$config` の利点（SSR・コンポーネント）が大きい。scopes は定義の前でないと入らないので、属性が向く。
- この案では §6 の A2（設定の属性）は要らなくなり、属性は `features` だけになる。
- ただし core の残りは 192 B になる。4.0 の残りの作業で core に足すものと取り合いになるので、入れる順番を決める。`$config`（+164 B）を先に入れ、`$features` は分割の形を使う人が出てから入れる、という分け方もある。

## 12. 決めること（続き）

| # | 論点 | 選択肢 |
|---|---|---|
| B1 | 3 案のどれにするか | §11。推奨は属性＋`$config`／`$features` |
| B2 | config の分け方 | §9.1 の表。ページ全体の既定値は持たない（推奨） |
| B3 | `$config` のキー名 | 今の名前のまま（移行が楽）、または短くする（`mustache` など） |
| B4 | `$features` に diagnostics・devtools を許すか | 許しても害は無いが、意味（状態が要るもの）から外れる |
| B5 | scopes の入れ方 | 属性（定義の前）、または `$features` と子の待ち（試作 3） |
| B6 | 宣言から後付けを推論するか | temporal・list-keys・recursion は宣言から分かる。formats は計画を作るまで分からない |
| B7 | `locale` の bootstrap での上書き | 残す、または `<html lang>` だけにする |
| B8 | `enableContractAnalyzer` の行き先 | `analyzeContract` の引数、または bootstrap に残す |
| B9 | 読まれていない設定キーと移ったキー | 4.0 で消し、渡されたら throw する（今の `setConfig` は知らないキーを黙って無視する） |
