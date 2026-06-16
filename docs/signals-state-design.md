# 設計メモ: signals ベースの軽量状態管理（`@wcstack/signals`）

- **状態**: **実装完了（2026-06-16・v1.13.1）**。本実装は [signals-migration-plan.md](signals-migration-plan.md) に沿って Phase 0–4 を完了（packaging 本番化 / bindNode 3サーフェス / h ハードニング＋For・Index / resource×ノード cancel）。残るはリリース操作（`npm publish`）のみ。本文書は設計の論点整理と確定記録で、§8 が PoC 結果、§9 が本実装移行の作業記録。確定した規範・API は各 README と migration-plan を参照。
- **対象**: `@wcstack/state` を**置き換えない**、別系統の新パッケージ。signals を反応性エンジンに据え、非同期IOノード（wc-bindable-protocol 準拠タグ群）を resource として取り込む、より標準に近い軽量・JS-first な状態管理。
- **一言で**: 「`data-wcs` DSL + パスアドレッシング」を捨て、`Signal.State` / `Signal.Computed` を直接露出する。reactive proxy ではなく cell ベース。非同期IOノードは signal アダプタ一枚でそのまま刺さる。
- **前提資産**: wc-bindable protocol（properties / commands / event-token）、[[command-token-protocol]] / [[event-token-protocol]]、spread/fetch の microtask coalesce、[[state-stream-type-design]]（async fold の論点を共有）、[[watch-hook-design]]。
- **着想の経緯**: 「state を signals で作り直せないか」という問いから。検討の結果、**signals 化は state の置換ではなく別系統の新設**であり、価値は反応性エンジンの差し替えではなく「DSL を捨てて signal を直接露出する」ことにある、という再フレーミングに至った。

---

## 0. 大前提: なぜ state を「置き換え」ないのか

`@wcstack/state` の重量本体は reactive proxy ではない。ソース構成を見ると core の大半は以下が占める:

- `address/` — パスベースのアドレッシング（`a.b.*.c` 文字列パス・ワイルドカード・`AbsoluteStateAddress`）
- `bindTextParser/` + `binding/` + `bindings/` — `data-wcs` DSL のパーサと束縛ライフサイクル
- `list/` — 配列 diff・`loopContext`・wildcard インデックス
- `dependency/` — パス依存グラフの追跡

**signals が置き換えるのは `proxy/` + `dependency/` だけ**である。DSL とパスアドレッシングを残したまま反応性エンジンだけ signal に挿げ替えても、軽くならない（むしろ proxy の自動深追跡を失って劣化する）。

したがって「軽量版」の本質は *reactivity エンジンの差し替え* ではなく、**バインディング層を捨てて signal を直接 JS から触らせること**にある。これは state とは思想が異なるので、置換ではなく**別系統の併存**として設計する。

| | `@wcstack/state`（現行） | **`@wcstack/signals`（本案）** |
|---|---|---|
| 思想 | HTML 宣言的・DSL 駆動 | JS-first・プログラマブル・軽量 |
| 反応性 | 独自 proxy + パス依存追跡 | `Signal.State` / `Signal.Computed`（cell ベース） |
| 深い反応性 | パスで自動（`a.b.c`） | cell 単位（必要なら明示 wrap） |
| 束縛 | `data-wcs` 文字列 DSL | signal 直接参照 / 極小テンプレ式 |
| 標準性 | 独自実装 | TC39 Signals 提案に追従（§4 の代償あり） |
| 非同期IO | command/event-token + spread | 同じノードを resource(signal) として取り込む |

---

## 1. プリミティブの形（草案）

TC39 Signals（`Signal.State` / `Signal.Computed` / `Signal.subtle.Watcher`）の形をそのまま採る。これに **非同期IOノードを signal 化する resource** を足す。

```js
import { state, computed, resource, effect } from '@wcstack/signals';

// 同期 cell
const count = state(0);
const doubled = computed(() => count.get() * 2);

// 非同期IOノードを signal として取り込む（§3）
const user = resource(
  () => fetchNode,                 // wc-bindable な非同期IOノード or async source
  { args: () => ({ id: id.get() }) } // 依存が変われば再取得（cancel/restart）
);
// user.value / user.loading / user.error が signal

effect(() => {
  document.querySelector('#n').textContent = String(doubled.get());
});
```

- `state` / `computed` は TC39 提案の薄いラッパ（または素通し）。
- `resource` が本パッケージ固有の価値。async source を `{ value, loading, error }` の signal triad に畳む（fetch の triad と同型・[[state-stream-type-design]] の fold と地続き）。
- 連続フロー（stream）を食う場合は `resource` の上位に fold を持つ `streamResource`（latest / reduce）を将来検討。これは state 側 `$streams` 案（[[state-stream-type-design]]）の signals 版に相当。

---

