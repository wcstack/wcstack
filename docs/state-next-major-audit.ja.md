# State 次期メジャー調査

**English**: [state-next-major-audit.md](./state-next-major-audit.md)

調査日: 2026-09-18。対象: `@wcstack/state` 2.5.0、`bf27363fec154f1abb861b6b2d0f525d45274178`。
実装変更ではなく、実測・再現例・設計判断のための調査。ソースと既存の配布物は変更していない。

## 1. 判断

**次の major では「小さな状態エンジン＋DOM バインダ＋選択機能」への再設計を推奨する。ただし、全面書き直しの採用は比較試作の結果で決める。**

問題は一つではない。

1. **転送サイズ:** buildless の通常 ESM が非 minify。名前付き API の minify 配布だけでも gzip 311 KB → 71 KB になる。これはエンジンを書き直さず改善できる。
2. **機能の結合:** scan・recursion・streams・mount・SSR 等が通常ランタイムに入り、ヘルパーだけの import にも副作用が残る。分割ロードには初期化・依存方向の再設計が必要。
3. **更新性能:** 大量行の生成・破棄と、共有状態から全行 getter への通知が重い。Proxy 単体の速度だけを原因にすると改善対象を外す。
4. **意味の一貫性:** 読み書き API、空値、構文の引用符に再現可能な穴がある。さらに state・DOM・要素契約それぞれの視点が同じ文法に混在している。

「全機能を同じ意味のまま別実装へ移す」だけでは、サイズも複雑さも戻る。先に core の必須契約と拡張機能の境界を決める。

## 2. 調査条件と限界

- Windows、Intel Core Ultra 9 275HX、Node 22.19.0、Rollup 4.56.0、Terser 5.46.0、TypeScript 5.9.3。Chromium の正確な版は [ブラウザ記録](./research/state-next/selection-and-profiles.json) に保存。
- JavaScript の全4エントリを既存 Rollup 設定で一時ディレクトリに再生成。`auto.min.js` は CRLF を正規化すると checkout の配布物と完全一致。ビルドには既存の循環依存・inlineSources 警告がある。
- KB は 1,000 bytes。gzip level 9、Brotli quality 11 のローカル圧縮。CDN の実転送量ではない。
- 既存の `jsfb-verify.mjs` でクリックから MutationObserver が DOM 条件を確認するまでを測定。paint、通信、cold import、ページ起動完了時間は含まない。公式 js-framework-benchmark のスコアでも他ライブラリとの比較でもない。
- 通常・CPU 4倍 slowdown を順に測定。生成・追加・削除は8標本、置換・部分更新等はウォームアップ後10標本、swap は21標本。各操作の生標本を保存した。4倍設定は特定端末の再現ではない。
- 選択比較は各条件3回ウォームアップ＋15標本。測定前にクリック対象を解決し、計時中の全行検索を避けた。各操作後に選択行が正しく1行だけになることを検証。
- プロファイルは名前付きの非 minify ランタイムで100µsサンプリング。1操作ずつの診断用であり、通常の測定値と直接比較できない。`(program)` 等にはプロトコル往復・待機も入るため割合を原因の寄与率と解釈しない。
- メモリは各条件3標本、明示的 GC 後の JS heap。DOM のネイティブ領域・プロセス全体の RSS ではない。
- 既存の parser・filter parser・resolve の関連5ファイル、70テストが成功。追加ブラウザ調査の未捕捉 page error は0。調査スクリプトの構文と文書リンクも確認した。全パッケージの回帰・coverage 試験は実施していない。
- 単一マシンでの探索調査。過去の `bench-run.json` との数値差を回帰率とは扱わない。長時間リーク、モバイル実機、SSR 全体、全ユースケースの優劣は未判定。
- 作業ツリーには調査開始前から別作業の未追跡テストがあり、途中にもアドレス統合文書等の変更があった。これらを変更・採用せず、今回のランタイム測定は上記 revision と一致する配布物を使用した。

## 3. サイズ

