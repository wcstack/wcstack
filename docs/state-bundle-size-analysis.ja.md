# State バンドルサイズ解析

**English**: [state-bundle-size-analysis.md](./state-bundle-size-analysis.md)

- 解析日: 2026-09-16。
- 対象: `@wcstack/state` v2.4.0（`e67e178d`）。解析時の checkout は `596d0c15` で、state パッケージのソースは同一。
- 状態: 実測結果と今後の改善候補の記録。この文書ではランタイム・配布方式の変更を実装していない。

## 概要

サイズの問題は次の 3 つに分かれる。

1. 通常の ESM は minify されず、多量のコメントを含む。ブラウザから直接 import するとファイル全体を取得する。
2. 標準ランタイムが `$scan`、`$recursion`、streams、DCC、SSR など、アプリによっては使わない機能を静的に import している。
3. モジュール評価時のリスナー登録により、バンドラで `defineState` だけを使ってもランタイムの広い範囲が残る。

外部の本番用パッケージ依存による肥大化ではない。配布形式と初期化の境界を先に改善し、その後に機能分離を検討する。DevTools だけの削減効果は比較的小さい。

## 測定条件

- Windows、Node.js 22.19.0、Rollup 4.56.0、Terser 5.46.0、TypeScript 5.9.3。state パッケージにインストール済みのツールを使用。
- `packages/state` で `npm run build` を実施。既存の循環依存および TypeScript の `inlineSources`／ソースマップ警告は出るが、ビルドは成功。
- 現行 JavaScript は再ビルドした LF 改行の出力を測定。過去版は `git show <tag>:packages/state/dist/<file>` で Git blob を読み、checkout による CRLF 変換を避けた。
- UTF-8 のバイト数を測定。KB は 1,000 bytes。gzip は level 9、Brotli は quality 11 とし、Node の `zlib` を使用。
- 圧縮値はローカルでの測定値。CDN のレスポンスヘッダー、実際の転送量、起動時間、メモリ使用量の測定ではない。
- minify 実験は Terser の `module: true` を使用。単一 export の実験は Rollup の既定の tree-shaking 後に同じ minify を適用。
- ソースマップの帰属値は、隣接する生成側マッピング間のバイト列を対応するソースに割り当てた概算。最適化で式が結合される場合などには誤差があり、機能を削除したときの削減量を保証しない。gzip の機能別寄与は単純加算できない。

## 1. 配布サイズ

| 配布物・実験 | bytes | gzip bytes | Brotli bytes |
|---|---:|---:|---:|
| `dist/index.esm.js` | 1,079,910 | 298,401 | 217,523 |
| `dist/auto.min.js` | 229,206 | 66,981 | 56,879 |
| `index.esm.js` をメモリ上で minify | 238,101 | 69,285 | 58,732 |
| `index.esm.js` のコメントを除去し、読みやすい整形を維持 | 580,438 | 108,436 | 85,423 |

コメント除去実験では `compress: false`、`mangle: false`、`format: { beautify: true, comments: false }` を使用した。整形も変わるため、差分がコメント自体の正確なバイト数という意味ではない。

名前付き export を持つバンドルの minify により、公開機能を意図的に削らずに gzip が **76.8%** 小さくなる。これはサイズの実験であり、新しい配布物の振る舞いを回帰テストした結果ではない。

[共通 Rollup テンプレート](../config-templates/rollup.config.js)は、自己完結した `auto` バンドルがある場合、意図的に `index.esm.min.js` を生成しない。[state の exports](../packages/state/package.json)には、非 minify の名前付き export と、minify 済みの自動初期化エントリが用意されている。両者は初期化の振る舞いが異なり、`auto` は名前付き import の単純な代替にはならない。buildless でブラウザが直接 import する場合、取得するファイルは tree-shaking されない。アプリ側のバンドラでは minify できるが、§4 のコード保持の問題が残る。

追跡済み v2.4.0 の `dist` は合計 **4,898,276 bytes**。うち 2 つのソースマップが **3,379,540 bytes（69.0%）**を占める。この値は Git blob の合計で、checkout の改行によって埋め込みソースが変わるローカル再生成マップの合計ではない。また、展開済み `dist` の容量であり、npm tarball のサイズではない。ソースマップは通常のランタイム JavaScript 読み込みには含まれないが、デバッグツールが取得する場合はある。

## 2. 過去版からの増加