## 2. signal の実体 — polyfill か自前か（最重要・哲学の核）★

「標準に近い」の代償。**TC39 Signals は Stage 1 で、まだ標準ではなく polyfill 依存**である。wcstack の zero-dependency 原則と正面から緊張する。

| 選択肢 | 利点 | 欠点 |
|---|---|---|
| A. `signal-polyfill` 依存 | 提案 API に忠実・将来ネイティブ移行で削除可能 | **runtime 依存が入る**（zero-dependency 原則違反） |
| B. 自前の極小 signal | zero-dependency 維持・数百行で書ける | 提案との API 乖離リスク・自分でメンテ |
| C. 自前だが提案 API 互換 | zero-dependency + 将来 polyfill/native と差し替え可能 | 実装コスト中・`subtle.Watcher` 相当まで要る |

**推奨は C**。`State` / `Computed` / 依存追跡 / `Watcher`（glitch-free な再計算とバッチ）だけの極小実装を提案 API シグネチャに合わせて自前で持ち、ネイティブ実装が来たら差し替えられる構造にする。zero-dependency と「標準ファースト」を両立する唯一の筋。

> ここはパッケージの存在意義に直結する。「標準ファースト」を名乗る以上、API は TC39 提案に寄せるが、依存は持たない。この一貫性が崩れるなら本案の旨味（軽量・標準・zero-dep）が半減する。

---

## 3. 非同期IOノードとの相互運用 — ここは既に解けている

本案最大の追い風。既存の非同期IOノード（wcs-fetch / wcs-geo / wcs-broadcast / wcs-sse …）は **wc-bindable-protocol（properties / commands / event-token）** でしゃべっており、**背後が proxy か signal かを知らない**。よって signals コア側に *protocol ⇄ signal アダプタ* を一枚かませば、既存ノードがそのまま刺さる。

### 3-1. 三サーフェスの signal へのマッピング

| 向き | protocol サーフェス | signal 側 |
|---|---|---|
| element → state | property（getter / 値スナップショット） | **読み取り signal**（property 変化を `state` cell に push） |
| element → state | event-token（繰り返し通知） | **event を fold した signal**（per-emit で更新・stream 系） |
| state → element | command-token（start/cancel/abort 等） | signal の値変化 or 明示 `command()` 呼び出しで emit |
| state → element | property（書き戻し / 入力） | signal → element property への effect |

### 3-2. アダプタの責務

- ノードの property を購読し、変化を signal に反映（element → signal）。
- signal を購読し、変化を node property へ反映（signal → element）。両方向の無限ループ防止は same-value ガード（[[notification-tag-design]] 等で実証済みの規範）。
- event-token は per-emit で signal を更新（latest）か fold（reduce）。
- **冪等性**: binding 張り直しで再評価できること。live stream ハンドルを signal の値にしない（[[state-stream-type-design]] §7 の規範をそのまま継承）。

### 3-3. 帰結

非同期IOノード群は **state 系と signals 系で共有資産になる**。タグ側を二重に作る必要がなく、「IO はノード、反応性はコア」の分離が両系統で効く。これは wcstack 全体のアーキテクチャ（IO ノードと状態の分離）を裏づける良い実証にもなる。

### 3-4. 設計原理: 複雑性は async に宿る — だから seam に隔離する ★

§3 の分離は、単なる実装上の都合ではなく **wcstack の背骨となる設計原理** として明文化しておく。

**前提: 複雑性は async × リアクティビティ × ライフサイクルの掛け算に宿る。** 同期だけの状態管理は本質的に「値が変わったら依存箇所を更新する」であり、それほど難しくない。難しさが跳ね上がるのは非同期がリアクティブモデルに侵入した瞬間で、既存FWの最難関機能（React の `useEffect` レース / Suspense / concurrent rendering の tearing、Vue の async setup / `<Suspense>`、Svelte の `{#await}`）は**ほぼ全て async がライフサイクルに飲み込まれた代償**である。どのFWでも同じ4つの罠が繰り返し現れる:

1. **競合 / stale** — A→B と投げて A が後着したら B を上書きしてはいけない
2. **キャンセル** — 標準では誰も自動でやってくれない（毎回 AbortController を手配線）
3. **順序付け（switchMap）** — 最新だけ残す、を素朴なコードはほぼ間違える
4. **loading/error/success の状態機械**が至る所に重複（react-query / SWR / Suspense が生まれた理由そのもの）

**原理: この複雑性は削除できない。できるのは「どこに置くか」だけ。** 既存FWの多くはこれを render / reactive モデルの**中に混ぜた**ので、4つの罠が**全コンポーネントに薄く広がる**（各所で effect を正しく書く責任が利用者に飛ぶ）。wcstack の賭けは、async を **wc-bindable + bindNode の境界に隔離する**こと。コアは「Promise を一切知らない純同期関数」のまま保て（`bindNode` の中身は `addEventListener` だけで await を持たない）、競合・キャンセル・switchMap・loading 状態は**ノード（または `resource`）の中で一度だけ**解く。利用者のコードには漏れない。

