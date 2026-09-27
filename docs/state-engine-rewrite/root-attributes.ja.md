# state エンジン再設計 — root の `<wcs-state>` の属性で分割エントリと設定を指定する（検討）

作成 2026-09-28。対象は `research/state-engine` の `9d3ce6f0`（`packages/state-next`）。

**この文書は決定ではない。** §6 の論点を決めてから実装に入る。

## 0. 要約

1. 可能。ただし、要素が `connectedCallback` で自分の属性を読む形は成り立たない（§2）。auto 系のエントリが `define()` の前に、文書の root から 1 回だけ読む形にする（§3）。
2. この形なら core（`core.min.js`）は 0 B。core の上限までの残りは 632 B（19,368 / 20,000 B）。
3. 分割エントリの属性（`features`）には、同じビルドを構造的に保証できる利点がある。代わりに、読み込みの待ちが 1 段増え、バンドラでは使えない（§4）。
4. 設定を属性にする価値があるのは 3 キー（`enableMustache`・`sameValueGuard`・`enableDirectionalInitialSync`）だけ（§5）。
5. タグ名（`tagNames.*`）と束縛の属性名（`bindAttributeName`）は対象外（検討の前提）。

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

- 新しいエントリと `build.mjs` の出力、サイズの計測。`auto.min.js` は読み取りの分で +100〜200 B と見積もった（未計測）。
- state の README（ja / en）、[docs/sri.ja.md](../sri.ja.md) の分割エントリの節、[docs/csp.ja.md](../csp.ja.md) §2.1 の表（分割 auto の行を足す。en も）。
- vscode-wcs の lint: 未知の機能名、値の誤り、root 以外に書いた属性。
- wcstack-skill の参照（`<wcs-state>` の属性を足すため）。
- manifest に root の属性を載せるか。

## 8. 検討中に見つけたこと

- state-next では `config.debug` がどこからも読まれていない。3.x では、スキップした書き込みなどを `console.debug` に出すのに使っていた。4.0 で外すか、実装し直すかを決める。