### 3.1 実測

| 配布物・実験 | bytes | gzip bytes | Brotli bytes |
|---|---:|---:|---:|
| 通常 `index.esm.js` | 1,123,671 | 310,916 | 225,933 |
| 自動起動 `auto.min.js` | 235,472 | 68,843 | 58,343 |
| 名前付き ESM を minify する実験 | 244,371 | 71,194 | 60,192 |
| 通常エントリから `defineState` のみ再 export、tree-shake＋minify | 89,768 | 26,806 | 23,634 |
| 同じく `VERSION` のみ | 89,751 | 26,816 | 23,640 |
| `parser.esm.js` | 58,038 | 15,978 | 13,053 |
| `manifest.esm.js` | 44,596 | 10,382 | 8,642 |

名前付き ESM の minify による gzip 削減は **77.1%**。`auto` は bootstrap を実行するため、名前付き ESM の単純な代替ではない。ブラウザ直接 import は tree-shaking しない。

v2.4.0 の既存調査では `auto` が 229,206 bytes / gzip 66,981 bytes。今回の v2.5.0 は gzip で約2.8%増。[前回調査](./state-bundle-size-analysis.ja.md)の v2.0.0、52,977 bytes と比べると約29.9%増。

### 3.2 何が入っているか

`auto` のソースマップから生成コードを帰属させた概算。gzip の寄与でも、その機能を分離した際の削減保証でもない。

| 領域 | minify 後の帰属 bytes |
|---|---:|
| webComponent（mount・volume・overlay 等） | 24,409 |
| components（State・Ssr） | 23,871 |
| bindings（session・収集・初期化） | 21,375 |
| proxy | 19,082 |
| apply | 16,497 |
| scan | 14,851 |
| recursion | 14,339 |
| event | 11,994 |
| list | 10,506 |
| structural | 9,616 |
| stream | 6,176 |
| watch | 5,987 |
| parser | 5,246 |
| filters | 5,019 |
| DCC | 4,537 |
| devtools | 3,708 |

主要箇所の抜粋。SSR は複数領域にまたがる。DevTools やフィルタだけを削っても、大きな改善にはならない。

`State.ts` が宣言処理・ライフサイクル・DOM・追加機能を直接結び、`updater.ts` も watch/scan を参照する。watch/stream はモジュール評価時に更新リスナーを登録するため、`defineState` だけでも約27 KB gzip のランタイムが残る。副作用の位置を変えずにサブパスを増やしたり `sideEffects: false` を付けたりする案は不十分。

参照: [State](../packages/state/src/components/State.ts)、[updater](../packages/state/src/updater/updater.ts)、[watch](../packages/state/src/watch/watchRuntime.ts)、[streams](../packages/state/src/stream/streamRuntime.ts)、[bootstrap](../packages/state/src/bootstrapState.ts)。

## 4. 実行性能とメモリ

### 4.1 既存ベンチマークの中央値

| 操作 | 通常 ms | CPU slowdown 4倍 ms |
|---|---:|---:|
| 1,000行生成 | 42.85 | 127.80 |
| 1,000行全置換 | 24.35 | 136.95 |
| 10,000行中、10行ごとに更新（1,000行） | 13.10 | 67.35 |
| 1,000行で選択変更 | 0.10 | 0.45 |
| 1,000行で2行交換 | 1.30 | 4.70 |
| 1,000行から1行削除 | 3.15 | 16.50 |
| 10,000行へ1,000行追加 | 66.00 | 320.70 |
| 10,000行全削除 | 72.95 | 329.60 |

既存の keyed 判定は全項目成功。ただし全置換でも1,000個の TR がプールから再利用される。**同じ key の移動で identity を守ること**と、**別データへ DOM を再利用すること**を分けて評価すべき。input のフォーカス・未同期値・カスタム要素の内部状態については別の正しさ試験が必要。

### 4.2 普通の getter と手動最適化の差

