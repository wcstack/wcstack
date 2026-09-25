# state エンジン再設計 — 後付け機能の計画（第 3 段階）

作成 2026-09-25。前提:
- コアの範囲はすべて実装済み（[core-build-plan.ja.md](./core-build-plan.ja.md) 段 0〜7、`packages/state-next`）。core 19.5KB gzip、上限 20KB まで約 0.5KB。
- 後付けと決めた機能: mount/volume・コンポーネントの mount（`bind-component`）・temporal（`$watch`／`$stream`）・`$recursion`・SSR・DCC・`$listKeys`・診断・DevTools（formats は済み）。`$scan` は廃止と決定済み（[scope-classification.ja.md](./scope-classification.ja.md) §9）。

調査は 4 つの読み取り専用エージェントに分担させた（2026-09-25。scopes／temporal と `$listKeys`／recursion と SSR／診断と DevTools）。以下の数値はその報告と `docs/research/state-engine/` のデータによる。

## 0. 要約

1. **配布は「1 回のビルドで分割出力」にする。** コアと後付けを同じ esbuild ビルドから `core.js`＋`features/*.js`＋共有チャンクとして出すと、内部名の短縮表が全出力で共有され、後付けはコアの内部に直接触れる（実験で確認）。コアに要るのは「コアから後付けを呼ぶ」地点だけで、後付け向けの公開 API は要らない。条件は、コアと後付けを同じビルド（同じ版）から配ること。
2. **コアから後付けを呼ぶ地点は 15 ほど。** 書き込み・drain の終わり・リストの突き合わせ・ライフサイクル・書き込みの前の拒否・`$` API の追加・宣言の受け取りなど。後付けが無ければ、それぞれ null 判定 1 回。
3. **モデルの変更が要るのは 2 つだけ。** コンポーネントの mount（1 つのエンジンが複数の根と行ごとの私有データを持つ）と SSR のハイドレーション（既存の DOM を計画に沿って引き取る）。recursion は受け口で足りる。
4. **調査でコアの約束の穴が見つかった。** 後付けより先に直す（段 8）。共有語彙から外れたエラーコード 3 つ、`$10`〜`$128` が効かない、余分な添字を黙って無視、トップレベルの打ち間違いが黙る、接頭辞の不統一、後付けの宣言を黙って無視する。
5. **使われ方に比べて重い契約が多い。** 例: volume の注入（テスト 29・デモ 0）、エクスポートした getter（約 46・デモ 0）、recursion（テスト 335・デモ 1）。後付けごとに「残す・簡素化・落とす」を決めてから移植する（§5）。

## 1. 配布と結線の形

### 1.1 1 回のビルドで分割出力

`splitting: true` の esbuild ビルドで、次を 1 度に出す。

| 出力 | 中身 | 用途 |
|---|---|---|
| `dist/core.js` | コア | 必要な機能だけを入れるページ（import map・バンドラ） |
| `dist/features/<name>.js` | 各後付け | `installFeatures([...])` で入れる |
| `dist/chunk-*.js` | 共有部分 | 上 2 つが import する |
| `dist/auto.min.js` | コア＋全後付け（自己完結） | CDN の 1 行。SRI の 1 属性で全体を覆う（現行と同じ） |

- 短縮表（`mangle.mjs`）は 1 回のビルドの中で全出力に共通なので、後付けは `engine.<短縮名>` のまま内部に届く。`split-probe` の実験で、コアと後付けが同じ短縮名（`e`・`n`・`i`）を共有して動くことを確かめた。
- 代わりに、**コアと後付けは同じビルドから配る必要がある**（別の版の組み合わせは不可）。全パッケージの版をそろえて出す現行の方針と同じ。
- 現行の `@wcstack/state/core`＋`/features/*` と同じ入口の形にする。入れていない機能を宣言が要求したら `[wcs/feature-not-installed]` で案内する（現行の barrier と同じ文言）。

### 1.2 コアから後付けを呼ぶ地点（フック）

コアのモジュールに 1 つの `hooks` 表を置き、後付けは install 時にそこへ関数を置く。コアは各地点で `hooks.x !== null` を見るだけ。後付けからコアへの呼び出し（読む・書く・行をたどる・getter を評価する）は、同じビルドなので内部関数を直接使う。

| # | 地点（新エンジンの場所） | 呼ばれる時 | 使う後付け |
|---|---|---|---|
| F1 | `written(engine, p, row, old, hasOld)`（`Engine.write`・setter・`$postUpdate`） | 状態に書いた直後 | temporal（landing と `prev`）・DCC（変更イベント）・DevTools |
| F2 | `beforeWrite(engine, p, row, value) → 処理済みか`（`Engine.write` の先頭） | 書く前 | `$listKeys`（キー付きの突き合わせ）・recursion（展開の読み取り専用）・volume（祖先への書き込みの拒否）・mount の `#ro` |
| F3 | `getterReached(g, row)`（`visitGetter`） | 変更が getter の出現に届いた | temporal（getter の監視・stream の `args`） |
| F4 | `listSynced(list, oldRows)`（`Engine.sync`） | リストを突き合わせた後 | temporal（行の landing） |
| F5 | `drained(engine)`（`drain` の終わり・`report` の後） | 1 回の drain の後 | temporal（`$watch` の発火・stream の再開）・DevTools（update-batch）・volume の `$renderedCallback` |
| F6 | `declare(engine, target)`（`Engine` の構築時と `reset` の差し替え前） | 状態を受け取った時 | temporal・recursion・`$listKeys`・DCC の宣言の解析。未 install の宣言はここで barrier |
| F7 | `element(el, phase)`（`WcsState` の接続・切断・再接続・`$connectedCallback` の後・再セットの前後） | 要素のライフサイクル | volume と DCC（要素の引き取り）・temporal（開始と停止）・SSR（ハイドレーションの選択） |
| F8 | `dollar(engine, key)`（`Engine.dollar` の最後） | 知らない `$` 名 | temporal（`$streamStatus`／`$streamError`） |
| F9 | `recursive(engine, p, ctx, op)`（`**` を含むパターン。`Pattern` に 1 ビット） | `**` のパスを解決する時 | recursion。未 install なら `[wcs/recursion-unsupported]` |
| F10 | `accessor(engine, key, descriptor) → 引き取ったか`（`registerAccessors`） | `**` や後付けの getter の登録 | recursion（getter の族）・volume（chroot の getter） |
| F11 | `bindingSpec(engine, spec, el) → 置き換え`（`plan.ts` の `specFor`） | テンプレートを計画にする時 | コンポーネントの mount（`state:`／`state.x:` を mount 表へ）・診断（束ねたパスの検査） |
| F12 | `adopt(plan, row) → 既存ノード`（`buildBlock`） | ブロックを作る時 | SSR のハイドレーション（複製せず引き取る） |
| F13 | `failed(engine, error, info)`（`report`） | バインディングの失敗 | DevTools |
| F14 | `emitted(token, args)`（`Token.emit`） | トークンの発火 | DevTools |
| F15 | `engine(engine, connected)`（`element.ts` の `start`・切断） | エンジンの生成・切り離し | DevTools・volume（根のエンジンを待つ） |