**「軽量」の正確な意味は2軸に分かれる。** ここを混ぜるとスローガンが脆くなる:

- **① コア（FW本体）の軽さ → 明確に成立。** コアは API 表面積が小さく（signal/computed/effect/h）、provably simple（テストもデバッグも同期で完結）、TC39 signals へ差し替え可能（async が絡むと標準化は不可能）、async を使わないアプリはコアだけで完結する（fetch を import しなければ async コードはゼロ byte）。
- **② アプリ全体のバイト数 → 部分的にしか成立しない。** async を使うアプリは結局 FetchCore 等を積むので**送出総バイトはほぼ変わらない**。変わるのは払い方で、**pay-as-you-go** になる。async の複雑性は**消えず、ノードへ移る**。

**正直なコスト（ノード化はタダではない）。** 軽くなる対価として複雑性は別の場所に出る: (a) あらゆる async 能力を「properties/event/command を持つ custom element」として表現する seam のオーバーヘッド（debounce のような小物まで DOM ノードに包むのは関数より重い面がある）、(b) 合成の複雑性がバインディング層（token / spread 配線）に移る、(c) グローバルなリクエストインターセプタや認証リフレッシュのような**横断 async** が苦手、(d) コアも完全には純化しきれない（`resource`/`streamResource` は ergonomics のためコアに残り、§5-2 の最難問はノードに移してもコアの隣に居座る）。

**精密化したテーゼ（このプロジェクトが支持する形）:**

> **async をノードへ隔離すると、リアクティブコアは純同期で provably simple に保て、async は pay-as-you-go になる。総複雑性は減らないが、「全コンポーネントに薄く広がる」状態から「少数の明示的 seam に濃く凝縮する」状態へ移り、再利用と検証可能性が上がる。**

「FW が軽くなる」という一行スローガンより、この形の方が実装（bindNode が同期・async は別パッケージ）とも、§5-2 で自ら最難問と認める姿勢とも矛盾しない。スローガンとして README に出すなら前半（コアは純同期）だけ、設計原理として残すなら後半（隔離 = 再利用）まで、と使い分ける。

---

## 4. 束縛層 — DSL を捨てて何にするか

state の `data-wcs` DSL を捨てるのが本案の主眼。代替を決める必要がある。

| 案 | 形 | 評価 |
|---|---|---|
| 1. effect 直書き | `effect(() => el.textContent = sig.get())` | 最軽量・最標準。だが宣言性ゼロ（命令的） |
| 2. 極小テンプレ式 | `` html`${doubled}` `` のような tagged template | 宣言的。だが **JSX の落とし先になれない**（§4-1）。別テンプレエンジンを抱える |
| 3. signal 対応 web component 属性 | `<x-counter .value=${sig}>` 風 | wc-bindable と相性。だが結局 binding 層が要る |
| 4. fine-grained hyperscript | `h(tag, props, ...children)` ＋ `Fragment` | **JSX の落とし先になれる**（§4-1）。real DOM 一度生成＋signal prop だけ effect 更新 |

**推奨は 1 を基盤に、必要なら 4 を薄く乗せる**。本案の客は「DSL を嫌う JS-first ユーザー」なので、まず `effect` + signal 直接参照で十分機能する最小形を出す。テンプレ DSL を厚く作ると state と差別化できなくなる（重さの理由が DSL だったのだから本末転倒）。

> 判定線: 宣言的束縛が欲しいなら state を使えばよい。signals 系は「signal を JS で組み、effect で DOM を更新する」軽量・命令寄りのレイヤとして state と棲み分ける。

### 4-1. JSX を「乗せられるが乗せない」seam として設計する

テンプレ層を **「将来 JSX が乗ることを想定し、実際はその手前でとどめる」** 方針で設計する。

**なぜ tagged template でなく `h` か。** JSX は標準のトランスフォームでは **関数呼び出し（classic `h(type, props, ...children)` / automatic `jsx(type, props)`）にしか落ちない**。`html\`...\`` テンプレリテラルは JSX のコンパイル先になれない。よって「JSX が乗る土台」を本当に成立させるなら、テンプレ層は **hyperscript（jsx-factory 形）** を選ぶ必要がある。これが案 2→案 4 への差し替え理由。

**buildless との両立。** JSX はトランスパイル必須で buildless 原則に反するため、JSX 自体は blessed path にできない。しかし `h(...)` は無ビルドでそのまま呼べる。ゆえに:

- **出荷するのは `h` / `Fragment`（＝JSX が乗る土台）まで。**
- **JSX はユーザ自身の tsconfig（`jsxImportSource` / `jsxFactory`）で opt-in。** ユーザが JSX を選んだ時だけ buildless を抜ける＝彼らの選択。パッケージは zero-config を保つ。

