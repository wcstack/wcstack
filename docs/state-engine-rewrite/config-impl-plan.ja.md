# state エンジン再設計 — config の分割・`$behavior`・`$features`・`features` 属性の実装計画

作成 2026-09-30。対象は `research/state-engine` の `23debc13`（`packages/state-next`）。検討は [root-attributes.ja.md](./root-attributes.ja.md)。

**状態（2026-09-30）**: 段 1〜3 を実装した（§4）。段 4（README・移行ガイド・周辺の道具）は、4.0 の差し替えの作業として [v4-remaining.ja.md](./v4-remaining.ja.md) §3・§5 に載せた。

## 0. 要約

1. [root-attributes.ja.md](./root-attributes.ja.md) §11 の推奨（属性＋状態の宣言キー）を、§6・§12 の論点を推奨どおりに置いて実装する（§1）。
2. 検討で `$config` と呼んでいた状態の宣言キーは、**`$behavior`** にした。`bootstrapState(config)`・`getConfig()`・`IWritableConfig` はモノレポのすべての I/O パッケージにある組で、状態の側を `$config` と呼ぶと 2 つが混ざる。分割の後、bootstrap の設定はマークアップの表記、状態の宣言はその木の振る舞いで、名前でも分ける。
3. 3 段に分けて入れた。段 1 `$behavior`（config の分割を含む）、段 2 `$features`、段 3 分割 auto（`dist/split/auto.js`）と `features` 属性（§4）。
4. core（`core.min.js` gzip）: 18,129 → **18,369 B（+240 B、上限まで 1,631 B）**。段 3 は core に 0 B（§3）。
5. 前回の計測（+314 B、[root-attributes.ja.md](./root-attributes.ja.md) §10）より小さい。内部名の短縮（`mustache`・`guard`・`directional`・`load`）、bootstrap と `$behavior` で 1 つにしたメッセージ番号、読み込み関数を core に置かないこと、が主な違い（切り分けはしていない）。
6. 性能は HEAD と有意な差が無い（§6）。実ブラウザ 3 つで、CSP（nonce＋`'strict-dynamic'`）の下で分割 auto が動くことを確かめた（§4 段 3）。

## 1. 前提（論点の置き方）

| # | 論点 | 置き方 |
|---|---|---|
| B1 | 3 案 | 属性＋状態の宣言キー（`$behavior`／`$features`） |
| B2 | config の分け方 | [root-attributes.ja.md](./root-attributes.ja.md) §9.1 の表どおり。ページ全体の既定値は持たない |
| B3 | 宣言キーの名前 | 入れ物は `$behavior`（上の要約 2）。中のキーは今の名前（`enableMustache`・`sameValueGuard`・`enableDirectionalInitialSync`）。移行は `bootstrapState` の引数から `$behavior` へ切り貼りするだけ |
| B4 | `$features` に diagnostics・devtools | 許す（8 つすべて）。README で役割を分けて書く |
| B5 | scopes の入れ方 | 属性（`features="scopes"`） |
| B6 | 宣言から推論 | しない（明示だけ）。入れると +32 B（§5） |
| B7 | `locale` | bootstrap に残す（変更なし） |
| B8 | `enableContractAnalyzer` | bootstrap に残す（変更なし） |
| B9 | 読まれていないキー・移ったキー | `debug`・`commentTextPrefix`・`enablePropagationContext` を消した。`bootstrapState` は知らないキー・型の違う値・移ったキーで throw（undefined の値は飛ばす） |
| A1 | 新しいエントリ | `dist/split/auto.js`。`exports` には載せない（素のパス専用、バンドラでは使えないため） |
| A3 | root 以外の `features=` | lint だけ（実行時は読まない） |
| A5 | 読み込みの失敗 | define しない（エントリのモジュールの評価が失敗し、コンソールに理由が出る） |
| — | ボリュームの `$behavior`・`$features` | エラー（root の状態に書く）。ボリュームは root のエンジンに接ぎ木されるため |
| — | `core.js` にも読み込み関数を置くか | 置かない。`core` はバンドラでも使うため、`$features` は検査だけ（置くと分割の core +342 B、§5） |