- 各地点はコアで 15〜40 バイト程度。全部で約 0.4KB gzip の見込み（段 8 で実測）。
- コアの側に要る小さな修正: 後から足した getter のスロットで行のキャッシュ配列の長さを超えないこと（F10、`strategy/dirty.ts`）、再セットで宣言の検査が失敗したら状態を差し替えないこと（F6）。

### 1.3 外から見る面（DevTools）

`@wcstack/devtools` は別のパッケージで、短縮名には触れられない。DevTools の後付けが、内部から**短縮されない名前の見取り図**（引用符付きのキー）を作って渡す。コアは何も公開しない。

## 2. 段 8（後付けの前に）: コアの約束の穴

調査で見つかった、README の約束とのずれ。後付けとは独立に直す。

| # | 穴 | 直し方 |
|---|---|---|
| 1 | `wcs/binding-type`・`wcs/command-token`・`wcs/event-token` が lint／VS Code 拡張と共有する語彙に無い | `wcs/binding-type-expectation`・`wcs/token-undeclared`・`wcs/token-misconfigured` に合わせる |
| 2 | `$10`〜`$128` が `undefined` を返す（`$1`〜`$9` しか扱っていない） | `$` ＋数字を 128 まで。範囲外は `[wcs/index-param-range]` |
| 3 | `$resolve`／`$getAll`／`$setAll` の余分な添字を黙って無視 | `[wcs/index-arity]` で throw（README の約束） |
| 4 | for の外で行のパスを読む等が、コード無しの `[state-next] …` | `[wcs/wildcard-rank]` |
| 5 | メッセージの接頭辞が `[state-next]` | `[@wcstack/state] [wcs/…]` に統一 |
| 6 | トップレベルの打ち間違い（`{{ cout }}`）が黙って空になる | 現行どおり、状態に無いトップレベルのキーの読みを `[wcs/binding-path-missing]` で失敗にする（README の約束）。深いパスの欠落は診断の後付けで警告する |
| 7 | `$watch`／`$stream`／`$recursion`／`$listKeys`／`mount=`／`bind-component` を黙って無視 | F6・F7 で `[wcs/feature-not-installed]`（入れるべき入口を案内） |
| 8 | サーバの準備待ちに使う `static hasConnectedCallbackPromise` が無い | 足す（SSR の前提。`@wcstack/server` が見る） |

- 6 は、段 7 で宣言した意図した差分（新しい状態に無い**深い**パスは空）とは両立する。トップレベルだけ現行と同じ失敗に戻す。

**着手済み（2026-09-25・判断の要らない 1〜5 と 8、未コミット）**
- 1〜5 と 8 を直した。token の購読者の失敗の接頭辞の誤記（`[wcstack/state]`）と、`LINT_HINT` の重複も直した。
- `__tests__/core-contract.test.ts`（8 件）: `$10`（10 段の行の getter）、`$0`／`$129`／`$01` の拒否、`$resolve` はちょうど・`$getAll`／`$setAll` は上限、token-undeclared の候補表示、接頭辞。全 562 件が通過。
- **サイズの問題**: core は 19.87KB gzip（+0.37KB）になり、上限まで 0.13KB しか残っていない。フック（約 0.4KB）と 6・7 が入らない。文字列が約 2.2KB あり、ほとんどが長い助言付きのエラーメッセージ。1 回のビルドに限った名前の追加短縮（`engine`・`factory`・`arity`）は 24B しか縮まない。→ §5.3 で判断を仰ぐ。

**段 8 の完了（2026-09-25・著者承認「すべて承認」、未コミット）**
- 承認された判断: 配布は 1 回のビルドで分割出力（1）、core のエラーはコードと事実だけで助言文は診断の後付け（案 A）、トップレベルの欠落と未 install の宣言の失敗（6・7）、後付けの順番、§5.2 の簡素化。
- **案 A**: 長い助言文・did-you-mean・lint への誘導を core から外し、`features/diagnostics`（`hooks.explain`）へ移した。`raiseError(message, subject?, candidates?)` が、診断が入っていれば助言を付け足す。具体的な直し方（`write "join(', ')|uc"` など）も、診断が文面から組み立てる。全部入りの `auto` は診断を入れるので、利用者の見え方は現行と同じ。助言を確かめるテストは、そのファイルの先頭で診断を入れて確かめる。core −0.99KB。
- **6**: 状態に無いトップレベルのキーの**読み**は `[wcs/binding-path-missing]` で失敗（現行どおり）。`for:` のリストが無い場合もそのバインディングの失敗として報告し、リストは空で作るので、後から書けば描画される。現行との差（意図した差分として宣言）: 現行は無いキーへの**書き込み**も失敗にする（書く前に旧値を読むため。README の約束は読みだけ）。新エンジンは書き込みでキーを作れる。
- **7**: `$watch`／`$stream`／`$listKeys`／`$recursion` の宣言、`mount`／`bind-component`／DCC の定義要素／`enable-ssr` の `<wcs-state>` は、後付けが入っていなければ `[wcs/feature-not-installed] … needs the add-on @wcstack/state/features/<name>`。`$scan` は廃止を伝える。状態のパスの `**` は `[wcs/recursion-unsupported]`（パターンを作る前に止める）。
- **受け口の足場**: `src/hooks.ts`（`hooks` 表・`installFeatures`・`requireFeature`）。呼び出し地点は、使う後付けを実装する段で足す（使い手のいない呼び出しで core を太らせない）。
- **分割ビルド**: `build.mjs` が `dist/auto.min.js`（全部入り・自己完結）・`dist/core.min.js`（core だけ・自己完結＝サイズ目標の計測対象）・`dist/core.js`＋`dist/features/{formats,diagnostics}.js`＋`dist/chunks/*`（1 回のビルドの分割出力）を出す。`__tests__/split.test.ts` が分割出力に全シナリオを流し、別モジュールの診断がコアの受け口に届くことも確かめる。
- **結果**: テスト 627 件が通過。core 19.23KB gzip（1 ファイル版）。分割版で core だけを読むページは 19.97KB（ファイルごとの gzip の合計）。後付け: formats 1.1KB・診断 1.4KB。全部入りの `auto` 21.3KB。

## 3. 後付けごとの見立て