これが「想定する／手前でとどめる」の正確な実装。

**成立させる3つの規律:**

1. **fine-grained に固定（VDOM にしない）。** `h` は real DOM を一度生成し、signal/関数で渡された prop **だけ** を effect で更新する（Solid 流）。VDOM + reconciler を抱えると「軽量」という存在意義が消える。
2. **前向きな譲歩は1つだけ＝reactive children。** `h` は children に関数/signal を受ける（`() => cond.get() ? A : B`）。これが条件/リストの control flow 基盤で、JSX 式もこの thunk に落ちる。**それ以外の JSX 意味論（key / ref / context / controlled input）は今は contract に入れない**＝これが「手前でとどめる」の規律。
3. **seam を正直に保つ。** JSX を出荷しない＝パッケージに `.tsx` を入れない／jsx-runtime の型を今は出さない／トランスパイル必須の example を出さない。`h` の contract は buildless 利用が要求する分だけ最小に。

**層の置き場所:**

- `reactive.ts` は純粋なまま（DOM 非依存）。
- DOM 層は別エントリ（`@wcstack/signals/dom` 等）に `h` / `Fragment`。
- 将来の JSX runtime は `@wcstack/signals/jsx-runtime` の**別エントリ seam**（今は空席）。

**スコープ段階**: (a) substrate のみ / (b) `h`+`Fragment` まで / (c) jsx-runtime エントリまで、のうち **(b) を推奨**。「JSX が乗る形だが JSX は出荷しない」が最もちょうどいい。これは wc-bindable をフレームワーク非依存の seam にしている wcstack の設計思想（protocol seam）と同型。

---

## 5. 決めるべき論点（重要順）

### 5-1. signal 実体（§2）★ — polyfill 依存 vs 自前互換実装。哲学の核。最初に確定。

### 5-2. async resource の cancel / restart ★ — [[state-stream-type-design]] §4-1 と**同じ最難問**

`resource` の source が他 signal に依存する場合、依存変化で古い取得を abort して張り直す（switchMap 相当）。

- 古い取得の AbortSignal を発火 → `initial` リセット（or 直前値保持＝要決定）→ 新 source 起動。
- computed の依存追跡を **async な寿命へ拡張**する話。purity を欠くと「古い応答が新しい state に混ざる」「abort 漏れリーク」。
- **state 系の `$streams` と設計を共有できる**。両系統で同じ cancel/restart セマンティクスを使えば実装も規範も一本化できる。ここは state-stream 案と**合同で詰めるべき**。

### 5-3. coalesce（再入・性能）

高頻度更新（高速トークン / 60fps）でチャンク毎に effect を回すと thrash。spread/fetch で導入済みの **microtask coalesce** を Watcher のバッチに効かせ、1 tick の複数更新を1回の DOM 反映に畳む。TC39 Signals の Watcher セマンティクス（notify は同期、再計算は遅延）と整合させる。

### 5-4. 深い反応性の扱い

cell ベースなので `obj.a.b` の自動追跡は無い。

- 推奨: **明示的に signal を粒度設計させる**（オブジェクトまるごと1 signal、または必要なフィールドを個別 signal）。proxy で深追跡したいなら state を使えばよい、という棲み分け。
- 浅い proxy ラッパ（`reactive(obj)` が第一階層を signal 化）を将来オプションで足す余地は残すが、第1段では非対応を推奨（軽量性優先）。

### 5-5. ライフサイクルと破棄

- `effect` / `resource` の購読解除タイミング。web component の `disconnectedCallback` 連動が要る。
- `resource` の lazy（最初の `.get()` で起動）vs eager 起動。lazy 推奨だが事前接続ニーズとの折り合いは [[state-stream-type-design]] §4-1 と同論点。

### 5-6. SSR / hydration

- state は inline JSON / script から初期化する。signals 系の初期値供給経路（属性 / script / import）を決める。第1段は JS import 前提で割り切る案。

---

## 6. 意義の評価

- **「標準ファースト」の最も純度の高い実装**になりうる。TC39 提案に API を寄せ、ネイティブ実装が来たら polyfill を捨てられる構造は、wcstack の哲学の理想形。
- **IO ノードと反応性の分離をアーキテクチャレベルで実証**できる。同じ非同期IOノードが state 系と signals 系の両方を駆動する＝「IO はノード、状態はコア」が二系統で証明される。
- **客が違う**。state は HTML 宣言派、signals は JS-first 派。食い合わずパイを広げる。
- **リスクは2点に集中**: (a) signal 実体の哲学判断（§2）、(b) async resource の cancel/restart（§5-2）。後者は state-stream 案と共有なので、**合同で詰めれば二重コストにならない**。
- **過度な期待への釘**: 束縛 DSL を厚くすると state の劣化コピーになる。軽量・命令寄りに徹することが存在意義（§4）。

