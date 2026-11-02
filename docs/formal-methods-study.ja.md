# 実装から仕様を吸い出し、反例を探す — 検討

- **状態**: 検討（2026-11-03）。著者は同日、推奨どおりに決定した（§6）。決定が求める作業の計画は §7
- **出典**: mizchi「[実装コードから仕様を吸い出して Z3 / TLA+ でバグを払い出す — 実践プレイブック](https://gist.github.com/mizchi/db7817e6fc077d567c41cd9d41bb1c53)」。以下「プレイブック」
- **English**: [formal-methods-study.md](./formal-methods-study.md)

プレイブックは実装を事実上の仕様とみなす。コードが主張していることと、黙って決めていることを吸い出し、その主張を全入力・全順序で機械に攻撃させ、出た反例をドメインを知る人に「意図か？」と問う — 意図なら明文化し、意図でなければバグ。最終成果物は証明の山ではなく台帳である: 実装の主張、機械が見つけたこと、著者への確認質問。

本書は、この手法が wcstack に合うかを検討し、コードの 2 か所で試し、決まったことを記録する。

## 1. wcstack に既にあるもの

手法の大半は、別の名前で既にある。欠けているのは機械のほうで、今ある検査はどれも誰かが選んだケースである。

| プレイブック | wcstack では | 状態 |
|---|---|---|
| 名前付きの不変条件をトレースで検査する（§4・§6） | [io-node-trace-conformance.md](./io-node-trace-conformance.md) の §6 共通適合法則と §5 適合ベクトル | 草案・Phase 0 |
| 同値類と境界からケースを作る（§4） | [io-node-pattern-testing-plan.ja.md](./io-node-pattern-testing-plan.ja.md): 初期条件・順序付き操作・期待出力・禁止出力 | 提案・未実装 |
| わざと壊した実装で検査が効いていることを示す（§5） | 同じ計画の §10: 余分な fetch をわざと許し、ケースが落ちるのを見る | 提案 |
| 参照実装に対するランダム入力 | `packages/signals/__tests__/reactive.property.test.ts`（fast-check） | 使用中・signals のみ |
| 反例 →「意図か？」→ 決定（§0） | 継ぎ目アプリ: 所見を推奨付きで著者に問い、決定は [v4-direction-2026-10.md](./v4-direction-2026-10.md) §5.x へ | 4.1 から使用中 |
| 台帳（§8） | [mistake-catalogue.ja.md](./mistake-catalogue.ja.md)、[seam-apps.ja.md](./seam-apps.ja.md) の記録 | 使用中 |
| 設定を保存するときの検査（§1） | `wcs-validate` と拡張 | 使用中 |

プレイブックが足すのは、ケースを生成することである: ある長さまでの全操作列、述語の入力の全組み合わせをコードに対して回し、主張を法則として検査する。

## 2. 道具: Z3 も TLA+ も入れない

wcstack にはどちらも要らない。

- **Z3** は「全入力について」に答える。ここで検査する価値のある述語 — リンクの現在判定、ルートの優先順位、リリースワークフローの拒否 — は、数個の属性を少数の代表値で取れば足りる。数千通りの直積はミリ秒で回り、ソルバーは要らない
- **TLA+** は「全順序について」に答えるが、相手は手で書いたモデルである。プレイブック自身の警告（§6・§7）はそのモデルとコードの隔たりで、記憶から組んだモデルは違うものを証明する。wcstack の状態を持つ部分は直接駆動できるほど小さい: 実物のオブジェクトに全操作列を再生し、一手ごとに法則を確かめる。ずれるモデルが無い
- **プレイブック自身の規則**（§1）: 状態空間が有限で決定的なら素の全列挙が一番安い。1 つのオブジェクトへの有界な呼び出し列はその両方である
- **プロジェクトの規則**: ランタイム依存ゼロは関係しない（試験だから）が、Java のモデル検査器や大きな WASM のソルバーを CI に置くのは、このプロジェクトが避けてきた種類の準備である。有界全列挙は普通の Vitest ファイルの数十行の TypeScript で、今ある CI のジョブで回る

有界は全長についての証明ではない。実際にはそれで足りる: 欠陥の多くは小さな反例を持ち（small-scope hypothesis）、下で見つかった 2 件はどちらも 5 手以内である。TLA+ は 1 か所、view transition 下のルーター（§5）で、実コードの駆動が現実的でないと分かったときの選択肢として残す。

## 3. 検査の書き方

1. **モデルでなく実コード。** 偽物にするのはプラットフォームだけ（view transition、Navigation API、ガードの Promise）。パターン試験の計画と同じ
2. **法則はドメインの言葉で、文書から取る。** README の一文、契約の節、ソースのコメント — 今の出力ではない。パターン試験の計画の規則（実装がたまたまする挙動から意味論を決めない）がそのまま効く
3. **ゴースト。** 実物の横に、法則が要るものを法則の言葉で持つ — どの要求を出したか、どれが終わったか、どの世代か — そして戻り値ごとに、法則が言う値と比べる
4. **最短の反例。** 列を長さの順に生成するので、法則が最初に破れた列がその最短の反例になり、呼び出しの列として出る
5. **壊した版は試験の側に。** スイートごとに、実物を包んで規則を 1 つわざと破らせ、検査が落ちることを確かめる。`src/` に切り替えは置かない
6. **反例は期待値になる前に著者へ**、推奨を付けて。継ぎ目アプリの所見と同じ。成り立った法則はそのまま固定する

## 4. 2 つの試行

### 4.1 `io-core/operation-lane.ts`

lane は要求の帳簿で、`fetch`・`upload`・`credential`・`eyedropper` が `latest` として、`contacts`・`share` が `exhaust` として使う。`queue` と `overlap` は実装済みで未使用。自分では Promise を走らせないので、小さな状態機械である。

- **アルファベット**: `begin`、`disposeOwner`、`abortActive`、それまでに出た ticket ごとの `claimTerminal`・`finalize`・`retry`・`canCommit`
- **法則**（ファイルのコメントと [async-execution-model.ja.md](./async-execution-model.ja.md) §4〜§5 から）:
  - *CommitOnlyWhenEligible* — ticket は終端を高々 1 回、commit してよい間だけ claim できる: 最新の要求（`latest`）、待ち行列の先頭（`queue`）、受け入れた 1 件（`exhaust`）、生きているどれでも（`overlap`）。dispose より前に出た ticket は決してできない
  - *GuardAgrees* — `canCommit` も同じことを言う
  - *RetryOnlyWhilePending* — retry は、まだ commit してよく、claim していない ticket にだけ与えられる
  - *ExhaustAdmits* — `exhaust` は、生きている要求がある間だけ要求を断る
  - *LatestAbortsSuperseded*・*DisposeAbortsAll* — 置き換えられた要求の signal は中断される。dispose は生きている signal をすべて中断する
  - *InFlightCounts* — `inFlightCount` は今の owner の生きている要求の数
- **規模**: 4 方針、7 手までの全列 — 方針ごとに 667,424 通り、合計 45 秒。5 手までなら方針ごとに 6,036 通り、1 秒未満
- **壊した版**: `finalize` が active の枠を空けない lane は、`latest`・`exhaust`・`queue` で複数の法則に落ちる（`overlap` には空けない枠が無い）

破れた法則は 2 つで、どちらも最短は 5 手、7 手まで新しいものは無い:

1. *InFlightCounts*: `begin` → `claimTerminal(A)` → `disposeOwner` → `begin`（B）→ `finalize(A)` で、B が飛んでいるのに `inFlightCount` が 0 になる。`disposeOwner` は生きている操作をすべて stale として確定するが、claim 済みのものだけは `committing` のまま残す。後の `finalize(A)` が新しい owner の要求を数え下げる。`inFlightCount` を読むのは試験だけなので、ページに見える変化は無い。同じ経路で A は trace に 2 回報告される — dispose から `io:stale-dropped`、finalize からもう一度。終端は操作ごとに高々 1 回報告するというトレース適合の法則（§6.3）に反し、これを固定している試験は finalize が A を `success` として確定すると書いているが、コードはそうしていない
2. *RetryOnlyWhilePending*: `retry` が、置き換えられた `latest` の要求と、`queue` の先頭の後ろで待つ要求に、中断されていない新しい signal を与える。今 `retry` を呼ぶ Core は無い

法則のためにファイルを読んで、どの法則も扱っていない 3 つ目が見つかった: lane は終わった操作をすべて、空にしない Map に覚えている — 10 万回の fetch で 10 万件。シフトの間開いたままのページ（[long-lived-pages.ja.md](./long-lived-pages.ja.md)）では、ポーリングする `<wcs-fetch>` がこれを際限なく増やす。

### 4.2 `<wcs-link>` の現在判定

`packages/router/src/components/Link.ts` の `_updateActiveState` は `to`・`match`・`query-keys` から `aria-current` を決める。4.10.0・4.10.1・4.11.0・4.12.0 で手を入れてきた述語である。試行はこれを行ごとに写し（`searchParams.ts` のクエリの関数は実物）、80 の構成 — 8 つの `to`、5 つの `query-keys`、`match="prefix"` の有無 — を 30 の URL で回した。

2 つの主張はどこでも成り立つ: `query-keys` を持つタブについての README の「区分のどのページでもそれぞれ現在になり、一度に 1 つ」と、`match="prefix"` は現在の範囲を広げるだけ、ということ。所見は 2 つ:

3. 重複したキー `?cat=b&cat=a` では、ルーターの `searchParams` は `{ cat: "a" }`（後勝ち、[router-state-contract-design.md](./router-state-contract-design.md) §3.5）なのに、`?cat=a` へのリンクは現在にならない: リンクは重複した値を組として比べる。1 つのパッケージの 2 か所が、同じ URL を 2 通りに読む
4. `to="/n?cat=a" query-keys="page"` は `/n?cat=b` で現在（`"true"`）になる: `to` が付けていて `query-keys` が名指さないキーは比べない。README が `query-keys` について言うとおりだが、`cat` も比べられるつもりで書いた作者には何も伝わらず、lint は `query-keys` を読まない

## 5. 効く場所

捕まえるものの大きい順に、形を示す欠陥と並べる:

1. **`<wcs-view-transition>` とガードの下でのルーターのナビゲーション。** 4.11.2 は、Back から 1 フレーム以内の Forward が、Back の差し替えがまだ遷移の中で待っている間に Back より前のルートと自分を比べ、何も置かなかった件を直した — URL は Forward のもので、ページは Back のものだった。プレイブックの「判定と記録の分離」（ある時点で判定し、別の時点で適用する）で、20 回中 18 回再現した。見つけたのは継ぎ目アプリだが、ナビゲーション・ガードの決着・フレームを実物のルーターに対して列挙すれば、この形を直接見つけられる。法則: 待っているものが無くなったら、画面のルートは URL のもので各 1 回、拒んだガードがリダイレクトするのはまだ現在のナビゲーションのときだけ
2. **lane と I/O ノードの Core。** トレース適合の法則（§6）が不変条件になる。§4.1 が最初のスイート
3. **`transition-runner` の「ちょうど 1 回適用」**。`latest` / `queue` / `exhaust` の下で、遷移が飛ばされ、中断され、reject される場合
4. **`@wcstack/state` のリストの調停。** 有限で決定的: 小さなリストの全順列（重複込み）を、DOM の順と行の同一性に対して。4.13.0 は swap が「前と同じ行を動かす」と主張している。列挙できる等価性である
5. **述語**: `<wcs-link>`（§4.2）、より優先されるルートに常に隠されるルート（lint の規則）、`scripts/compute-next-version.mjs` の拒否

プレイブックの欠陥の型の一覧（§2）は、I/O ノードのレビューのチェックリストとしても読める。4.7.0 はその 1 つを直した — script の無い `<wcs-guard-handler>` がルートを開けていた。script の読み込みに失敗すれば閉じるのに、こちらは fail-open だった。

サイズ、性能、スクリーンリーダー、ブラウザ自身の挙動には合わない。`@wcstack/state` のリアクティブな中核全体は、この方法で駆動するには大きすぎる。それには signals の property test の形が合う。

## 6. 決定（2026-11-03）

著者はそれぞれ推奨どおりに決めた。

| # | 所見 | 決定 | 行き先 |
|---|---|---|---|
| ① | §4.1-1: commit 中の dispose の後 `inFlightCount` が誤る。2 回報告される | lane は終わった操作の集合ではなく、生きている操作の集合を持つ。dispose は生きている操作を、claim 済みのものも含めてすべて stale として確定し、1 回報告する。後の `finalize` は何もしない | 段階 2 |
| ② | §4.1-2: もう commit できない要求に `retry` が与える | `retry` は断る | 段階 2 |
| ③ | §4.1: 終わった操作の Map が際限なく増える | 終わった操作については何も残さない（① から従う） | 段階 2 |
| ④ | §4.2-3: 重複したクエリのキーを 2 通りに読む | ルーターの README（英日）に書く | 後続 |
| ⑤ | §4.2-4: `to` のキーのうち `query-keys` が名指さないものは比べない | lint の規則にする | 後続 |

## 7. 計画

1. **本書。**
2. **lane**: `io-core/operation-lane.ts` に ①〜③（6 パッケージへ同期）、そして `packages/fetch/__tests__/operationLane.exhaustive.test.ts` — §4.1 の法則を CI に収まる深さまでの全列で、壊した版と一緒に
3. **view transition 下のルーター**: happy-dom の実物のルーター、偽の `startViewTransition`、試験が操るガードとフレーム。ナビゲーション・Back・Forward・クエリだけのナビゲーションを決着と一緒に列挙し、§5-1 の法則で検査する
4. その後 ④ と ⑤、次のスイートとしてリストの調停（§5-4）と `transition-runner`（§5-3）。チェックリスト（§5）は未決

段階ごとに 1 つのプルリクエストにする。後のスイートが見つけた反例は、§6 のものと同じく著者へ持っていく。