使用数は `usage.json`（デモ 37・e2e 38・skill のコード例）、テスト数は `tests-classified.json`（BB＝DOM と公開 API だけ、GB＝準備に内部を使う、WB＝内部関数を直接呼ぶ）。サイズは現行の分割入口の gzip（コアに含まれない分）。

| 後付け | 現行サイズ | テスト（BB/GB/WB） | デモ／e2e／skill | 要るもの | モデル変更 |
|---|---:|---|---|---|---|
| temporal: `$watch` | 1.9KB | 111（0/82/29） | 2／0／2 | F1・F3・F4・F5・F6・F7 | なし |
| temporal: `$stream` | 2.1KB | 173（2/75/96） | 3／0／1 | F3・F5・F6・F7・F8 | なし |
| `$listKeys` | 0.8KB | 52（0/26/26） | 1／0／3 | F2・F6 | なし |
| volume（`mount=`） | 約 7.1KB（注入込み） | 約 69 | 1／1／1 | F2・F7・F10・F15 | なし |
| コンポーネントの mount | 約 4.3KB | 235（1/119/115） | 1／16／6 | F7・F11・複数の根 | **あり** |
| エクスポート（overlay） | （上に含む） | 約 46 | 0／1／0 | 読みの取りこぼしの受け口 | 小 |
| DCC | 約 1.6KB | 96（0/2/94） | 0／4／1 | F1・F7 | なし |
| recursion（`**`） | 5.4KB | 335（72/188/75） | 1／0／4 | F2・F6・F9・F10 | なし |
| SSR | 4.1KB | 198（14/164/20）＋server 約 98 | 1／1／0 | F7・F12・計画に元のテンプレート | **あり** |
| 診断 | 1.1KB | 110（2/18/90） | 0／0／0 | F6・F11・F13 | なし |
| DevTools | 2.2KB | 61（0/10/51）＋devtools 約 263 | 1／0／0 | F1・F5・F13・F14・F15 | なし（見取り図） |

### 3.1 temporal（`$watch`・`$stream`）と `$listKeys`

- **約束**: `$watch` は drain の終わりに、その回に書き込まれた位置（landing）ごとに 1 回発火する。`cur` は drain 時の値、`prev` はその回の最初の書き込みの前の値（プリミティブのみ）。機構の順序は `$renderedCallback → $watch → stream の再開`（`$scan` は廃止）。連鎖は 32 回で打ち切る。`$stream` は接続後に開始し、`args` の依存が landing すると drain ごとに最大 1 回再開する（前の実行は中止、値は `initial` に戻る）。`$streamStatus`／`$streamError` を伴う。`$listKeys` はキーで行を突き合わせ、変わったフィールドだけを書く。
- **新エンジンで要るもの**: 新エンジンは drain ごとに「どの位置が変わったか」を記録していない（パターン＋行で無効化するだけ）。F1 で（パターン, 行, 旧値）を後付けへ渡せば足りる。後付けが無ければ費用は null 判定 1 回。
- **新エンジンで解ける非対称**: 現行の「行を見る `$watch` は `for` か `$listKeys` が要る」「ワイルドカードの getter は先行評価しない」は、行を持つ新エンジンでは不要。統一して落とす候補。
- **`$scan` の置き換え**: `from: p` → `p` を見る `$watch` で畳み込んで書く（宣言順で `$watch` より前に置く）。`on: t` → `$on.t` の先頭で畳み込む。失うのはリセット時の読み飛ばし・連鎖した scan の厳密な 1 回・ループ検出（32 回の上限は残る）。skill と `state-intersect-scroll` と `timing-and-firing-contract.md` の書き換えが要る。

### 3.2 scopes（volume・コンポーネントの mount・エクスポート・DCC）

- **volume**: `<wcs-state mount="p">` の状態を、根の木の `p` へ普通の書き込みで接ぎ木する。getter／setter は `p.key` の accessor になり、中の `this` は `p` に閉じる。読み込み順は問わない（読み込み前は `p` 以下が `undefined`）。衝突・読み込み失敗・動的なマウントパス・再セットは拒否。**新エンジンでは受け口で足りる**（F2・F7・F10・F15）。
- **コンポーネントの mount**: `<wcs-state bind-component="prop">` を持つカスタム要素に、ホストが `state: p`／`state.x: p`／`state: .` で状態の一部を渡す。getter／メソッドは閉じた `this` で評価し、コンポーネント自身のデータは mount と行ごとに私有（D21）。`$1` や `$getAll` はコンポーネントの範囲で数え、ホストの行の添字が前に付く。**モデルの変更が要る**:
  - 1 つのエンジンが複数の根（コンポーネントの shadow root）で束ねる。イベントの委譲は根ごとに要る（shadow の境界で再ターゲットされるため）。
  - 行ごとの私有データの置き場。
  - 計画は `data-wcs` を外すので、ホストの `state:` の結線は計画の段階（F11）で mount 表に振り替える。
  - Light DOM のコンポーネントは、ホストの走査が中身を束ねないよう飛ばす規則が要る。
- **エクスポート（overlay）**: 親が木に無いキーを読むと、mount したコンポーネントの getter が行ごとに答える。熱い読みの経路に「取りこぼし」の受け口が要る。デモでの使用は 0。
- **DCC**: `[data-wc-definition]` の中の `<wcs-state>` から要素クラスを定義する。各インスタンスは普通の根。F1・F7 と読み込みだけで分離できる。デモ 0・e2e 4。

### 3.3 recursion（`$recursion`・`**`）

- **約束**: 自己再帰の錨を 1 つ宣言し（`$recursion: {"nodes.*": "children.*"}`）、`**` を「深さの変数」として書く。エンジンが見るのは具体的な深さのパス（`nodes.*.children.*.total` など）だけで、`$1`〜`$128` はそのまま効く。`get "nodes.**.x"()` は深さごとの getter の族。`$getAll(p, [])` は深さ優先で全深さを集め、`$setAll` は葉にだけ書く。展開は読み取り専用。テンプレートの再帰は無く、木の描画は自己参照するコンポーネントの mount で行う。
- **新エンジンの見立て**: 深さごとに普通の固定深さのパターンとして作れば、**モデルの変更は要らない**（行の連鎖に深さの上限は無く、深い変更が浅い getter へ届く仕組みもそのまま使える）。F9・F10 と、スロットを後から足せること（§1.2）で足りる。
- **依存**: 木を描くにはコンポーネントの mount が要る。テスト 335 件と最大だが、デモは 1（`recursive-tree`）。約 22 件は現行の誤りを固定しているので、移植せず正しい期待に直す。

### 3.4 SSR