---

## 7. 推奨スコープと次段

- **厳格スコープ**: 「DSL 付きの第2の宣言的フレームワーク」ではなく「**signal（TC39互換・自前）+ 非同期IOノード resource アダプタ + effect 束縛**」に限定。宣言的束縛が欲しい客は state へ送る。
- **次段の選択肢**:
  1. 本 SPEC を詰める（特に §2 signal 実体の方針と §5-2 cancel/restart を、state-stream 案と合同で確定）。
  2. 最小 PoC: 自前極小 signal（state/computed/effect/watcher）+ `resource` を1本書き、既存 wcs-fetch を resource として食わせて DOM 更新まで通す。更新サイクル・abort・coalesce の実機挙動を検証してから SPEC を固める。
- core 新設ゆえ、PoC で「非同期IOノードが本当にアダプタ一枚で刺さるか」を最速で確かめるのが最大の不確実性潰し。

---

## 8. PoC 実装結果（2026-06-14）

`packages/signals/`（`@wcstack/signals` v0.0.0・未リリース）として最小実装。**最大の不確実性「非同期IOノードがアダプタ一枚で本当に刺さるか」（§3）を実証した。**

- **構成**:
  - `src/reactive.ts` — 自前極小 signal（`signal` / `computed` / `effect` / `flushSync`）。push-on-change / pull-on-read、遅延 computed、動的依存の再追跡、effect の microtask coalesce（§5-3）。zero-dependency（§2 案 C を地で実装）。
  - `src/resource.ts` — async producer を `{ value, loading, error }` triad に畳む。`args` 変化で **abort → 張り直し（switchMap）**、stale 応答の取りこぼし防止（§5-2 を成功・エラー両経路で実装）。
  - `src/bindNode.ts` — wc-bindable descriptor の properties をイベント購読で signal 化、inputs を `set`、commands を `command` に写す薄いアダプタ（§3）。
- **実証（最重要）**: `__tests__/integration.fetchCore.test.ts` が **無改変の実 `FetchCore`（packages/fetch）** を `bindNode` で食わせ、(1) 成功レスポンス → signal → `effect` で **DOM 更新まで到達**、(2) HTTP エラーが error/status signal に反映、(3) `resource` で FetchCore を包み args 変化で前リクエストを abort して張り直し、を確認。**FetchCore は背後が signal だと知らないまま動いた**＝「IO はノード、反応性はコア」の分離が実機で成立。
- **品質**: 39 テスト・カバレッジ 100/100/100/100。`npm run build`（tsc + rollup 3 出力）・`npm run lint` クリーン。
- **設計判断の更新**:
  - §2（signal 実体）— 自前極小実装は数百行で成立し、API を TC39 形に寄せられた。**案 C を支持する実証**。`computed` の値等価による伝播短絡は PoC では未実装（over-execution 許容）。第2段の検討事項。
  - §5-2（cancel/restart）— resource として成立。ただし FetchCore は外部 AbortSignal を受け取らず内部 `abort()` 依存なので、PoC では `sig→core.abort()` のブリッジを噛ませた。**ノード側に外部 signal 受け口があると素直**。state-stream 案と合同で詰める論点として残る。
  - §4（束縛層）— `effect` + signal 直接参照で DOM 更新まで十分通った。DSL 不要を実機で確認。さらに §4-1 の fine-grained `h` も実装（下記）。
- **§4-1 の fine-grained `h` も実装**: `src/dom.ts`（別エントリ `@wcstack/signals/dom`・package.json `./dom` export・rollup 2エントリ化）。`h(tag, props, ...children)` ＋ `Fragment` ＋ `render`。real DOM を一度生成し、関数/signal で渡された prop・child だけを `effect` で更新（VDOM/reconciler なし）。reactive children は anchor コメント方式で remove/insert（条件・リスト対応）。JSX は classic factory（`jsxFactory:"h"`）が乗る形だが**出荷しない**（`.tsx`・jsx-runtime 型なし）＝「手前でとどめる」を実装で表現。
  - **統合実証**: 実 FetchCore → `bindNode` の signal を `h` でそのまま DOM 構築（loading 切替の条件描画＋配列→`<li>` リスト描画）まで通した。signal / resource / bindNode / h が一気通貫。