既存 fixture は `$untrackDependency` で `selectedIndex` を依存追跡から外し、イベント側から旧・新の2行へ直接通知する。一方、比較用の普通の書き方は次の形。

```js
get "data.*.selected"() { return this.$1 === this.selectedIndex; }
onSelect(event, index) { this.selectedIndex = index; }
```

| 選択変更 | 1,000行 ms | 10,000行 ms |
|---|---:|---:|
| 既存の手動2行更新 | 0.10 | 0.10 |
| 普通の追跡付き getter | 1.00 | 21.10 |

小さい値はタイマー分解能の影響が大きいため「211倍」のような倍率は用いない。

`checkDependency` は主にパスパターン単位で依存辺を張る。全行が読む scalar が変わると `walkDependency` が行へ展開し、キャッシュを無効化して通知する。DOM への同値書き込みを抑えても、そこへ至る全行評価は残る。別行参照は `crossRowListPaths` により full expansion へ倒れる。

**Signals に置き換えるだけでは、全行が同じ scalar を読むという依存関係は消えない。** 行ごとの購読、計算結果が変化しない場合の下流通知停止、選択キーに対する専用の購読索引などを分けて試す。単なる値比較のために手動通知を要求しない方向が望ましいが、汎用 getter から常に O(1) を得られるとは約束できない。

参照: [fixture](../packages/state/__e2e__/benchmark/index.html)、[依存登録](../packages/state/src/proxy/methods/checkDependency.ts)、[依存展開](../packages/state/src/dependency/walkDependency.ts)。

### 4.3 ボトルネック候補

| 候補 | 根拠 | 次の対照実験 |
|---|---|---|
| 行生成・初期化の割り当て | CPU profile に `importNode`、`resolveNodePath`、`initializeRow`、各種登録、GC が現れる | 同じ HTML で binding slot の共有化前後を比較。DOM のみの対照を追加 |
| 行破棄とプール | 全削除 profile に `applyChangeToFor`、GC、dispose/台帳解除が現れる | pool 上限0/小/1,000、破棄と再生成の両方を測定 |
| 同期的な依存展開 | `setByAddress.notifyWrite` は書き込みの都度 `walkDependency`。drain の重複排除より前 | 同じ上流へ1/100/1,000回書くケース。read-after-write の意味を維持するバッチ無効化を比較 |
| 共通パスの多層変換 | resolved/path/state/absolute の複数表と lift、row identity の引き直し | アドレス統合の既存計画に沿った独立試作。素の読みも測る |
| 一部機能で高速行プランが使えない | `compileRowPlan` は双方向、custom element、nested構造、radio/checkbox等を含むと行全体を従来経路へ戻す | 表示行、フォーム行、I/O node行、子コンポーネント行を同数で比較 |

これらは profile とコードからの候補であり、削減率を測った結果ではない。すでに leaf path の早期 return、diff の限定展開、LIS、row plan、各種キャッシュ、同値 guard がある。これらを未実装として提案しない。

アドレス統合は [既存設計](./state-address-unification-design.md)／[実装計画](./state-address-unification-impl-plan.md)と整合させる。今回の調査は承認済みの型名・段階計画を置き換えず、統合だけで性能問題全体が解決するとも判断しない。

### 4.4 メモリ

| 条件 | GC後 JS heap MiB（中央値） |
|---|---:|
| 起動後、0行 | 1.04 |
| 1,000行 | 5.72 |
| 1,000行の生成・置換を計5回 | 6.34 |
| 1,000行で部分更新5回 | 5.98 |
| 10,000行 | 35.37 |
| 10,000行を作成後、全削除 | 13.34 |

削除後も起動時には戻らない。`applyChangeToFor` にアンカーごと最大1,000 content のプールがあり、保持の一因。ただし差額の全てをプールに帰属させたり、単一測定をリークと断定したりしない。反復時の傾き、アンカー・root を破棄した後の回収、heap snapshot の retainer を追加確認する。