- **約束**: `<wcs-state enable-ssr>` と `@wcstack/server` の `renderToString`。サーバは行・枝・文字の範囲をコメントの目印で囲み、状態のデータと元のテンプレートと値の表を `<wcs-ssr>` に入れる。クライアントはデータを状態に重ね、`$connectedCallback` を飛ばし、**サーバの DOM を作り直さずに引き取る**。版（major.minor）が違えば捨ててクライアントで描く。
- **新エンジンで要るもの**: 新エンジンは行から `data-wcs` を外すので、ハイドレーションは「生きている属性を読み直す」のではなく「計画に沿って既存ノードを引き取る」形になる（F12）。計画に元のテンプレートを持たせる。サーバ側は描画木を読む見取り図と、目印の出力。
- **利点**: 行の連鎖を持つので、現行の既知の穴（入れ子の `for` の行で内側の添字が欠ける）を正しく直せる。
- **簡素化の候補**: 古いサーバ向けのインライン snapshot の経路（テスト 1 件・compat）、値の表（ハイドレーションで全バインディングを反映し直すなら不要）。

### 3.5 診断と DevTools

- **診断**: 束ねたパスが状態で解決しないときの `console.warn`（`wcs/binding-path-missing` と did-you-mean、`$watch` 用の `watch-path-missing`）。現行は後付け（1.1KB）。F6・F11 と再セット時の再検査で足りる。
- **DevTools**: 大域の `__WCSTACK_DEVTOOLS_HOOK__`（プロトコル v2）。`@wcstack/devtools` は内部の住所構造（`absoluteAddress.absolutePathInfo…`）とバインディングを読む。新エンジンは行のバインディングを遅延して作る（スロット）ので、「バインディングの追加・削除」のイベントを安く再現できない。**v3 で引き出し型（pull）の見取り図に変える**か、v2 を擬似的に保つかを決める必要がある。

## 4. 目標と検査

- **サイズ**: core ≤ 20KB（フック込み）。各後付けは現行の分割入口の 50% 以下を目安にする。全部入りの `auto` の目標値は段 8 の後に決める（現行の `auto.min.js` は約 81KB）。
- **性能**: 全部入りの `auto` でも、コアの 2 指標（同条件の DOM 直接の 2 倍以内）が保たれること。後付けを入れても使わない機能は費用ゼロ（null 判定のみ）。
- **比較**: 後付けごとに、現行 3.3.0 で記録するゴールデンのシナリオを足す（段 0 と同じ仕組み）。現行のテストは GB／WB が大半なので、DOM と公開 API だけで書き直した黒箱テストを増やす。
- **縮めたバンドル**: `bundle.test.ts` を分割出力（`core.js`＋`features/*.js`）にも流す。

## 5. 決めてほしいこと

### 5.1 進め方

1. **配布の形**: 1 回のビルドで分割出力し、後付けはコアの内部に直接触れる（§1.1）。代わりにコアと後付けは同じビルドから配る。
2. **段 8 を先に行う**: §2 の穴 1〜8（6 のトップレベルの失敗は現行どおりに戻す）とフックの足場を入れ、サイズを実測する。
3. **後付けの順番**（推奨）:
   1. temporal（`$watch`・`$stream`）＋`$listKeys`: デモでの使用が最も多く、受け口がはっきりしている。
   2. volume（データだけのもの）と DCC: 小さく分離できる。
   3. コンポーネントの mount: e2e 16・SKILL.md が教える。モデルの変更が要る最大の山。
   4. recursion: コンポーネントの mount に依存する。
   5. SSR: モデルの変更（引き取り）。`@wcstack/server` と router の SSR e2e で確かめる。
   6. 診断と DevTools。

### 5.2 契約の簡素化（落とす・変える候補）

| 後付け | 候補 | 根拠 |
|---|---|---|
| temporal | `$streams` の別名を落とす（互換エイリアスの廃止方針どおり） | compat タグのテストのみ |
| temporal | 「行の `$watch` は `for` か `$listKeys` が要る」「ワイルドカードの getter は先行評価しない」の非対称を無くす | 新エンジンでは不要な制約。`workaround` タグのテストが固定しているだけ |
| temporal | `$streamStatus.*` を `$watch` できるようにする | デモが getter の迂回を書いている |
| volume | 注入（`data-wcs="state.k: path"`）を落とすか後回し | テスト 29・使用 0 |
| volume | volume からの相対の `$watch`／`$listKeys`／`$renderedCallback` を落とすか後回し | 使用 0。後付けどうしを結合させる |
| mount | エクスポート（overlay）を落とすか後回し | テスト約 46・デモ 0。熱い読みの経路に受け口が要る |
| mount | `#ro` を後回し | 使用 0（結線の変換ができれば安い） |
| mount | 行ごとの私有データ（D21）を「要素ごとの私有」に簡素化 | 最も高くつく部分 |
| mount | Light DOM のコンポーネントを落とす | e2e 1 |
| recursion | 静的な衝突検査・構造の接尾辞の拒否を診断の後付けへ移す | 実行時の正しさには効かない |
| SSR | インライン snapshot（古いサーバ向け）と値の表を落とす | compat 1 件／全バインディングの反映で代替 |
| SSR | クライアントで `$connectedCallback` を飛ばす約束を見直す | 文書化されているが驚きがある |
| DevTools | プロトコルを v3（引き出し型の見取り図）にする | 行のバインディングの遅延生成と合わない。`@wcstack/devtools` の改修が要る |

### 5.3 core のサイズ（段 8 で判明）

core は 19.87KB gzip で、フックを入れる余地が無い。案は 3 つ。

| 案 | 内容 | 効果の見込み | 代償 |
|---|---|---|---|
| **A（推奨）** | エラーは core ではコードと事実だけ（例: `[wcs/index-arity] $resolve("m.*.*") needs 2 index(es), got 1`）にし、直し方の助言文は診断の後付けが付け足す。全部入りの `auto` は診断を含むので、CDN の利用者の見え方は変わらない | 約 1.0〜1.5KB | core だけのページでは助言文が出ない（コードで lint／VS Code 拡張の説明に辿れる） |
| B | 上限を上げる（例: 21KB） | — | 目標の変更 |
| C | コアの一部を後付けへ移す（`$eq`／`$eqPath`、`$setAll` の mapper／spread など） | 0.3〜0.6KB | 決定済みのコアの範囲の変更 |

A は「診断は後付け」（scope-classification の決定）と同じ線で、コードは三面（ランタイム・lint・VS Code 拡張）で共有されているので、core だけでもコードから説明に辿れる。

### 5.4 その他

- `@wcstack/server` は `@wcstack/state` を既定で import する。新エンジンに切り替える方法（`bootstraps` オプションか既定の変更）は、SSR の段で決める。
- 後付けを入れた `<wcs-state>` の後から読み込まれた後付けは、計画を作る時の出来事（F11）を取りこぼす。現行と同じく「状態を定義する前に install する」を約束にする。

## 6. 記録

### 後付け 1: temporal（`$watch`・`$stream`）と `$listKeys`（2026-09-25・コミット `3f1c7bdc`）