- **(d) オーナーシップ/ライフサイクルを実装【解決済】**: 反応性コアに owner ツリーを追加（Solid モデル）。`effect` は自分の実行中に作られた子 effect/cleanup を**所有**し、再実行・dispose 時に LIFO で連鎖破棄する。`createRoot(fn)`（detached scope・dispose ハンドルを呼び元が保持）と `onCleanup(fn)` を公開。`h` 側は変更最小で恩恵を受ける：reactive child の effect がその subtree の prop/child effect を所有するため、**subtree 作り直しで前回の内側 effect が確実に dispose**（リーク解消を実機テストで確認）。イベントリスナも `onCleanup` で除去。アプリは `createRoot` 配下に mount し、`dispose()` で全反応を停止＝**custom element の disconnectedCallback 連動の土台**。owner と observer（依存追跡）は直交させたので tracking に影響なし。70 テスト 100/100/100/100。
- **(e) 実 Shell の connect/disconnect 接続を実装【解決済】**: `SignalsElement`（`@wcstack/signals/dom`・abstract base）。`connectedCallback` で `createRoot` 配下に `render()` を mount、`disconnectedCallback` で root を dispose ＋ mountPoint クリア。再接続で fresh に再 mount（signal インスタンスは保持）、二重 connect は no-op。これで**反応性ツリーが実 DOM ライフサイクルに接続**：`render()` 内で作った effect/resource/listener が要素の離脱時に全て破棄される。`resource` も `onCleanup` 連動にしたので owner 破棄で in-flight が abort。**フルスタック実証**: `SignalsElement` が connect で `resource`(実 FetchCore) を起動→`h` で loading/list 描画、`el.remove()` で root dispose→resource abort→`core.abort()`→fetch の AbortSignal が aborted、を確認。78 テスト 100/100/100/100。
- **(a) `streamResource` を実装【解決済】**: `src/streamResource.ts`。async iterable / ReadableStream / async generator を **fold して単一 signal に畳む**（latest 既定／reduce は `initial` 必須）。`args` 変化で abort→`initial` リセット→再起動（switchMap）、`signal.aborted` チェックで stale-drop を全経路（チャンク/完了/throw）に適用。status コンパニオン `"idle"|"active"|"done"|"error"` + error。ReadableStream は `Symbol.asyncIterator` 無しなら `getReader()` フォールバック。backpressure は放棄（fold 結果がバッファ）。`onCleanup` 連動で owner 破棄時に abort。9 テスト追加で 87 テスト 100/100/100/100。
  - **state `$streams` との合同検証**: これは [[state-stream-type-design]] の signals 版実装。PoC が state 案の未確定論点を確定した（restart=value を initial にリセット／error=直前 value 保持／fold 既定=latest／source=async iterable+getReader／status 形）。詳細は state-stream-type-design.md §8。残る state 固有の難所は「パス依存駆動 cancel/restart を proxy computed に乗せる」一点に収斂。
- **(c) computed 値等価の伝播短絡を実装【解決済】**: 反応性コアを push-dirty + lazy 再計算から **三色マーキング（CLEAN/CHECK/DIRTY・Reactively/Solid 系）**に置換。signal 書き込みは直接 observer を DIRTY、推移 observer を CHECK にし、`updateIfNecessary` が CHECK ノードを「computed ソースを先に refresh してから本当に変わったか検証」する pull-validate。**computed が同値に再計算されたら observer を DIRTY に上げない**ので下流 effect/computed が skip。computed にもカスタム `equals` を追加（初回計算は比較せず `_initialized` で保護）。effect 再実行が実際の値変化のみに連動するようになった（無駄実行の排除）。owner/coalesce/動的依存は不変。全既存テスト維持＋短絡テスト4件で 91 テスト 100/100/100/100。
- **(b) 実タグ + import map の example を作成【解決済】**: `examples/signals-live-search/`（index.html / server.js / README ja・en）。実 `<wcs-fetch>`（CDN `@wcstack/fetch/auto`）を `bindNode` で signal 化し、`query` signal→url 設定→自動 fetch→signal 畳み戻し→`h` でリスト描画。加えて `SignalsElement` 継承の `<signal-counter>` で純 signals＋ライフサイクルを提示。server が未公開 signals の dist を import map で配信。**packaging の発見**: 現状ビルドは index/dom 各エントリが reactive を内包する独立バンドルなので、**buildless で両エントリを混在 import すると reactive コアが二重化**（モジュールグローバル＝tracking context がバンドルごと）し反応性が壊れる。対策として `/dom` をブラウザ用スーパセット（コア再エクスポート）化し、example は単一エントリから import。**本番化には reactive を共有 chunk にする code-splitting が要る**（PoC は inline）＝新たな次段。
- **残る次段**: (f) 本番 packaging（rollup code-splitting で reactive を共有 chunk 化し、index/dom 混在でも単一コアにする）。PoC の機能コアは出揃った。

### 既知の挙動（v1 スコープ外・規範）

- **owner 破棄後の `computed` は stale を返す**。囲みスコープ（`createRoot`／親 effect）が破棄されると `computed` は sources から `untrack` され、以後は CLEAN かつ sources 空のため、ソース変化で再 dirty されず**最後の値を返し続ける**（Solid 系と同種の挙動）。破棄後に `computed` を参照する使い方は**未定義動作**とし、v1 では救済しない。破棄したスコープの signal を読み続けたい場合は、その signal を別スコープで保持すること。