`PathInfo`・`ResolvedAddress`・filter の文字列キャッシュにも無制限の Map がある。行アドレスの WeakMap 化とは別問題で、任意の動的パス種数が増える用途では寿命境界が必要。intern identity に依存する実装なので、安易な LRU 導入は正しさを壊し得る。

## 5. 文法・意味の監査

### 5.1 再現できた問題

公開 parser での結果と、実ブラウザでの結果を分ける。parser が受け付けたことだけを「ランタイム・lint とも正常」とは解釈しない。

| 項目 | 再現・現状 | 分類／優先度 |
|---|---|---|
| 引用符と区切り | `join(', ')` は通るが `join(';')`、`join('\|')` はエラー。上位層の単純 split が引用符より先に走る | 文法の欠陥・高 |
| 不正構文の取りこぼし | 閉じない引用符 `join('unterminated)` を受理。`value#ro#wo` は `ro` のみ残す。`else: ignored` は右辺を捨てる | parser の厳格化・高 |
| フィルタ cache key | `args.join(',')` が `['a,b']` と `['a','b']` を同一視。前に `join('a,b')` を解析すると `join(a,b)` の結果も `Xa,bY` になる | 引数個数検証＋構造的なキー・中。後者は余剰引数を含むが現状受理される |
| 修飾子と構文種類 | `radio: x` は専用 binding、`radio#ro: x` は通常 prop。`for#…` 等にも同じ分岐構造がある | 許可するか拒否するかを明文化・高 |
| `on` 接頭辞の占有 | `only: x`、`online: x` は event と解析される。任意の DOM/CE property と衝突する | 名前空間の整理・中 |
| `$resolve` の get/set 多重化 | 値7に対し `$resolve(path, [], undefined)` は7のまま。`undefined` を書けない | API の欠陥・高 |
| readonly の経路差 | 直接代入は throw、同じ readonly proxy の `$resolve(...,9)` は9、`$setAll(...,10)` は10を書ける | 書き込み権限チェックの不統一・高 |
| フィルタの型 | `true\|eq(true)` に相当する適用は false、数値1の `eq(1)` は true。引数は文字列で数値だけ変換 | literal 型規則の整理・中 |
| truthy 語彙 | `0n` に `truthy` は true、`boolean` は false | JavaScript の truthiness との不整合・中 |

readonly は深い不変性の保証とは別に、**同じ明示的パス書き込み API 間**でも矛盾する。原因は `StateHandler.set` の検査を helper が通らず `setByAddress` を呼ぶこと。共通の write 境界で扱うべき。

空値も同じ値の違う表示方法で差が出る。最初に `"seed"` を表示してから更新した実測:

| 入力 | `textContent: x` | `{{x}}` | `attr.title: x` |
|---|---|---|---|
| `undefined` | `seed` のまま | 空文字 | 文字列 `"undefined"` |
| `null` | 空文字 | 空文字 | 文字列 `"null"` |

これは各 DOM API と独自 skip 規則の組合せ。すべてを一律代入するより、値不在・明示クリア・表示変換の表を定義する。例えば「undefined は状態が値を持たない、null はクリア」とするなら、mustache と attr の扱いまで規範を揃え、属性削除をどう表すかも決める。

根拠: [binding parser](../packages/state/src/bindTextParser/parseBindTextsForElement.ts)、[prop parser](../packages/state/src/bindTextParser/parsePropPart.ts)、[filter parser](../packages/state/src/bindTextParser/parseFilters.ts)、[filter args](../packages/state/src/bindTextParser/parseFilterArgs.ts)、[resolve](../packages/state/src/proxy/apis/resolve.ts)、[StateHandler](../packages/state/src/proxy/StateHandler.ts)、[filters](../packages/state/src/filters/builtinFilters.ts)、[適用関数](../packages/state/src/apply/)。

### 5.2 整理したい非対称性