**コアに足した受け口**（`src/hooks.ts`。どれも後付けが無ければ null 判定 1 回）

| 受け口 | 場所 |
|---|---|
| `beforeWrite` | `Engine.write` の先頭 |
| `written` | `Engine.write`（データ・setter）と `$postUpdate` |
| `getterReached` | `visitGetter`・強制無効化（`$eq`／`$eqIndex` の再キー付け） |
| `listSynced` | `Engine.sync` |
| `drained` | `drain` の終わり（`report` の後） |
| `declare` | `Engine` の構築時と再セットの差し替え前 |
| `element` | `$connectedCallback` の後・切断・再接続・再セットの後 |
| `dollar` | `Engine.dollar` の最後 |

- 1 つの受け口を複数の後付けが使うので、`addHook` でつなぐ（`beforeWrite` は最初に処理したもの、`dollar` は最初に答えたものが勝つ）。
- core は受け口の分だけ 19.23 → 19.49KB gzip。

**`$watch`**（`src/temporal/watch.ts`）
- drain の終わりに、その回に書き込まれた位置ごとに 1 回発火する。
  - 対象は、書かれたパスそのもの、同じ行の中でその上のオブジェクトの書き換え、getter の出現に届いた変更、リストに新しく入った行。
- `prev` は、その回の最初の書き込みの前の値（プリミティブを書いたときだけ）。getter の場合は前回の評価値。
- 順序は、宣言順、行は添字の昇順。`$renderedCallback` の後、stream の再開の前。
- ハンドラの失敗は隔離する。ハンドラ自身の書き込みから続いた回だけを数え、32 回で打ち切る。
- `$connectedCallback` の後から働き、切断で止まり、再接続で再び働く。再セットでは発火しない。
- **新エンジンで変わったこと**（承認済みの簡素化）
  - 行の監視は自分でリストを同期する。`for:` も `$listKeys` も要らない。現行は、そのようなリストでは添字付きパスへの書き込みも `ListIndex not found` で失敗する。
  - ワイルドカードの getter も先行評価する。
  - 配列を置き換えたときに発火するのは、新しく入った行だけ。現行 3.3.0 も実際にはこう動いた（README の「全行が発火する」は古い記述）。
- **現行の不具合と見られる差**: 現行は、`$watch` のハンドラの中で書いたプリミティブの `prev` を落とす（README の約束に反する）。新エンジンは約束どおり渡す。

**`$stream`**（`src/temporal/stream.ts`）
- `args` を状態に無い専用の getter（`$streamArgs.<name>`）として評価する。読んだパスは getter と同じ仕組みで追跡する。
- 依存が変わると、drain の終わりに 1 回だけ再開する（中止 → `initial` に戻す → `args` を再評価 → `source`）。依存は実行のたびに取り直す。
- `args` の違反は、始めは throw、再開時は `error` 状態になる。
  - 違反の種類: 自分自身を読む、ワイルドカードを読む、Promise を返す。
  - 再開時の失敗では前の依存を残すので、それを書けば回復する。
- `source` は `ReadableStream`（`reader.cancel()` で止める）か非同期イテラブル。
- `$streamStatus`／`$streamError` は読み取り専用。`this["$streamStatus.x"]` は依存を張る。
- 切断で中止して `idle`、再接続で `initial` から始め直す。
- `$streams` の別名は廃止した（明示のエラー）。

**`$listKeys`**（`src/features/list-keys.ts`、独立した後付け `list-keys`）
- 書き込みの前の受け口で、キーの合う行の古いオブジェクトで配列を組み直して書く。
- そのうえで、変わったフィールドだけを行ごとに書く。落ちたフィールドは `null` にする。
- 何も変わらない取り直しは何もしない。入れ子のリストや関数のキーも扱う。

**確かめたこと**
- ゴールデン: temporal 7 シナリオ・`$listKeys` 1 シナリオを足した。
  - 現行と完全一致が 6。
  - 意図した差分が 2（`for:` の無い行の監視、ハンドラ内の書き込みの `prev`）。
  - `$stream`（畳み込み・状態・依存での再開・`ReadableStream`・失敗）は現行と一致した。
- 単体テスト: `temporal.test.ts`（23 件）、`list-keys.test.ts`（6 件）。
  - 対象: 隔離・連鎖の打ち切り・接続と切断・再セット・パスの検査・ワイルドカードの getter・入れ子の行・再開の合流・実行中の再開・読み取り専用・依存を張る読み・`args` と宣言の検査・行の DOM の保持・キーの重複と欠落。
- 短縮したバンドルと分割版のテストが、短縮の誤りを 3 つ捕まえた（直した）。
  - `$stream` の定義の `initial`: 利用者のオブジェクトなので、引用符付きのキーで読む。
  - ストリームの `reader.read()`: `read` を短縮の一覧から外した。
  - 受け口の名前: `addHook` が文字列で引くので、短縮の一覧から外した。
- テスト 680 件が通過。

**サイズ（gzip）**
- core 19.49KB（1 ファイル版）。
- 後付け: temporal 3.0KB、list-keys 0.85KB、formats 1.1KB、診断 1.4KB。
- 全部入りの `auto` は 24.7KB。現行の `auto` は約 81KB。
- 現行の temporal の分割入口は 9.8KB（うち `$scan` 約 4.6KB）。

**性能**
- 目標の比（`addons/temporal-targets/`、全部入りの `auto`、3 周・各 18 サンプル、同じ回の DOM 直接と比較）:
  - ウォーム 1,000 行 **1.69 倍**、コールド 10,000 行 **1.52 倍**。従来の床での比は 1.70／1.68 倍。
  - この回は機械全体が遅い状態だった。DOM 直接の床（コールド 10,000 行・データ生成込み）が 73ms（前の回は 50ms）、現行が 651ms（前は 384ms）。現行の比も 4.3→5.7 倍と同じ向きに動いている。
- **後付けの受け口の費用**（`addons/addon-overhead/`、同じ回で交互に 3 周）: 全部入りと、後付けを入れない版（formats だけ）の比較。
  - ウォーム 1,000 行: 10.45ms 対 10.45ms。
  - コールド 10,000 行: 109.1ms 対 107.7ms（+1.3%、揺れの範囲）。
  - 受け口を埋めても費用はほぼ 0 で、目標の比の変化は環境によるもの。
- 全操作の計測（`addons/temporal-full/`）は、機械の負荷で同じ現行を 2 回測った差（A/A）が 20〜112% に達したので採用しない。

### 後付け 2: scopes（volume・DCC）（2026-09-26）

`features/scopes` の 1 つの後付けに volume と DCC を入れた。コンポーネントの mount（`bind-component`）は次の段で同じ後付けに足す。

