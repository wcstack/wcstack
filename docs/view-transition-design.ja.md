# 遷移アニメーション設計 — `<wcs-view-transition>` と transition-runner プロトコル

**English**: [view-transition-design.md](./view-transition-design.md)

wcstack 自身が起こす DOM 変更 — リスト行の出入り、`if` 分岐の mount/unmount、
ルートの差し替え — をどうアニメーションさせるか。決定事項、パッケージ間で使う
プロトコル、段階的な導入計画をここに固定する。

## 1. 何が欠けていて、何は欠けていなかったか

wcstack が DOM を変更する箇所はちょうど 3 つ。

| 箇所 | コード | 現在の削除のされ方 |
|---|---|---|
| リスト行 | [`applyChangeToFor`](../packages/state/src/apply/applyChangeToFor.ts) | `deactivateContent` → `content.unmount()` を**同期**実行。ノードはその場で detach され、content はアンカーごとのプールへ |
| 条件分岐 | [`applyChangeToIf`](../packages/state/src/apply/applyChangeToIf.ts) | 同じ — 条件が false になった瞬間に detach |
| ルートコンテンツ | [`hideRoute`](../packages/router/src/hideRoute.ts) / [`showRoute`](../packages/router/src/showRoute.ts) | `removeChild` → `insertBefore` を同期実行 |

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
| G5 | SSR / ハイドレーション | **無効**。`inSsr()` 中は遷移を開始しない。`document.startViewTransition` が無い環境ではタグ自体が不活性。 |

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
  DOM の挙動どおりになる。

自動命名には上限がある（`naming-limit`、既定 200）。命名された要素は 1 つずつ
スナップショットグループになり、数百個あると遷移は目に見えて重くなる。上限を超えると
state は命名を止めて一度だけ警告する。大きなリストを持つページは manual で意図的に
命名すべき。

## 7. 参加者ごとの契約

### 7.1 `@wcstack/router`

[`showRouteContent`](../packages/router/src/showRouteContent.ts) を**ガード相**と
**変更相**に分割し、変更相だけを包む。ルートガードは任意の await を含みうるので、
それを更新コールバック内で走らせると、ガードが終わるまで遷移が開きっぱなしになる
（ブラウザの猶予は約 4 秒）。この分割は「ガードより先に旧ルートを隠していた」という
順序の歪みも同時に直す。

`navigate` イベントの `intercept({ handler })` は `run()` を await する。つまり
ナビゲーションは DOM が変わるまで進行中であり、アニメーションの間ずっとではない。

### 7.2 `@wcstack/state`

包む点は [`Updater._applyChange`](../packages/state/src/updater/updater.ts) の drain
— `applyChangeFromBindings(processBindings)` の 1 点のみ。規範的な帰結:

- drain は既に microtask だが、遷移を挟むと**フレーム**になる。state に書いてから
  `await Promise.resolve()` で DOM を読むコードは、遷移を待つ（あるいは
  `$updatedCallback` を使う。これはバインディング適用後、コールバック内で発火する）
  必要がある。
- 参加は**要素単位ではなくドキュメント単位**。updater は全 `<wcs-state>` をまとめて
  drain するので、`for="state"` は全部に効く。
- 初期レンダリングは決して包まない。包むのは drain だけ。
- `inSsr()` は同期パスへ短絡する（G5）。

## 8. 不変条件

1. `<wcs-view-transition>` の無いページは従来と完全に同じ挙動になる。同じコードパス、
   同じタイミング、追加コストは drain あたり Symbol 参照 1 回のみ。
2. `run()` へ渡された DOM 変更は、runner がアニメーションについて何を決めようと、
   ちょうど 1 回適用される。
3. runner は自分の都合では決して reject しない。reject するのは `mutate` が throw した
   ときだけ。
4. 削除はどこでも同期のまま。アニメーションのために content を mount したままにする
   ことはしない。
5. 自動割り当ての名前はドキュメントの生存期間で一意。

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