| 軸 | 現状 | 次期版への判断 |
|---|---|---|
| 値の読み書き | 深い通常 JS 読みはできるが `this.user.name = …` は通知しない。`this['user.name']` は通知する | path API を正規形として明示。deep Proxy を入れるなら独立した比較試作にする |
| bulk API | `$getAll` の indexes 省略はループ文脈、`$setAll` は明示 indexes 必須 | 誤った全行書き込み防止のための合理的な非対称。維持し、意味を名前・型で伝える |
| 依存 API | `$trackDependency(path)` は辺を追加、`$untrackDependency(fn)` は一時的な追跡抑止で辺を削除しない | `dependOn(path)` / `untracked(fn)` 等、逆操作に見えない候補を検討 |
| 方向 | `#ro` は element→state を抑止。一方 proxy の readonly は state 書き込み制限 | 同じ readonly の視点が異なる。binding は `to-element / from-element / two-way` のような方向語彙を検討 |
| 初期化 | `#init` は初期の勝者、`#sync` は snapshot 時機、通常の継続方向は要素契約依存 | 方向・初期値の優先元・時機の3軸を混ぜない |
| commands/events | `$commandTokens` と `$eventTokens` は対だが、配線は `command.method: $command.name` と `eventToken.prop: name`、受信は `$on` | state の path と token 名を AST で区別。surface の対称化は state 側 adapter で検討し、外部 protocol は勝手に変更しない |
| 時間の仕組み | `$streams` は複数形、`$watch` / `$scan` は単数形。stream の fold は restart でリセット、scan は継続 | 宣言 map の命名規則を揃える候補。意味が違うので1 API へ無理に統合しない |
| 更新 hook | `$updatedCallback` は state 全更新ではなく適用された bindings に依存 | `afterRender` 等、観測対象が分かる名前へ。state 反応は watch に分離 |
| scope ごとの機能 | scan は root 限定、volume では拒否、mounted component では警告して無視。root と volume で接続失敗 promise も異なる | capability 表と共通の ready/error 契約を持つ。未対応は黙って無視しない |
| structural の表記 | template 属性・comment・mustache の複数表面。embedded text は `;` を分割しない | 共通 tokenizer/AST に寄せ、既存表面は必要に応じ adapter とする |

`$watch` の wildcard 行も、headless では `$listKeys` を必要とするなど、DOM に依存しない状態機構という説明に例外がある。次期 core は行 identity と購読寿命を DOM から独立させるかを先に決める。

### 5.3 語彙の偏り

フィルタは数値・文字列・日時の表示加工が充実する一方、欠損値と型付き literal の扱いが弱い。

- `inc/dec` は変更操作に見えるが純粋な加減算。`add/sub` の方が `mul/div` と揃う。
- `uc/lc/cap/rep/rev/fix` と `truncate/percent/datetime` で略語の方針が混在。長い正規名＋互換 alias の方式なら学習・検索しやすい。
- `pad` は padStart のみ。`substr` と `slice` は引数の意味が異なる。対を増やすより標準 API に寄せて残す操作を選ぶ。
- `defaults` は0・false・空文字も置き換える。nullish 用の操作との区別が欲しい。`null` は null 定数ではなく「空文字を null にする」変換。
- `eq/ne`、`lt/le/gt/ge`、`inc/dec`、`uc/lc`、`date/time`、`ymd/hms` は既に対になっている。すべてが非対称という評価ではない。
- filter を増やすこと自体を解決策にせず、小さい標準セットと追加の formatting pack に分ける。入力変換と出力表示は同じ関数集合でも役割を区別する。

## 6. 分割ロードの設計候補

以下は新 API の確定案ではなく、依存境界の候補。