---

## 9. PoC → 本実装 移行の作業洗い出し（2026-06-16）

PoC の機能コア（reactive / resource / streamResource / bindNode / h / SignalsElement）は出揃っている。ここから「未リリースの PoC」を「出荷できる本実装」にするために必要な作業を、優先度順（**P0 ブロッカー → P1 機能欠落 → P2 仕上げ**）で棚卸しする。

### 9-1. P0 — 出荷ブロッカー

#### (1) packaging: reactive コアの二重化解消【唯一の本質ブロッカー・§8 (f)】
現状 `rollup.config.js` は `index` と `dom` を**各々独立バンドル**として出力し、両方が `reactive.ts` をインライン内包する。buildless（import map）で両エントリを混在 import すると **tracking context（モジュールグローバル）がバンドルごとに別個**になり反応性が壊れる。

- 現状の回避は「`/dom` をコア再エクスポートのスーパセットにし、example は単一エントリ import」という**運用回避**にすぎない。
- 本番化には rollup の **code-splitting（`manualChunks` / 共有 chunk、または `preserveModules`）** で `reactive` を単一 chunk に切り出し、`index` / `dom` どちらを混在 import しても**単一コア**に解決する構成が必須。
- 併せて `dom` エントリに `.esm.min.js` 出力が無い（index のみ min 生成）→ 出力の対称性も要修正。

#### (2) バージョン・リリース整備
- `package.json` の `version: "0.0.0"` / `description`（"PoC"）を更新。[[feedback_version_alignment]] に従い state/fetch/autoloader/router と**同一バージョンに揃える**。
- ルート README への追加（既存パッケージは列挙済み・signals は未掲載）。

### 9-2. P1 — 機能欠落（PoC で「手前でとどめた」部分）

#### (3) bindNode が wc-bindable の3サーフェスを全部は写していない
`bindNode.ts` は **properties（latest スナップショット）+ inputs(`set`) + commands(`command`)** のみ。§3-1 の表に対して欠けているもの:
- **event-token（繰り返し通知）→ fold した stream signal**（§3-1 第2行）。現状は全プロパティを「最新値スナップショット」扱いで、per-emit を畳む経路が無い。`streamResource` はあるが bindNode から event-token を stream に繋ぐ糊が未実装。
- **signal → element property への writeback effect**（§3-2「signal を購読し変化を property へ反映」）。現状は命令的 `set()` のみで、双方向の same-value ガード付き自動反映が無い。
- **command-token（値変化 → emit）**（§3-1 第3行）。現状は命令的 `command()` のみ。
- 記述子の型を**独自再宣言**（`WcBindableDescriptor`）しており、実体の `IWcBindable`（`protocol` / `version` / `async` / `attribute` を持つ）と**ドリフトする恐れ**。共有プロトコル型を import する形が望ましい。

#### (4) resource の cancel/restart と実ノードの繋ぎ【§5-2・残論点】
FetchCore は**外部 AbortSignal を受け取らず内部 `abort()` 依存**のため、PoC では `sig → core.abort()` のブリッジを噛ませた。本番では「resource + bindNode で IO ノードを cancel する標準パターン」（command `abort` 経由のブリッジ）を確定・一般化する。[[state-stream-type-design]] と合同で詰める。

#### (5) DOM 層 (h) の本番ハードニング
`dom.ts` の `setProp` 自身がコメントで PoC 制約を列挙:
- 属性⇄プロパティ名のリマップ無し（`for`→`htmlFor`, `colspan`→`colSpan`）。
- read-only プロパティへの代入ガード無し（`key in el` が `firstChild` 等にも真）。
- SVG 名前空間（`createElementNS`）非対応。
- **reactive children のリスト描画が naive な全削除→全挿入**（`insertReactive`）→ **9-3 のキー付きリストで解消**。

### 9-3. リストとキー付き reconciliation の設計（For / Index）★

P1 (5) のうちリスト描画は独立論点として切り出す。現状 `insertReactive` は配列が変わるたび「全削除 → 全挿入」で、1要素の変化でも全行 DOM を作り直し、行内 effect も全 dispose する。本番のライブリストには **keyed reconciliation** が要る。

**結論: 実装可能。最難所は PoC で解決済み。**

- キー付きリストの本質的難所は「**行ごとのリアクティブスコープを正しく破棄すること**」。これは owner ツリー（`createRoot` / `onCleanup` / `disposeOwned`・§8 (d)）で**既に解決済み**。行削除でその行内の effect / resource / listener が LIFO 連鎖破棄される基盤がある。
- 残りは「配列 diff → DOM 最小操作」のみ＝枯れたアルゴリズム（Solid の `mapArray` / `reconcileArrays` 相当）。