**コアに足したもの**
- 受け口 `claim(el, root)`: 根にならない `<wcs-state>`（volume・DCC の定義要素）を後付けが引き取る。コアは状態を読み込むだけで、`connectedCallbackPromise` は後付けの `start` が終わると解決する。
- 受け口 `element` の段階に `"mounting"`（エンジンを作った直後で、ページを束ねる前）を足した。
- メソッド名にパスを書けるようにした（`onclick: i18n.toJa`）。volume のメソッドはマウントパスの下にあるため。
- 公開 API の抜けを 2 つ足した。どちらも e2e を state-next で流して見つかった。
  - `createStateAsync(mutability, callback)`: `@wcstack/testing` と README のテスト手順が使う。`"readonly"` は読み取り専用の見え方を渡す。await をまたいでも読み取り専用のままで、その間の他の書き込みは止めない。
  - `initializePromise`: README の IStateElement の表にある。状態を読み込んで束ねた後（`$connectedCallback` の完了を待たない）に解決し、初期化に失敗しても解決する。失敗は `connectedCallbackPromise` が伝える。
- core は 19.49 → 19.69KB gzip（上限まで 0.31KB）。

**volume**（`src/scopes/volume.ts`）
- volume の状態を、根の木のマウントパスへ普通の書き込みで接ぎ木する。
  - getter／setter はそのパスの accessor になり、メソッドはパスの下の関数になる。
  - どれも `this` はマウントパスに閉じる。`$getAll` などに渡すパスも、マウントパスからの相対になる。
  - `$connectedCallback`／`$disconnectedCallback` も、閉じた `this` で走る。
- 読み込み順は問わない。根より先に読み込んだ volume は、根のエンジンができた時点（ページを束ねる前）に接ぎ木する。
- 次は接ぎ木せずに報告し、`connectedCallbackPromise` は解決する（現行と同じ）: 不正なマウントパス、同じパスの 2 つ目、根に既にあるキー。
- 次は投げる（現行と同じ）: volume の再セット、volume を持つ根の再セット、volume を含む祖先の書き換え。
- 承認済みの簡素化: 注入（`data-wcs="state.k: …"`）と、volume に書いた `$watch`／`$listKeys`／`$renderedCallback`／`$stream` は、黙って無視せずにエラーにする。`$commandTokens` など根の持ち物は警告する。

**DCC**（`src/scopes/dcc.ts`）
- `[data-wc-definition]` のホストの shadow の中にある `<wcs-state>` から、ホストのタグの要素クラスを定義する。各インスタンスは定義の中身の複製を shadow に持ち、その中の `<wcs-state>` は普通の根になる。
- shadow は初めて使われた時（アクセサか接続の早い方）に作る。現行と同じで、`for` の行は挿入の前に束ねるため。
- プロトタイプのアクセサは中の状態を読み書きする。
  - 初期化前の書き込みは、初期化の後（`$connectedCallback` の前）に入る。
  - メソッドは Promise を返す。
- `$bindables`／`$commands` から `static wcBindable` を作る（どちらも無ければ null）。宣言の検査は現行と同じ 6 種。
- 変更イベント `<tag>:<prop>-changed`（`bubbles: true`）は、メンバー自身・その下のパス・`$postUpdate` への書き込みで出る。`detail` が付くのはメンバー自身への書き込みだけで、宣言の getter は要素から値を読む（現行と同じ）。
- `stateElement` getter（現行にある）も生やした。

**確かめたこと**
- ゴールデン: volume 2 シナリオを足し、現行と一致した。
- 単体テスト: `scopes.test.ts` 12 件、`dcc.test.ts` 12 件、`element.test.ts` に 2 件（`createStateAsync`・`initializePromise`）。
- 実ブラウザ: リポジトリの e2e を、state のバンドルだけ state-next に差し替えて流した（`/packages/state/dist/auto.min.js` の要求をプロキシで振り替える）。volume 3 件・DCC 3 件がすべて通過した。

**サイズ（gzip）**: scopes 3.4KB。現行は volume が約 7.1KB（注入込み）、DCC が約 1.6KB。

### e2e の全体を state-next で流して見つけたコアの穴（2026-09-26）

リポジトリの e2e 全体（32 ファイル・131 件）を、現行と state-next の両方で流して比べた。最初は、現行で通って state-next で落ちるものが 62 件あった。うち 20 件は後付け以外の原因で、次の 5 つのコアの穴だった。すべて直した。

| # | 穴 | 見つけたページ | 直し方 |
|---|---|---|---|
| 1 | `<wcs-state>` の中に書いたマークアップを束ねていなかった | synth・midi・move-before・view-transition（5 ページ） | 走査で `<wcs-state>` の子孫も束ねる（要素自身の属性は束ねない）。ゴールデンの書き出しも `<wcs-state>` を中身ごと落としていて見えていなかったので、中身を書き出すように直した |
| 2 | getter の上の `for:` が、依存が変わっても同期し直さない（if の外では 1 行も描かれない） | search・calendar・cross-tab-todo・fetch-users-crud | getter が無効化されたら、その下のリストに印を付け、drain の各パスの頭で同期し直す。getter の失敗はその `for` の失敗として報告する |
| 3 | 外したツリーが回収されない | address-gc | 最後に作ったブロックを覚える変数（`lastBlock`）が、外したツリーを掴んでいた。読んだら手放す |
| 4 | `createStateAsync`・`initializePromise` が無い | mount-volume（V7） | 足した（上の後付け 2 の記録） |
| 5 | Trusted Types に止められた書き込みの報告が一般の失敗文になる | trusted-types | 受け口 F13（`failed`）をコアに足し、診断が現行と同じ直し方の文面を 1 ページに 1 回出す |

- **結果**: 両方で通るものが 63 → 77 件。現行だけで通るのは 48 件で、すべて後付け側の理由。
  - コンポーネントの mount（`bind-component`・`state: path`）: 42 件。次の後付け。
  - intersect-scroll: 6 件。デモが廃止した `$scan` を使っている。デモの書き換えは計画どおり要る（§3.1）。
  - どちらでも落ちるものが 6 件ある（プロキシ越しでは SSR サーバが立たない 5 件と、SSE のタイミング 1 件）。
  - state-next だけで通るものは無い。
- **ゴールデンに足したシナリオ**: `<wcs-state>` の中のマークアップ、getter のリストを if の中で描く、行の getter のリスト（入れ子の `for`）、getter のリストの失敗、配列を読む getter と行への書き込み。
  - 最後のシナリオで、現行も「行の値への書き込みでは、配列を読む getter を上向きに無効化しない」ことを確かめた。新エンジンも同じ意味になる。