| 単位 | 内容 | 読み込み時点 |
|---|---|---|
| helper/types | `defineState`、型、version | 単独 import。初期化副作用なし |
| core | tree、path/ref、read/write、computed、batch、購読・寿命 | 常時。DOM/HTMLElement を import しない |
| DOM adapter | 通常 property/text/class/style/attr、event、基本 for/if | ページの binding 初期化前 |
| wc-bindable adapter | 契約に基づく方向・初期同期、command/event token 接続 | I/O node を使う標準プロファイルで明示登録 |
| watch/scan/streams | 時間・副作用・蓄積 | state 宣言の実体化前に登録 |
| recursion | `**` 展開 | 再帰宣言の解析前 |
| component scopes / DCC | mount、volume、overlay、定義支援 | 対象 component の初期化前 |
| SSR / hydrate | サーバー snapshot、クライアント hydration | server entry / hydration entry。役割別に分離 |
| formats / devtools | 日時等の追加 filter、観測・診断 UI 連携 | 明示 opt-in |

推奨する配布の組合せ:

1. **互換 full/auto:** 従来の全機能を自己完結バンドルとして残す。ゼロ設定と既存 SRI の契約を守る。
2. **明示構成 ESM:** 必要な features を import してから bootstrap。buildless でも機能を選べ、利用側バンドラでも削除可能にする。
3. **必要なら auto-split:** 宣言から機能を見つけて import する非同期 loader。上の2つができた後に評価する。

**単純に `import()` へ置き換えてはいけない。**

- core から feature の静的 import をなくし、明示的・冪等な登録 API と feature ごとの dispose を作る。feature が無い場合の hot path は空の通知機構だけで済ませる。
- batch 内の順序（render hook → scan → watch → streams restart）と例外隔離を維持するか、major の変更点として定義する。
- 宣言や filter を見つけた後でロードする場合は ready barrier を持ち、未ロード機能を黙って無視しない。同期 getter/setter の途中ではロードできない。
- 遅着 DOM、`setInitialState`、再接続、SSR hydration にも同じ barrier が要る。単なる初回 DOM 全走査では足りない。
- subpath ごとに core を丸ごと再バンドルしない。同じ registry・address identity を共有する単一 core chunk を参照させる。混在版・別 URL の二重インスタンスも検出する。
- 小さすぎる分割はリクエスト数・RTT・圧縮効率を悪化させる。base、temporal、component、SSR 程度から測る。
- 動的 chunk まで入口 script の SRI だけで保護されたことにはならない。既存 [SRI 方針](./sri.ja.md)に沿い、full と split の配布契約を分ける。

分離できそうなディレクトリのバイト数を足して「core は X KB」とは算定しない。実際に依存を切った試作が必要。

## 7. 作り直しを含む選択肢

| 選択肢 | 利点 | 残る問題・リスク | 判断 |
|---|---|---|---|
| 現行の局所改善 | minify・helper 分離・構文不具合を早く直せる | 結合と例外規則は残る | 先行実施に適する |
| 内部 core と DOM 層を段階的に置換 | authoring/protocol を維持しながら比較できる | 互換 adapter と二重期間が必要 | 第一候補 |
| 全面新実装＋文法変更 | 不要な契約も削り、最小設計を作れる | mount、row identity、SSR、IO、tooling の長い契約を再実装する費用が大きい | 比較試作に勝ち、移行を説明できた場合に採用 |

新 core の試作では次を検証する。

- **状態の owner と DOM の owner を分ける。** DOM を外しても必要な computed/watch が機能し、root dispose で購読を解放できる。
- **path は authoring contract、内部は解決済み参照。** 解析・scope 翻訳は登録時へ寄せ、tree identity と行 occurrence identity を失わない。
- **template plan と行インスタンスを分ける。** 固定情報を共有し、行には node/ref/値/teardown の必要分だけを持つ。既存 row plan の成果を引き継ぐ。
- **write の権限・同値・invalidation を一箇所へ。** direct set、resolve、bulk、token、stream が同じ検査を通る。
- **文法の解析と実行を分ける。** quote-aware lexer → AST → 解決済み binding plan。parser が filter の実関数まで作る現在の結合を外す。位置情報・診断を lint/editor と共有する。
- **Proxy と signals は比較する実装手段。** 自前の小さいグラフと既存 `@wcstack/signals` の利用を対照にする。DOM 機構を含まない signals の単体サイズを state 全体と比較しない。zero-dependency 方針を維持するならパッケージ依存化の扱いも決める。