| バージョン | `auto.min.js` bytes | gzip bytes |
|---|---:|---:|
| v1.30.0 | 152,046 | 43,367 |
| v1.33.0 | 169,749 | 48,831 |
| v2.0.0 | 182,642 | 52,977 |
| v2.1.0 | 183,205 | 53,126 |
| v2.1.1 | 183,257 | 53,148 |
| v2.2.0 | 190,099 | 55,292 |
| v2.3.0 | 208,741 | 61,139 |
| v2.4.0 | 229,206 | 66,981 |

v2.0.0 から v2.4.0 で、minify 後の JavaScript は **25.5%**、gzip は **26.4%** 増加した。ソースマップ比較による直近の増加箇所は次のとおり。

- **v2.2.0 → v2.3.0:** 合計 +18,642 bytes。`recursion/` が約 +14,320 bytes（増加分の 76.8%）で、`proxy/` も +1,867 bytes。
- **v2.3.0 → v2.4.0:** 合計 +20,465 bytes。`scan/` が約 +14,851 bytes（72.6%）。続いて `components/`（+1,662）、`watch/`（+1,404）、`list/`（+1,331）。

これはビルド間の帰属バイト数の差であり、各機能全体のコストを対照実験で切り出した値ではない。v1.25.0 などの旧版では、`auto` は `index.esm.min.js` を import する 78-byte のスタブだった。そのスタブだけを現在の自己完結バンドルと比較してはいけない。

## 3. 現在のランタイム内訳

v2.4.0 の `auto` ソースマップでは、220 個のソースファイルにコードが帰属する。主要なディレクトリ別集計は次のとおりで、行間に重複はない。

| ソースディレクトリ | minify 後の帰属 bytes（概算） |
|---|---:|
| `webComponent/` — mount・volume・overlay・export | 23,815 |
| `components/` — State・Ssr 要素 | 22,028 |
| `bindings/` — 収集・初期化・セッション | 21,375 |
| `proxy/` — 状態アクセス・API | 18,405 |
| `scan/` | 14,851 |
| `apply/` — DOM への変更適用 | 14,394 |
| `recursion/` | 14,339 |
| `event/` | 11,990 |
| `list/` | 10,417 |
| `structural/` | 9,412 |
| `stream/` | 6,176 |
| `watch/` | 5,952 |
| `bindTextParser/` | 5,246 |
| `filters/` | 5,019 |
| `dcc/` | 4,537 |
| `devtools/` | 3,706 |

個別ファイルで大きいのは `components/State.ts`（16,952 bytes）と `bindings/BindingSession.ts`（12,910 bytes）。上の表は主要項目の抜粋で、全ファイルを網羅していない。

[State.ts](../packages/state/src/components/State.ts)は streams・watch・scan・recursion・DCC・SSR を直接 import する。[bootstrapState.ts](../packages/state/src/bootstrapState.ts)はコンポーネント、binder、SSR snapshot builder、DevTools source を登録する。アプリの state で追加機能を宣言しなければ実行を避けられる場合はあるが、`auto` から実装コードが除去されるわけではない。

SSR 関連ファイル（`components/Ssr.ts`、`hydrateBindings.ts`、`buildSsrDocument.ts`、`apply/ssrPropertyStore.ts`、`protocol/ssrSnapshot.ts`）は合計約 **10,086 bytes**。ディレクトリ別集計とルートファイルにまたがる内訳なので、上の表に加算してはいけない。他ファイル内部の SSR 分岐も含まない。

通常エントリの [exports.ts](../packages/state/src/exports.ts)は contract analyzer、filter metadata、manifest API を再 export するが、これらは生成された `auto` のマップには存在せず、既に tree-shaking で除去されている。DevTools 専用ファイルは約 3.7 KB にとどまる。ただし、他モジュールに埋め込まれた計装はこのディレクトリの集計に含まない。

## 4. 単一 export でもコードが残る問題

`dist/index.esm.js` から `defineState` だけを再 export するエントリでも、多くのコードが残る。

| 実験 | minify 後 bytes | gzip bytes |
|---|---:|---:|
| 通常エントリから `defineState` のみ | 87,349 | 26,149 |
| 同じエントリで、モジュール直下の登録 2 か所をメモリ上で除去 | 6,238 | 1,943 |
| `src/defineState.ts` を TypeScript 変換後に直接バンドル | 48 | 68 |