## 2. 仕様

### 2.1 `bootstrapState(config)`

- 残るキー: `bindAttributeName`・`tagNames.*`・`comment{For,If,ElseIf,Else}Prefix`・`locale`・`enableContractAnalyzer`。意味は「このページで wcstack のマークアップをどう綴るか」と JS の API の開け閉め。
- 知らないキー・型の違う値（`tagNames` はオブジェクトだけ）は `#44`（`OptionInvalid`、値は `"bootstrapState"` とキー）で throw。undefined の値は飛ばす（`bootstrapState({ locale: maybe })`）。移ったキーには diagnostics が「4.0 moved it to the state's $behavior.」を足す（core は番号と値だけ）。
- `IWritableConfig`・`Config` の型から 6 キーを外した。

### 2.2 `$behavior`

```js
export default {
  $behavior: { enableMustache: false, sameValueGuard: false },
  count: 0,
};
```

- 3 キー、値は boolean、既定はどれも true。知らないキー・型の違う値は `#44`（値は `"$behavior"` とキー）、オブジェクトでない `$behavior` も `#44`（値は `"state"` と `"$behavior"`）。
- エンジンを作るとき（`loadTarget`）に読み、エンジンの `mustache`・`guard`・`directional` に持つ（ビルドで短縮する名前）。読む箇所は次の 5 つ。

| 読む箇所 | 前 | 後 |
|---|---|---|
| `{{ }}` の走査（`src/dom/plan.ts` の `walkBindings`） | `config.enableMustache` | `engine.mustache` |
| `#init=`・`#sync=`（`src/dom/plan.ts` の `flags`） | `config.enableDirectionalInitialSync` | `engine.directional`（`flags` にエンジンを渡す） |
| wc の結線（`src/dom/wc.ts` の `attachProperty`） | 同上 | `engine.directional` |
| 書き込み（`src/engine.ts` の `write`） | `config.sameValueGuard` | `this.guard` |
| `$watch` の `prev`（`src/temporal/watch.ts`） | 同上 | `this.engine.guard` |

- 再セット（`setInitialState`）で値が変わると `#45`（`BehaviorChanged`）。`$behavior` を省いた再セットは既定値と比べる（§6）。
- 範囲: root の `$behavior` は木全体（ボリュームを含む）。ボリュームに書くとエラー（`src/scopes/volume.ts` の `REJECTED`）。コンポーネントの mount と DCC のインスタンスは自分のエンジンを作るので、自分の `$behavior` を持ち、ホストからは継がない。
- SSR: サーバも同じ状態を読むので、`enableMustache` がサーバとクライアントで食い違わない。`@wcstack/server` は `bootstrapState()` を引数なしで呼ぶ（`packages/server/src/render.ts` 177 行目）ので、変更は要らない。
- 型: `defineState` は宣言キーを 1 つずつ型にしていない（`$` で始まるキーはパスにならない、だけ）ので、変えていない。manifest の `reservedStateApi` に `$behavior`・`$features` を足した（lint・拡張が予約名として読む）。

### 2.3 `$features`

- 名前の配列。配列でなければ `#46`（`FeaturesNotArray`）。エンジンを作るとき、各名前が入っているかを検査する（`requireFeature` → `[wcs/feature-not-installed]`）。再セットは同期なので検査だけ。
- 読み込み: 受け口 `hooks.load`（分割 auto だけが埋める）。`loadFeatures(state)` を、状態を読んだ後・エンジンを作る前に呼ぶ。呼ぶ場所は要素の `start`（`src/element.ts`）とコンポーネントの `start`（`src/scopes/component.ts`、ホストの今のマウントを読む前）。DCC のインスタンスは内側の `<wcs-state>` が root として起動するので、要素の `start` で足りる。
- 読むものが無ければ `loadFeatures` は undefined を返し、`await` しない。全部入り・バンドラのページでは起動の microtask の順番が変わらない。
- `enable-ssr` の検査（`requireFeature("ssr")`）を、読み込みの後へ移した。
- 全部入り・バンドラ（`hooks.load` が null）では検査だけ。

