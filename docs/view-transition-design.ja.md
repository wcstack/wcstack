# 遷移アニメーション設計 — `<wcs-view-transition>` と transition-runner プロトコル

**English**: [view-transition-design.md](./view-transition-design.md)

wcstack 自身が起こす DOM 変更 — リスト行の出入り、`if` 分岐の mount/unmount、
ルートの差し替え — をどうアニメーションさせるか。決定事項、パッケージ間で使う
プロトコル、段階的な導入計画をここに固定する。

## 1. 何が欠けていて、何は欠けていなかったか

wcstack が DOM を変更する箇所はちょうど 3 つ。

| 箇所 | コード | 現在の削除のされ方 |
|---|---|---|
| リスト行 | [`applyChangeToFor`](https://github.com/wcstack/wcstack/blob/v3.5.4/packages/state/src/apply/applyChangeToFor.ts) | `deactivateContent` → `content.unmount()` を**同期**実行。ノードはその場で detach され、content はアンカーごとのプールへ |
| 条件分岐 | [`applyChangeToIf`](https://github.com/wcstack/wcstack/blob/v3.5.4/packages/state/src/apply/applyChangeToIf.ts) | 同じ — 条件が false になった瞬間に detach |
| ルートコンテンツ | [`hideRoute`](../packages/router/src/hideRoute.ts) / [`showRoute`](../packages/router/src/showRoute.ts) | `removeChild` → `insertBefore` を同期実行 |

上の 2 行は、この設計が書かれた時点の `@wcstack/state` 3.x のコード。4.0 では同じ箇所は `dom/view.ts` の `ForView` / `IfView` で、削除はやはり同期（4.0 は content のプールを持たない）。

一方、フレームワークを一切変えずに**すでにできていた**ことが 2 つある。単に
ドキュメント化されていなかっただけだった。

- **値の遷移**。`class.x:` / `style.y:` バインドは生きた要素へ書き込むので、
  通常の CSS `transition` がそのまま効く。
- **入場アニメーション**。`@starting-style`（離散プロパティが絡むなら
  `transition-behavior: allow-discrete` と併用）は「新しく DOM に挿入された要素」に
  効く。新規リスト行も mount する `if` 分岐もまさにそれ。

本当に欠けていたのは**退場（leave）と移動（move）**である。

- 削除された行・分岐・ルートは退場できない。次のフレームを描く時点でノードが無い。
- 並べ替えたリストは移動を見せられない。並べ替えの実体は `insertBefore` の列で、
  中間状態が存在しない。

## 2. なぜ View Transition API で、enter/leave クラスではないのか

分かりやすい対案 — Vue 風の `.x-leave-active` クラス + `unmount()` の遅延 — は、
アニメーションが終わるまで削除済み content を DOM に残すことを要求する。これは
`applyChangeToFor` が現在依存している不変条件をことごとく壊す。すなわち逐次的な
`lastNode` ウォークと `stableIndexSet` / `isPhysicallyAfter` の位置ガード、content
プール（退場中の content を新しい行へ渡してはいけない）、退場中に同じキーが再追加
されたときの再入、退場中の行が state 更新を受け取るのか、全削除の
`parentNode.textContent = ''` 高速パス、そして MutationObserver の skip マーク。

View Transition API はそれを全部迂回する。ブラウザが変更**前**の状態を
スナップショットするので、退場する要素は変更後に存在している必要が無い。削除は
同期・即時のままでよく、プールも台帳も無傷で、`view-transition-name` さえ付けば
並べ替えのモーフは無料で付いてくる。

よって Phase 1–2 の機構は View Transition とする。enter/leave クラスは Phase 3 として
残すが、「他のフレームワークにあるから」ではなく需要で正当化する。

## 3. 決定事項

| # | 論点 | 決定 |
|---|---|---|
| G1 | drain の同期契約を破ってよいか | **可（opt-in）**。`startViewTransition` で包むと DOM 変更は後のフレームへ移る。opt-in は `<wcs-view-transition>` の存在そのもの（`for=` で絞れる）。 |
| G2 | 排他（同時に 1 つ）はどう行うか | **`<wcs-view-transition>` タグが行う**。唯一の調停者として、同一 microtask 中の全リクエストを 1 つの遷移へ合流させ、実行中に来たリクエストには宣言された `mode`（`latest` / `queue` / `exhaust`）を適用する。 |
| G3 | `view-transition-name` は自動か手動か | **両方。タグの `naming="manual" \| "auto"` で選ぶ**（既定 `manual`）。 |
| G4 | `prefers-reduced-motion` | **既定でスキップ**。そのとき変更は同期実行され、現行と完全に同じ挙動になる。`reduced-motion="animate"` で上書き。 |
| G5 | SSR / ハイドレーション | **無効**。ドキュメントが `data-wcs-server` を持つ間は arbiter 自身が遷移の開始を拒む。`document.startViewTransition` が無い環境ではタグ自体が不活性。ゲートは参加者ごとではなく arbiter に置く —— プロトコルは公開されており、第三者の参加者が wcstack の SSR マーカーを知っている理由は無いため。`@wcstack/state` 3.x は自前の `inSsr()` 短絡を fast path として残す。`@wcstack/state` 4.0 と `@wcstack/router` は arbiter のゲートだけに頼る。 |

## 4. transition-runner プロトコル

パッケージ間に依存を作らないため、`@wcstack/state` と `@wcstack/router` はタグを
import しない。よく知られたグローバル Symbol から runner を引き、無ければ変更関数を
直接呼ぶ（＝現行の挙動そのもの）。

正本: [`/protocol/transition-runner.ts`](../protocol/transition-runner.ts)。
`scripts/sync-protocol-types.mjs` が各パッケージの
`src/protocol/transitionRunner.ts` へ複製する。

```ts
const TRANSITION_RUNNER_KEY = Symbol.for("wcstack.transition-runner");

interface IWcsTransitionRunner {
  readonly protocol: "wcs-transition-runner";
  readonly version: number;            // reader は >= 1 を受理
  readonly naming: "manual" | "auto";
  readonly namingLimit: number;        // 自動命名の上限（§6）
  accepts(source: string): boolean;    // 参加者ゲート（`for=` の実体）
  run(mutate: () => void, options?: { source?: string; types?: readonly string[] }): Promise<void>;
}
```

規則:

1. **`run()` は `mutate` を必ず 1 回だけ呼ぶ**。遷移を開始できない（未対応ブラウザ、
   reduced motion、`disabled`、`exhaust` で実行中）ことは、DOM 更新を落としてよい
   理由にならない。
2. **返る Promise は `mutate` が走った時点で resolve** する。アニメーション完了では
   ない。DOM 変更後に続きが要る参加者（`router.path` を更新するルータ）はこれを
   await する。アニメーションを待つものは無い。
3. **遷移がスキップされる場合、`mutate` は `run()` 内で同期実行**される。reduced-motion
   と未対応環境のタイミングを現行と完全に一致させるため。
4. **同一 microtask のリクエストは 1 つの遷移へ合流**する（呼び出し順）。ルート変更と
   それが引き起こす state drain は、互いに潰し合わず 1 つの遷移になる。
5. **throw する `mutate` はバッチを道連れにしない**。各変更は隔離され、自分の Promise
   だけが reject する。
6. **runner が無い、または `accepts(source) === false` なら同期適用**。タグがページに
   無い限り、どちらのパッケージの挙動も変わらない。
7. **何も変えない変更のために参加者は `run()` を呼ばない**。arbiter には空の変更と
   本物の変更を見分ける手立てが無く、そこで開始される遷移はただ無駄なだけではない
   —— ページ全体をスナップショットし、既定の `latest` では*実行中の遷移をスキップ
   する*。仕事があるかどうかを知っているのは参加者だけなので、篩い分けは参加者の
   責務になる。具体例は §7.2。

## 5. `<wcs-view-transition>`

I/O ノードではなくポリシーノード。バインドするデータを持たず、ページ全体の遷移の
振る舞いを宣言する。1 ドキュメントに 1 つ。

| 属性 | 値 | 既定 | 意味 |
|---|---|---|---|
| `for` | 参加者の空白区切り（`router` / `state`） | `router state` | どの参加者をアニメーションさせるか。`for="router"` なら state の drain は完全に同期のまま。 |
| `mode` | `latest` / `queue` / `exhaust` | `latest` | 遷移実行中にリクエストが来たときの挙動。`latest`: 実行中をスキップして新規開始。`queue`: 完了後に連結。`exhaust`: アニメーション無しで即時適用。いずれの場合も変更は必ず適用される。 |
| `naming` | `manual` / `auto` | `manual` | §6 参照。 |
| `naming-limit` | 整数 | `200` | 自動命名の上限。 |
| `reduced-motion` | `skip` / `animate` | `skip` | G4。 |
| `types` | 空白区切り | — | 対応環境で `startViewTransition({ types })` へ渡す（`:active-view-transition-type()` 用）。 |
| `disabled` | boolean | 無し | 不活性 runner。全リクエストが同期適用になる。タグを置いたまま state から遷移を切れる。 |

wc-bindable サーフェス: observable property は `active`（遷移実行中か）と `error`、
input は `disabled` / `mode` / `naming` / `types`、command は `skip` / `start`。

## 6. 命名

`view-transition-name` はスナップショットが撮られる**前**に要素へ付いている必要が
あり、変更コールバックの中では付けられない。したがって「変わったものだけ命名する」は
原理的に不可能で、`naming` 属性が提示する選択が残る。

- **`manual`（既定）**。著者が自分でバインドする: `style.viewTransitionName: id`。
  今日そのまま動き、コストゼロで、どの要素をモーフさせるかを完全に制御できる。
- **`auto`**。`@wcstack/state` が構造 content（リスト行・`if` 分岐）の最初の要素へ、
  mount 時に一意で安定した `view-transition-name` を付ける。加えて
  `view-transition-class`（`wcs-row` / `wcs-branch`）も付けるので、CSS からグループを
  まとめて指せる。名前は **content に付いて回る**ので、プール再利用も並べ替えも
  DOM の挙動どおりになる（4.0 はプールを持たず、ブロックを作るときに命名する。残した行は
  要素ごと、名前ごと残る）。

自動命名には上限がある（`naming-limit`、既定 200）。命名された要素は 1 つずつ
スナップショットグループになり、数百個あると遷移は目に見えて重くなる。上限を超えると
state は命名を止めて一度だけ警告する。大きなリストを持つページは manual で意図的に
命名すべき。

カウンタと上限はモジュールスコープではなく `Symbol.for` のスロットに置く。runner 鍵と
同じ理由で、`@wcstack/state` が 1 ページに 2 部載ると両方が `wcs-row-1` を発行して
しまい、`view-transition-name` の重複はブラウザに遷移そのものを abort させるため。

命名は content の mount 時に起きるので**ロード順に依存する**。`<wcs-view-transition>`
が upgrade する前に mount した行・分岐は二度と見直されず、名前が付かないままになる。
タグのスクリプトを state バンドルより前に置くか、初回描画の分は行ごとに morph せず
ルートのスナップショットに含まれることを受け入れること。

## 7. 参加者ごとの契約

### 7.1 `@wcstack/router`

[`showRouteContent`](../packages/router/src/showRouteContent.ts) を**ガード相**と
**変更相**に分割し、変更相だけを包む。ルートガードは任意の await を含みうるので、
それを更新コールバック内で走らせると、ガードが終わるまで遷移が開きっぱなしになる
（ブラウザの猶予は約 4 秒）。この分割は「ガードより先に旧ルートを隠していた」という
順序の歪みも同時に直す。

**最初のルート適用は決して包まない**。state の「初期レンダリングは決して包まない」と
同じ規則で、理由も同じ —— 旧ルートが無ければ対比すべき旧状態も無く、それは差し替えでは
なく入場であり、入場は `@starting-style` の担当（§1）。加えてこれは実務上も必須で、
router は `_initialize` の中で最初のルート適用を await するが、その時点のドキュメントは
まだ最初の描画を終えていない。そこで開始した遷移は Chromium で更新コールバックが
呼ばれないまま留まることがあり、router の初期化がそのまま終わらなくなる。実ブラウザで
しか再現しないので、回帰テストは `e2e/tests/view-transition.spec.ts`。

`navigate` イベントの `intercept({ handler })` は `run()` を await する。つまり
ナビゲーションは DOM が変わるまで進行中であり、アニメーションの間ずっとではない。

### 7.2 `@wcstack/state`

包む点は `Engine.drain`（`engine.ts`）の drain のパスごと。パスの DOM の変更 —— 先に
リストのビュー、次にキューのバインディング —— を `runTransition("state", …)` へ渡す。
規範的な帰結:

- drain は既に microtask だが、遷移を挟むと**フレーム**になる。state に書いてから
  `await Promise.resolve()` で DOM を読むコードは、遷移を待つ（あるいは
  `$renderedCallback` を使う。これは預けたバインディングの適用直後、コールバック内で
  発火する。その適用のバインディングの失敗も、そこで `$errorCallback` に届く）必要がある。
- **機構間の順序が反転する**。drain の終わりにエンジンは報告し —— `$renderedCallback`、
  次にバインディングの失敗（`$errorCallback`、無ければコンソール）—— それから
  `drained` フックを走らせ、temporal の後付けがそこで `$watch` ハンドラ、次に
  `$stream` の再開を走らせる。`$watch` と再開は state を消費し DOM を見ないので元の
  microtask に留まり、`$renderedCallback` は預けたバインディングと一緒に更新
  コールバックへ乗る。したがって宣言どおりの順序 `$renderedCallback` → `$watch` →
  `$stream` restart は、arbiter が state の変更を預かっている間だけ `$watch` →
  `$stream` restart → `$renderedCallback` になる。これは意図的な選択であり
  （`$watch` を 1 フレーム待たせる方が悪い）、あの層が固定であることの唯一の明文化
  された例外である。arbiter が `run()` の中で同期的に適用するとき —— §4 の規則 3 と、
  `exhaust` で走行中の遷移がすでに更新コールバックを過ぎているとき —— は、宣言どおりの
  順序のまま。
- **描画の連鎖は預けた先へ引き継がれる**。預けた適用が同期的に書いたもの（要素の
  書き戻し、同期の `$renderedCallback`）は、変更を預けた drain の連鎖の次の drain と
  して数えるので、描画の連鎖の上限（100 回の drain）は arbiter を挟む更新のループも
  打ち切る。async の `$renderedCallback` が `await` の後で書いたものは新しい連鎖を
  始めるので、そのループは遷移 1 回につき 1 周ずつ進み、打ち切られない。
- **描くもののないパスは arbiter へ渡さない**。書き込みがキューに入れるのは、その
  パスを描くバインディングとリストだけ。何も描かないパス —— `$watch` 専用のパス、
  `$stream` の内部値 —— への書き込みも、`$watch` / `$stream` の反応のために drain を
  予約するが、その drain はパスを 1 つも走らせず、`run()` も呼ばない。そこで遷移を
  要求すると、何も変わらない変更のためにページ全体をスナップショットすることになり、
  `latest` では*本当に*アニメーションしているルート遷移を途中で切ってしまう。
- 参加は**要素単位ではなくドキュメント単位**。`<wcs-state>` のエンジンはそれぞれ自分の
  microtask で drain し、パスを同じ arbiter へ渡すので、`for="state"` は全部に効く。
  同じ microtask の中のリクエストは 1 つの遷移へ合流する（§4 の規則 4）。
- 初期レンダリングは決して包まない。ページは state を読み込んだ時点で、drain の外で
  束ねる。包むのは drain だけ。
- SSR では arbiter の `data-wcs-server` のゲートが変更を同期的に適用する（G5）。4.0 の
  state は自前の SSR の短絡を持たない。

`@wcstack/state` 3.x は `Updater._applyChange`（`applyChangeFromBindings(processBindings)`）
を drain ごとに 1 回包み、1 つの updater がすべての `<wcs-state>` を drain した。書き込みは
バインドの有無に関わらず enqueue し、`processBindings.length === 0` のバッチを飛ばした。
`inSsr()` で短絡した。順序 `$updatedCallback` → `$scan` → `$watch` → `$streams` restart
は、arbiter の下で `$scan` → `$watch` → `$streams` restart → `$updatedCallback` になった。

## 8. 不変条件

1. `<wcs-view-transition>` の無いページは従来と完全に同じ挙動になる。同じコードパス、
   同じタイミング、追加コストは drain のパスあたり Symbol 参照 1 回のみ（`@wcstack/state`
   4.0 では、自動命名のためにリスト・分岐の更新あたりにも 1 回）。
2. `run()` へ渡された DOM 変更は、runner がアニメーションについて何を決めようと、
   ちょうど 1 回適用される。
3. runner は自分の都合では決して reject しない。reject するのは `mutate` が throw した
   ときだけ。
4. 削除はどこでも同期のまま。アニメーションのために content を mount したままにする
   ことはしない。
5. 自動割り当ての名前はドキュメントの生存期間で一意。
6. 参加者が arbiter へ渡すのは「何かを変える変更」だけ。空のバッチは同期パスを通る
   ので、誰にも見えない変更のために遷移が開始されることも、開始済みの遷移が
   取り消されることも無い。

## 9. ロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| **0** | 本ドキュメント。「すでにできること」（`@starting-style`、`style.viewTransitionName`、`if` の代わりにクラストグル）を利用者が見つかる場所に書く | 完了 |
| **1** | `@wcstack/view-transition` パッケージ（プロトコル・タグ・調停）とルータ統合（ガード相/変更相の分割を含む） | 完了 |
| **2** | state の drain 統合、自動命名、タイミング契約の追記 | 完了 |
| **3** | 宣言的 enter/leave クラス（unmount 遅延、§2） | 未着手 — 需要と、§2 が挙げた不変条件を固定する ADR が前提 |

## 10. 非目標

- フレームワーク自身が変更していないものをアニメーションさせること。それは CSS の仕事。
- JS のアニメーション API。`<wcs-view-transition>` は遷移の開始と調停を行うだけで、
  アニメーション自体は `::view-transition-*` に対して CSS で書く。
- クロスドキュメント遷移（`@view-transition { navigation: auto }`）。SPA ルータは
  ドキュメントを離れないので、same-document API だけが該当する。