対象の登録は次の 2 つ。

- [watchRuntime.ts](../packages/state/src/watch/watchRuntime.ts) の `registerUpdateBatchListener(fireWatchOnUpdateBatch, WATCH_LISTENER_PRIORITY)`。
- [streamRuntime.ts](../packages/state/src/stream/streamRuntime.ts) の `registerUpdateBatchListener(restartStreamsOnUpdateBatch, STREAM_LISTENER_PRIORITY)`。

モジュール評価時に実行されるため、Rollup はリスナーとその参照先を保持し、更新処理や DOM バインディングまで残す。`VERSION` だけの export でも同様で、minify 後 87,332 bytes、gzip 26,161 bytes だった。

登録の除去はメモリ上での原因確認であり、**そのまま適用できるランタイム修正ではない**。必要な動作が欠落する。実際の修正では、適切な初期化時点で明示的・冪等に登録し、リスナーの優先度と起動時の振る舞いを維持する必要がある。除去後も 6.2 KB 残ることから、この 2 か所だけが保持要因ではない。`sideEffects: false` の一括指定でも、安全に除去できることの証明にはならない。

`defineState` 専用のサブパスを作れば、ランタイムの依存グラフを import せずに済む。直接バンドルの 48 bytes はヘルパー実装の測定値で、現在公開されているエントリの値ではない。

## 5. 改善の優先順位

1. **名前付き export の minify 配布を用意する。** 明示的なサブパスや配布方針を決め、自動初期化と名前付き API の違いを維持する。生成済み設定を直接編集せず、Rollup テンプレート・正本を編集して同期スクリプトを実行する。[SRI](./sri.ja.md) のための自己完結した `auto` 配布は維持する。
2. **ヘルパーの import とランタイム初期化を分離する。** 軽量な `defineState` エントリを設け、リスナー登録を明示的・冪等な初期化の境界に移す。サイズだけでなく初期化、登録順序、bootstrap の繰り返しを検証する。
3. **追加機能の境界を設計する。** scan・recursion・SSR・streams・DCC を検討対象とする。State や updater が静的参照するままでは、ファイル移動だけで削減できない。既定の動作を維持するか、既定を変えるなら API 移行として扱う。ディレクトリ帰属値を削減保証にしてはいけない。
4. **CI にサイズ上限を設ける。** `auto` の raw／gzip、名前付き export の配布物、`defineState` だけを使う利用側バンドルを追跡する。転送量と、展開済みパッケージ・ソースマップの容量は別の予算とする。signals には既に [size-limit 設定](../packages/signals/.size-limit.json) があるが、解析時点の state の package manifest には対応する size スクリプトがない。

## 6. 再現手順の概要

記録したリビジョンと依存バージョンを使用する。使い捨ての checkout の `packages/state` で `npm run build` を実行する。このコマンドはマップを含む追跡済み `dist` を再生成する。各ファイルを `Buffer.byteLength`／buffer の length、および Node の `gzipSync(buffer, { level: 9 })`、`brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })` で測る。

過去版は `execFileSync('git', ['show', '<tag>:packages/state/dist/auto.min.js'])` の戻り buffer を測定・圧縮する。帰属値は対応する `.map` を `@jridgewell/sourcemap-codec` で decode し、生成側の各 segment から次の segment の column までを対応ソースに割り当て、UTF-8 バイト数をディレクトリごとに集計する。マッピングのない区間を機能に帰属させない。

単一 export の実験では、`export { defineState } from '<absolute path>/dist/index.esm.js'` を内容とする仮想 Rollup エントリを使用する。既定の tree-shaking で ESM を生成し、`terser.minify(code, { module: true })` を適用する。原因確認版では、§4 の登録文 2 つだけを入力バンドルのメモリ上のコピーから文単位で除去し、同じ処理を行う。ヘルパー直接版では `src/defineState.ts` を ESNext modules、ES2022 target、コメント除去で変換し、同じ export と minify の処理を適用する。生成される識別子名は入力エントリに影響され得るため、測定値は基準値として扱い、ツール変更後も完全に同じになるとは考えない。

実施済みの検証は、パッケージビルド、圧縮測定、過去の配布物との比較、ソースマップの帰属分析、メモリ上のバンドル実験。ランタイムのテストやブラウザ性能測定は実施しておらず、動作変更を検証済みとして提案するものではない。