### 2.4 分割 auto と `features` 属性

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state@4.0.0/dist/split/auto.js"></script>
<wcs-state features="scopes diagnostics">…</wcs-state>
```

- 文書の root の `<wcs-state>`（`mount`・`bind-component` を持たない最初のもの）の `features` を、`define()` の前に 1 回だけ読む。`async` の module script では `DOMContentLoaded` を待つ。
- 名前は 8 つの許可リスト。それ以外は `[wcs/feature-unknown]`。
- 読み込み関数は共有のモジュール（`src/load.ts`）に置き、エントリが自分の `import.meta.url` を渡す（`loader(import.meta.url)`）。関数が共有チャンクへ移っても `./features/` の基準がずれない（[root-attributes.ja.md](./root-attributes.ja.md) §9.3 の落とし穴の解き方）。`build.mjs` は、`auto.js` が `import.meta.url` を読んでいること、どのファイルも `auto.js` を import していないことを検査する。
- `new URL(…, import.meta.url)` と書くと、Vite（Vitest）が資産の URL に書き換える（試作で `file:///C:/dist/split/features/scopes.js` になった）。`base` の引数で受けて避けた。
- 全部入りの `auto.min.js` は `features` を読まない（最初から全部入り）。同じマークアップが両方で動く。

## 3. 計測

`node build.mjs` の出力（gzip level 9。分割は per file の合計）。段ごとの値は試作（HEAD に段ごとに重ねた）、「実装」は見直しの後の最終形（§4 の差分）。

| | HEAD | 段 1 `$behavior` | 段 2 `$features` | 段 3 分割 auto | 実装 |
|---|---|---|---|---|---|
| core（`core.min.js`、上限 20,000） | 18,129 | +152 | +75 | 0 | **18,369（+240、残り 1,631）** |
| 全部入り `auto.min.js` | 39,891 | +186 | +116 | 0 | 40,208（+317） |
| `index.esm.js` | 42,623 | +214 | +116 | 0 | 42,992（+369） |
| 分割の core（`core.js` とチャンク） | 22,208 | −13 | +96 | +4 | 22,328（+120） |
| 分割 auto（`auto.js` の自分の分） | — | — | — | 607 | 602 |
| 分割 auto（`auto.js` とチャンク） | — | — | — | 22,507 | 22,536 |
| `features/diagnostics.js`（core の外） | 5,850 | +129 | +35 | +3 | 6,019（+169） |
| `features/scopes.js`（core の外） | 7,724 | −8 | +23 | +1 | 7,754（+30） |

- 試作から実装への +13 B（core）は、オブジェクトでない `$behavior` の検査、`setConfig` の undefined と `tagNames` の検査、名前が `$config` より長い分。`index.esm.js` は manifest の予約名 2 つも含む。
- 段 1 の分割の core が減るのは、読まれていない 3 キーを消した分。
- diagnostics の増分は 3 つの文と、移ったキーの案内。

## 4. 手順と実装

### 段 1: config の分割と `$behavior`（済み）

| ファイル | 変更 |
|---|---|
| `src/config.ts` | 6 キーを外した。`setConfig` を厳しくした（`#44`） |
| `src/engine.ts` | `mustache`・`guard`・`directional` のフィールド。`loadTarget` で `$behavior` を読み、再セットでは比べる（`#45`）。`write` の読み先 |
| `src/dom/plan.ts`・`src/dom/wc.ts`・`src/temporal/watch.ts` | §2.2 の表 |
| `src/messages.ts`・`src/diagnostics/messages.ts` | `#44`・`#45` と文、移ったキーの案内 |
| `src/public/types.ts`・`src/public/manifest.ts` | `IWritableConfig` から外した。予約名に `$behavior`・`$features` |
| `src/scopes/volume.ts` | `REJECTED` に `$behavior` |
| `mangle.mjs` | `mustache guard directional` |