- **意図した差分を 2 つ宣言した**:
  - 行の getter のリストで、`for` で描いていないリストの行のパスへ書くと、現行は `ListIndex not found` で投げる（#319 と同系統）。
  - `for` のリストの getter が投げると、現行はその失敗を書き込み元へ投げ、続きの書き込みが落ちる。新エンジンは他のバインディングと同じく封じ込める。
- **決定（2026-09-26・著者「すべて承認」）**: README の IStateElement の表にある `listPaths`／`getterPaths`／`setterPaths`／`nextVersion` は core に入れない（リポジトリの中ではコメント以外に使う箇所が無い）。要るなら DevTools の後付けで出す。
- テスト 730 件（通過 729・スキップ 1）。core 19.85KB gzip（上限まで 0.15KB）。全部入りの `auto` 28.1KB。
- e2e を流す道具は `packages/state-next/bench/e2e/`（プロキシ・Playwright の設定・比較）。比較の結果は `docs/research/state-engine/addons/e2e-sweep/`。

**性能**（`addons/scopes-targets/`、全部入りの `auto`、3 周・各 18 サンプル）
- 直前のコミット（`3f1c7bdc`、scratchpad でビルド）と同じ回で交互に測った。drain のループと行の生成（`takeBlock`）に手を入れたため。
- 今回: ウォーム 1,000 行 6.45ms（**1.54 倍**）、コールド 10,000 行 76.75ms（**1.52 倍**）。
- 直前: 6.55ms（1.56 倍）、75.4ms（1.49 倍）。差は揺れの範囲。

### 後付け 3: コンポーネントの mount（`bind-component`）（2026-09-26・未コミット）

`features/scopes` に足した（`src/scopes/component.ts`）。

**方式: コンポーネントごとのエンジンと橋渡し**
- 現行は、コンポーネントのバインディングにパスの接頭辞を付けてホストの木に変換する。私有キー・getter・メソッドは予約セグメント `#m<id>` のオーバーレイに置き、`$n` とイベントの添字はずれを補正する（`webComponent/` の約 4,000 行）。
- 新エンジンは、`<wcs-state bind-component>` ごとに、コンポーネントの状態オブジェクトの上にエンジンを 1 つ作る。これは「根ごとにエンジン」という原則と同じ形で、次のものが補正なしで成り立つ。
  - 私有キーは、状態オブジェクトにそのまま置く（要素ごと）。
  - `$1`、イベントの添字、`$getAll`、getter の `this` は、コンポーネントの範囲で数える。
- マウントしたキー（部分の `state.x: path`、丸ごとの `state: user`・`state: .`）は、コンポーネントのパターンに getter／setter を差し込み、ホストのパターンと行を読み書きする。
- 変更は受け口 `written`／`getterReached` で両方向に渡す。
  - ホストからコンポーネントへ: マウント先より下の変更は、コンポーネントのパスと行に写して `touch` する（リストの同期と変更の通知）。マウント先より上の変更（置き換え）は、差し込んだ getter を無効にする。
  - コンポーネントからホストへ: マウントしたキーより下の書き込みは、ホストの行の添字とコンポーネントの行の添字をつないで、ホストの行を引く。
  - 往復の反響は、「伝播中のエンジンの集合」で止める。2 段重ね（中段が配列を渡すだけ）も、同じ仕組みで上下に届く。
- マウント先は、ホストの行ごとの索引（ホストのエンジン → パターン → 行）に置く。書き込みごとの費用は、マウントが無ければカウンタの判定 1 回。

**ホストの結線の見分け方**（現行と同じ）
- `state` を特別には解析しない。カスタム要素への普通のプロパティバインディングのうち、先頭が `bind-component` の名前と一致するものを、子の `<wcs-state>` が現れた時点でマウントの対応として引き取る。
- 引き取ったバインディングは、ホストの登録から外す。
- 引き取る前にホストが要素に書いてしまった値は、「最初の書き込みの前の値」を 1 つ覚えておいて、コンポーネントの状態として使う。現行の、完了前の書き込みを戻す台帳（回避策）の代わり。
- ホストが結線をまだ結んでいない場合は、子が待つ。
  - 例: ページの状態の読み込みが後になる場合。
  - 条件: 要素の `data-wcs` にその名前の対応が書かれていること。

**core に足したもの**
- 受け口 `hostBinding`: カスタム要素への普通のプロパティバインディングを、登録と適用の前に後付けへ渡す。
- 受け口 `componentScope`: Light DOM のコンポーネントの中身を、ホストの走査が飛ばす。
- `Claimed.load`: 引き取った要素の状態の読み込み口。
- core は 19.85 → 19.92KB gzip（上限まで 0.08KB）。

**現行と同じにしたこと**
- 結線の無い Shadow DOM のコンポーネントは、独立した木になる。凍結した状態は書けるようにする。宣言も動く。
- 結線の無い Light DOM は、現行と同じ文面で、捕まらない例外として報告する。
- R1: 1 段の部分マウントはデータの既定値に勝つ。accessor・メソッド・深い対応の上の自分のキーでは、自分の側が勝ち、`[wcs/mount-own-key-shadow]` で警告する。丸ごとのマウントで自分のキーは私有で、ツリーに同じキーがあれば警告する。
- `element.state` は、コンポーネントのエンジンの proxy を返す getter（読み書きとも生きている）。`$stateReadyCallback(prop)`。
- ホストの状態の再セットは、コンポーネントが載っている間は投げる。
- 誤りの報告: カスタム要素の直下にない、状態の読み込み（`state`／`src`／`json`／インラインの script）との併用、同じ対応の二重。

**現行と変えたこと**
- 後回し（承認済み）: エクスポートした getter（ホストからコンポーネントの getter を読む）と `#ro`。
- マウントしたコンポーネントで動かないのは、`$watch`／`$stream`／`$listKeys`／`$renderedCallback`（`[wcs/mount-dollar-declaration]` で警告）。token（`$commandTokens` など）と `$errorCallback` は、コンポーネント自身のエンジンで動く（現行は無視して警告）。
- 私有データは要素ごと。行の要素を直接書き換える（`users.1 = obj`）と、行と要素がそのまま残るので、私有データも残る。これは承認済みの「要素の書き込みは位置のモデル」と同じ。現行は、行の私有データをスナップショットから作り直す。

**確かめたこと**
- e2e: component mount の 42 件がすべて通過した（Shadow／Light DOM、部分・丸ごと・行のマウント、2 段重ね、入れ子の `for` の中、並べ替え・置き換え・縮小、結線の無い Light DOM の失敗）。
- e2e 全体: 両方で通るものが 77 → 119 件（131 件中）。現行だけで通るのは、廃止した `$scan` を使うデモの 6 件だけ。
- ゴールデン: コンポーネントのシナリオを 4 つ足した（書き出しを open な shadow root まで降りるようにした）。Light DOM と結線の無い Shadow は、現行と一致した。残る 2 つでは、現行の不具合を意図した差分として宣言した。
  - コンポーネントのメソッドが私有キーを書いても、その回には描き直さない（次の変更のときに反映される）。押した行の添字で書いた私有キーも同じ。
  - コンポーネントの getter の中の `$getAll("items.*.v", [])` が空になる。
  - コンポーネントから `this["items.0.v"]` に書くと、`Partial wildcard type is not supported yet` で投げる。
  - `$1` がコンポーネントの範囲で数えるのは、現行と同じ。