比較試作は同じ画面・同じ機能で行う。scalar、分岐 getter、集計 getter、別行参照、二重リスト、フォーム、I/O node、遅延定義、mount/volume、SSR hydrate を含める。既存プロトコルとテスト資産は再利用する。

## 8. 推奨順序と採否の基準

1. **契約を固定:** 今回の再現例を regression case にし、readonly・空値・型付き literal・scope capability・ready/error の意味を決める。grammar の共通正本を作る。
2. **低リスクの配布改善:** 名前付き minify entry、純粋 helper entry、明示的な feature 初期化、サイズ CI。Rollup の生成コピーではなくテンプレートと同期処理を変更する。
3. **比較試作:** 現行改善版と新 core＋DOM adapter を同じベンチで測る。アドレス統合は別の変数として管理し、何が効いたかを分ける。
4. **major の範囲決定:** 利用実績を調べ、標準・追加・廃止・互換 adapter の機能表を作る。使用頻度はコードの大きさから推測しない。
5. **移行:** 旧文法を parse して新 AST へ変換する期間を用意し、変換不能な意味変更は lint 診断・具体例を付ける。README 英日、manifest、lint、editor、devtools、SSR、別 repo の wcstack-app skill を同期する。

採否のための**暫定目標**（達成見込みの測定値ではない）:

- 名前付き full entry: gzip 約72 KB以下を当面の基準。helper 単独 import はランタイムを保持しない。
- base＋DOM の選択構成: gzip 35 KB以下を試作目標とし、除外した機能を必ず明記。外れる場合は機能表と測定から再判断する。
- 生成・追加・全削除: 現行より中央値25%以上改善を採用目標。素の read、部分更新、swap、起動時間で悪化を隠さない。
- 選択: 最適化が必要な書き方を API で支援し、通常 getter の O(N) ケースも公開する。ベンチ専用コードだけの高速化を成功条件にしない。
- メモリ: create/clear と root attach/dispose を数十周期測り、GC後の増加傾向・保持主体を確認。プールの上限と寿命を仕様化する。
- 同一環境で順序を交互にした A/B、複数 browser process、十分な標本とばらつきを使う。小さな差や0.1ms領域の倍率では採用を決めない。

## 9. 再現と成果物

リポジトリの既存依存を使う。性能測定を互いに並行させない。

```powershell
# repository root: build and size/parser experiments (does not write packages/state/dist)
node scripts/audit-state-next.mjs
node scripts/audit-state-browser.mjs

# e2e directory
node bench/jsfb-verify.mjs --label next-major --out ../docs/research/state-next/browser-1x.json --port 4297
node bench/jsfb-verify.mjs --label next-major-4x --throttle 4 --out ../docs/research/state-next/browser-4x.json --port 4297
node bench/memory-profile.mjs --label next-major --out ../docs/research/state-next/memory.json --port 4297
```

ブラウザ追加調査は、一時ビルドの場所を size JSON から読むため、size 調査の後に実行する。既存ベンチは checkout の dist を読むので、記録した `autoMatchesCheckedInIgnoringCRLF` が true であることを確認する。別 revision で false の場合は dist を一致させてから性能を測る。

- [サイズ・parser 再現・環境](./research/state-next/size-and-syntax.json)
- [通常環境の全標本](./research/state-next/browser-1x.json)
- [CPU slowdown 4倍の全標本](./research/state-next/browser-4x.json)
- [選択比較・API/空値再現・CPU診断](./research/state-next/selection-and-profiles.json)
- [GC後メモリ](./research/state-next/memory.json)
- [サイズ調査スクリプト](../scripts/audit-state-next.mjs) / [ブラウザ調査スクリプト](../scripts/audit-state-browser.mjs)

機能分割、新エンジン、文法変更は未実装。本調査はそれらの採用を決める根拠と、次に測るべき差分を用意したもの。