### 段 2: `$features`（済み）

| ファイル | 変更 |
|---|---|
| `src/hooks.ts` | 受け口 `load`、`loadFeatures` |
| `src/element.ts` | `start` で `loadFeatures` を待ってからエンジンを作る。`enable-ssr` の検査を後ろへ |
| `src/engine.ts` | `loadTarget` で名前を検査、配列でなければ `#46` |
| `src/scopes/component.ts` | `start` で `loadFeatures` を待つ |
| `src/scopes/volume.ts` | `REJECTED` に `$features` |
| `src/messages.ts`・`src/diagnostics/messages.ts` | `#46` |
| `mangle.mjs` | `load`（`Claimed.load` も同じ名前に短縮される。同じビルドなので一致する） |

### 段 3: 分割 auto と `features` 属性（済み）

| ファイル | 変更 |
|---|---|
| `src/load.ts` | `loader(base)`: 許可リスト、`base` の隣の `features/` から読む |
| `src/split-auto.ts` | `hooks.load` を埋め、属性を読み、入れてから `bootstrapState()` |
| `build.mjs` | 分割のビルドにエントリ `auto`。サイズの報告。`auto.js` の検査 |
| `vitest.config.ts` | `src/split-auto.ts` をカバレッジの対象外に（読み込むと走るエントリ。ビルドしたものを試す） |

### テスト

| ファイル | 中身 |
|---|---|
| `__tests__/behavior-features.test.ts`（新規、core だけ） | `$behavior` の既定・誤り・再セット・木ごとの同値ガード、`bootstrapState` の検査（移ったキー・消えたキー・undefined・`tagNames`）、`$features` の検査（全部入り・バンドラ）、偽の `hooks.load` で「足りない分だけ読む → 終わってからエンジン」、読み込みの失敗、`enable-ssr` が読み込みの後 |
| `__tests__/split-auto.test.ts`（新規） | core・auto・features を build.mjs と同じ設定でビルドし、ビルドした `auto.js` を読む。`features="scopes temporal"` でボリュームと `$watch`、知らない名前、`DOMContentLoaded` の待ち、`$features` の読み込みと知らない名前、`loader` |
| `__tests__/public-api.test.ts` | `setConfig` の 3 キーを `$behavior` に書き換え、誤りと `enableMustache: false` を足した |
| `__tests__/component.test.ts` | ホストの `$behavior` を継がないこと、コンポーネントの `$features` をエンジンの前に読み込むこと |
| `__tests__/scopes.test.ts` | ボリュームの `$behavior`・`$features` のエラー |
| `__tests__/coverage-element-sentences.test.ts`・`public-surface.test.ts` | 番号 44〜46 の文、manifest の予約名 |

実ブラウザ（Playwright の Chromium・Firefox・WebKit、2026-09-30）: `script-src 'nonce-abc' 'strict-dynamic'` のページで、nonce を付けた `<script type="module" src="/dist/split/auto.js">`（`async` の有無の 2 通り）が、`features="scopes"` のボリューム、`$features: ["formats", "list-keys"]` の読み込み、`$behavior` を含む状態を描き、CSP の違反は無い。知らない名前は `<wcs-state>` を定義せず、`[wcs/feature-unknown]` をコンソールに出す（確かめたスクリプトはコミットしていない）。

### 段 4: 文書と外側