- 単体テスト: `component.test.ts` 12 件（R1 の優先順位と警告、深い書き込みと `$postUpdate` が別のコンポーネントに届く、行の要素の置き換え、ホストの getter へのマウント、2 段重ねの上下、切断中の変更の追いつき、行が消えると登録も消える、結線の無い Shadow の宣言、誤りの報告）。
- テスト 754 件（通過 753・スキップ 1）。

**サイズ（gzip）**: scopes 6.3KB（volume・DCC・コンポーネントの mount）。現行は volume 約 7.1KB、コンポーネントの mount 約 4.3KB、DCC 約 1.6KB。全部入りの `auto` は 30.9KB（現行は約 81KB）。

**Issue にした現行 3.3.0 の不具合**（2026-09-26・著者承認。Chromium で再現を確かめた）
- #321: マウントしたコンポーネントのメソッドが私有キーに書いても描き直されない（イベントハンドラも同じ）。
- #322: `for:` の行の中にマウントしたコンポーネントの getter で `$getAll` が失敗する。
- #323: `for:` の行の中にマウントしたコンポーネントから `this["items.0.v"]` に書くと投げる。
- 当初は 4 つと数えていたが、「押した行の添字で書いた私有キー」は #321 と同じ原因だったので 3 件にした。

### 後付け 4: recursion（`$recursion`・`**`）（2026-09-26・未コミット）

`features/recursion`（`src/recursion/recursion.ts`）。

**方式**
- `$recursion` を宣言したエンジンだけ、`onPatternCreated`・`resolve`・`getAll`・`setAll` をインスタンス単位で包む。宣言の無いエンジンは費用ゼロで、core に受け口は足していない。
- `get "nodes.**.total"()` は族。深さごとの具体的なパターン（`nodes.*.total`、`nodes.*.children.*.total`、…）が作られた時に、普通の getter として実体化する。
  - `$1`・キャッシュ・依存は深さごとの普通のものになる。
  - 深い変更は、普通の辺で祖先のすべての深さに届く（モデルの変更なし）。
- 読むパスや、添字を省いた `$getAll` の `**` は、評価中の行の深さに束ねる。ここでの行は、族の getter の行、行の getter の行、イベントハンドラの行のいずれか。
- `$getAll(p, [])` は、深さ優先・前順で全深さを集める。各ノードで接尾辞のワイルドカードを展開する。
- `$setAll(p, [], v)` は全ノードへの一斉書き込み。
  - 形の検査と木の検査（共有・循環・深さ）を済ませてから書く。失敗すれば何も書かない。
  - 構造（`children`）への書き込みと族への書き込みは拒む。
- 族の展開への書き込みは、どの経路でも `[wcs/recursion-readonly]`（受け口 `beforeWrite`）。
- 宣言の検査、`**` の置き場所の誤り、文脈の無い `**`、共有・循環・深さ 128 の上限、`[]` の形の誤りは、現行と同じコードで報告する。
- 承認済みの簡素化: 族どうしの衝突の検査と、getter の構造の接尾辞の検査は、core／後付けから外した。

**直したこと**
- **コンポーネントの mount の一般化**: マウントしたキーの下で、ホスト側が getter のパス（ホストの getter、再帰の族）を、行を合わせてホストから読む。これまでは最上位のキーだけだった。自己参照するコンポーネントで木を描くのに要る。
- **component mount の不具合**: 反響を止める集合が、getter の無効化まで止めていた。コンポーネントの中から書いた葉の値で、書いた側の段の Σ が古いまま残っていた。書き込みの跳ね返りだけを止めるようにした。
- **core の穴 1: `$getAll` がたどったリスト自体に依存を張っていなかった。** どの行もまだ持っていない深さの空のリストに最初の行が入っても、getter が無効にならなかった。深さ 0 は、別の行の辺がたまたまあって動いていた。現行は追従する（ゴールデンに足して一致を確認）。
- **core の穴 2: 後から足した getter の slot が、行のキャッシュ配列の長さを超える場合。** 族の実体化・マウントしたキーで起きる。§1.2 で予告していた修正。
- **core の文字列**: 重複した文面を 1 つにまとめ、ログ用の長い文と直し方の文（フィルタの修飾子の位置）を diagnostics へ移した。

**確かめたこと**
- ゴールデン: 4 シナリオを足した。
  - 族・全深さ・深い書き換え・空の枝への追加・一斉書き込み・並べ替え: 現行と完全に一致（`$getAll` の順 `1,10,100,20,2`、`$1` の `0,0,0,0,1` を含む）。
  - 誤りのコード 7 つ: 6 つは現行と同じ。展開への代入は、新エンジンが契約どおり `[wcs/recursion-readonly]` を出す。現行は `for` で描いていないリストの行のパスで `ListIndex not found` を投げ、検査まで届かない（意図した差分として宣言）。
  - 自己参照するコンポーネントで描く木: 現行と一致。
  - 空のリストだけをたどる `$getAll`: 現行と一致。
- 実ブラウザ: recursive-tree のデモを、現行と state-next で同じ手順で操作し、全段の表示が全手順で一致した（葉の値の編集、入れ子の子の追加、削除、チェックボックス、一斉選択と解除、リセット）。
- e2e 全体: 両方で通るものは 119/131 のまま（後退なし）。
- 単体テスト: `recursion.test.ts` 21 件（宣言の検査、接尾辞のワイルドカードと `nodes.**`、共有・循環・128 段、getter-cycle、一斉書き込みの戻り値と何も書かない保証、展開の読み取り専用、`data-wcs` の `**`、イベントハンドラの束ね、再セット、木の中からの書き込みと子の追加）。テスト 787 件（通過 786・スキップ 1）。

**サイズ（gzip）**: recursion 2.5KB（現行 5.4KB）。core 19.86KB（上限まで 0.14KB）。全部入りの `auto` 33.0KB。

**性能**（`addons/recursion-targets/`、全部入りの `auto`、3 周・各 18 サンプル）: ウォーム 1,000 行 5.9ms（**1.44 倍**）、コールド 10,000 行 72.8ms（**1.48 倍**）。前回（1.54／1.52 倍）と揺れの範囲で、core の 2 つの修正（行の getter のキャッシュ判定、`$getAll` のリストの読み）による後退は見えない。