**Solid 流に2ヘルパを出す:**

| ヘルパ | キー | 行の再生成 | 用途 |
|---|---|---|---|
| **`For`** | 値の同一性（`===` 既定 / 明示 `key` 関数） | add / move / remove のみ。中身変化では作り直さない | オブジェクト配列（主役・推奨） |
| **`Index`** | 位置（添字） | 配列長が変わった時のみ。行には item を **signal** で渡す | プリミティブ配列・位置が安定 |

使用イメージ:
```js
h('ul', null,
  For(() => items.get(), (item) =>
    h('li', null, () => item.name)   // 行は一度だけ生成、item.name 変化は fine-grained 更新
  )
)
```

**実装の中身（約150〜250行 + テスト・新規依存ゼロ）:**

1. **アンカー方式を流用** — 既存の anchor コメントで領域を確保（`insertReactive` と同じ位置決め）。
2. **行ごとに `createRoot`** — 各行を独立 owner 配下で生成。行が消えたらその root を dispose → 行内 effect が確実に死ぬ。
3. **reconcile** — 旧 `key → {node, dispose}` の Map を持ち、新配列を走査して: マッチ→ノード再利用 / 新規→`createRoot` で行生成 / 消滅→root dispose + ノード除去 / 並び替え→`insertBefore` で最小移動（初期は素朴な順次 insert、後で two-ended / LIS 最適化）。
4. **キー戦略** — 既定は値の `===`（[state の createListDiff](../packages/state/src/list/createListDiff.ts) も `===` ベース・重複値は添字配列で吸収という発想）。`key` オプションで明示も可。

**state の `createListDiff` は流用しない。** 同関数は `IListIndex` / `loopContext` / パスアドレッシング / 配列参照キーの WeakMap キャッシュに密結合で、signals の cell ベース fine-grained モデルに乗らない。**アルゴリズムの考え方（indexByValue で重複値を添字配列管理、add/delete/change の集合化）だけ参考にし、signals 専用に書き起こす**。

**着手順の推奨:** `For`（keyed・実用主役）から1本通し、テスト + example（[signals-live-search](../examples/signals-live-search) のリスト描画を keyed 化）まで持っていく。その後 `Index`。

### 9-4. P2 — 仕上げ・確定

- **(6) 公開 API の確定（TC39 整合）**: §1 サンプルは `state(0)` 表記、実装は `signal()`。最終公開名を確定（TC39 は `Signal.State` / `Signal.Computed`）。`batch()`（明示バッチ）/ `untrack()` の公開可否、ライブラリ統合用 `Watcher` 相当を出すか。
- **(7) テスト増強**: 91 テスト 100/100/100/100 だが、**dual-entry 単一コア検証（packaging）・event-token fold・signal→property writeback・SVG・属性名リマップ・For/Index reconcile** の追加が要る。`streamResource` には example が無い。
- **(8) ドキュメント確定**: 本書は冒頭が「設計検討中」のまま → 設計判断が出揃ったので **SPEC へ昇格**（他パッケージは SPEC.md 体裁）。README ja/en の本番化。v1 スコープ外を README に正直に明記（**SSR/hydration §5-6・深い反応性 proxy §5-4・backpressure・AsyncIterable 非協調 cancel のパーク leak**）。

### 9-5. 着手順サマリ

| 優先 | 項目 | 理由 |
|---|---|---|
| **P0-1** | rollup code-splitting で reactive 共有 chunk 化 | 唯一の本質ブロッカー。buildless で壊れる |
| **P0-2** | version 揃え + ルート README + description | リリース体裁 |
| **P1-3** | bindNode に event-token / writeback / 共有型 | プロトコル3サーフェス完成＝存在価値 |
| **P1-4** | resource×ノード cancel パターン確定 | §5-2 唯一の未確定論点 |
| **P1-5 / 9-3** | h の prop 正規化・**For/Index キー付きリスト** | 実アプリ耐性。owner は済んでおり diff のみ |
| **P2** | API 確定 / テスト増 / SPEC 昇格 | 仕上げ |

残る二大ピースは **「packaging の本番化」** と **「bindNode のプロトコル完全対応」**。リスト/キーは owner 基盤が済んでいるため diff 実装のみで到達できる。

---

## 関連

- [[state-stream-type-design]] — async fold / 依存駆動 cancel-restart / stream 境界規約を共有。本案の `resource` / `streamResource` は同案の signals 版。**合同で詰める対象**。
- [[watch-hook-design]] — state → 監視（outward）。signals 系では effect がその役を一部担う。境界整理が要る。
- [[command-token-protocol]] / [[event-token-protocol]] — 非同期IOノードとの相互運用（§3）の土台。signal アダプタはこの3サーフェスを signal にマップする。
- wc-bindable protocol — IO ノードが背後の反応性実装に非依存である根拠。本案成立の前提。