4.0 の差し替えの作業として [v4-remaining.ja.md](./v4-remaining.ja.md) に載せた（state の README は 3.x の規範文書なので、今は書き換えない）。
- state の README（ja・en）: 「設定」を bootstrap（表記）と `$behavior`（振る舞い）に分ける。「分割エントリ」に分割 auto、`features=` と `$features` の役割の違い。移行ガイドに、3 キーが移る・3 キーが消える・`bootstrapState` が throw する。
- [docs/sri.ja.md](../sri.ja.md) の分割エントリの節、[docs/csp.ja.md](../csp.ja.md) §2.1 の表に分割 auto の行（en も）。
- vscode-wcs: 予約キーに `$behavior`・`$features`（manifest の `reservedStateApi` から読めるようにした）。`$behavior` のキーと型、`$features` と `features=` の名前、root 以外の `features=` の lint。**済み（2026-10-02）**: キーと型・名前は manifest の `behaviorOptions`・`features` から読む（拡張は自分の表を持たない）。
- wcstack-skill の参照（`$behavior`・`$features`・`features=`・分割 auto）。
- ~~manifest に root の属性（`features`）を載せるか（未決）。~~ **済み（2026-10-02）**: manifest に `features`（`$features` と root の `features=` が取る後付けの名前。load.ts の許可リスト `FEATURE_NAMES` から作る）と `behaviorOptions`（`$behavior` のキーと型。engine.ts の `BEHAVIOR_KEYS` の写しで、`public-surface.test.ts` が一致を固定する）を載せた。

## 5. 選択を変えたときの増分（試作で計測）

| 選択 | core | 全部入り `auto` | 分割の core | 分割 auto の自分の分 |
|---|---|---|---|---|
| B6: 宣言（`$watch`・`$stream`・`$listKeys`・`$recursion`）から推論して読み込む | +32 | +32 | +58 | 0 |
| `core.js` にも読み込み関数を置く（import map で `core` を使うページでも `$features` が読み込む） | 0 | 0 | +342（チャンクが 1 つ増える） | 404（読み込み関数がチャンクへ移る） |

- B6 は `DECLARATIONS` を `src/hooks.ts` へ移し、`loadFeatures` が宣言の分も足す形。`$listKeys` だけで list-keys が読み込まれることを確かめた。
- 宣言キーのみ（scopes を子の待ちで入れる、試作 3）は測り直していない。前回は +115 B。

## 6. 注意

- **再セットで `$behavior` を省く**: 既定値と比べるので、最初に既定でない値を書いた状態は、再セットでも同じ `$behavior` を書く必要がある。「省いたら前の値のまま」にもできる（数 B）。
- **全部入りで `$features` の名前を誤る**: `[wcs/feature-not-installed] $features needs the add-on @wcstack/state/features/temporl` になる（入っていない、としか言えない）。許可リストは分割 auto にしか無い。diagnostics の後付けで did-you-mean を足せる。
- **性能**: `bench/inpage-ab.mjs`（CPU 4 倍の減速、HEAD と今の `auto.min.js` を ABBA、各 320 サンプル）。update10k は中央値 43.2 → 44.0 ms（×1.019、p25 ×1.005、ページ 8 組の差の平均 +0.7 ms・t ≈ 1.4）、create1k は 16.3 → 15.7 ms（×0.963）。どちらも有意な差ではない。書き込みの同値ガードは、モジュールの `config` の読みがエンジンの欄の読みに変わっただけ。
- **起動の順番**: `$features` で読み込む要素は、ネットワークの分だけ遅れて起動する。`getBindingsReady` は束縛ができた時点（`initializePromise`）を待つので、`$features` の読み込みも待つ。`$connectedCallback` は待たない。
- **`features=` を読むのは文書の root だけ**: shadow root の中、後から挿入された要素（ルーターが描く中身など）の `features=` は読まない（lint で知らせる）。
- **カバレッジ付きの全体実行で `split.test.ts` がタイムアウトする**: HEAD でも起きる（beforeAll が 65 秒、上限 60 秒。単体でもカバレッジ無しで約 40 秒）。この作業の前からある問題で、`split-auto.test.ts` も同じくビルドと terser を回すので、並ぶと起きやすくなる。
