# 実行計画: `@wcstack/signals` PoC → 本実装 移行

- **状態**: 計画（2026-06-16 策定・未着手）。
- **対象**: `packages/signals`（v0.0.0・未リリース PoC）を出荷可能な本実装へ移行する。
- **入力**: [signals-state-design.md](signals-state-design.md) §8（PoC 結果）/ §9（作業洗い出し）。本書は §9 を**順序・依存・受け入れ基準のある実行計画**に落としたもの。
- **全体の Definition of Done（全フェーズ共通の不変条件）**:
  - `npm run build`（tsc + rollup）green、`npm run lint` クリーン。
  - `npm run test:coverage` がモノレポ閾値 **100 / 97 / 100 / 100** を維持。
  - 新規 runtime 依存ゼロ（zero-dependency 原則）。
  - 各フェーズは独立に green でマージできる単位に保つ。

---

## 0. 全体方針

### フェーズ構成と依存

```
[G] 決定ゲート（着手前に確定）
      └─ API 命名 / protocol 型の置き場 / For のキー既定

Phase 1  packaging 本番化  ★土台・最優先
   │     （code-splitting で reactive 単一コア化）
   ├──────────────┬──────────────┐
Phase 2          Phase 3         （Phase 0 リリース基盤は随時並行可）
bindNode          h ハードニング
3サーフェス        + For / Index
   │                 │
Phase 4            （Phase 3 内 example keyed 化）
resource×ノード
cancel 確定
   └──────────────┘
              │
        Phase 5  仕上げ（SPEC / README / テスト網羅 / リリース）
```

- **Phase 1 を最初に**: ビルド出力の構造を変えるため、以降の example / テストを**本番 packaging 上で**検証したい。土台を先に固める。
- **Phase 2 と Phase 3 は Phase 1 後にほぼ独立で並行可**。
- **Phase 4 は Phase 2（command-token）に乗る**。
- **Phase 0（リリース基盤）は他と独立**、いつでも差し込める。
- 工数感は S（〜0.5d）/ M（〜1–2d）/ L（〜3d+）の相対表記。

### 着手前に確定すべき決定ゲート [G]

| # | 論点 | 選択肢 | 決定 |
|---|---|---|---|
| G1 | 公開 API 命名 | `signal()` 維持 / `state()`（TC39 `Signal.State` 寄せ） | **【確定 2026-06-16】`signal()` 維持**。`state` は `@wcstack/state` と概念衝突。リネームは全面波及するので早期確定 |
| G2 | wc-bindable protocol 型の置き場 | signals が独自宣言を維持（構造互換をテスト保証）/ protocol を共有パッケージへ切り出し | **【確定 2026-06-16】独自宣言維持**。共有パッケージ化は大仕事＝別 RFC。当面は「`IWcBindable` のスーパーセット互換」をテストで担保 |
| G3 | `For` のキー既定 | 値の `===` 既定（明示 `key` で上書き）/ `key` 必須 | （暫定）**`===` 既定 + 明示 `key` 可**。Solid 流。プリミティブ配列は `Index` へ誘導。Phase 3 までに確定 |
| G4 | `batch()` / `untrack()` / `Watcher` 相当の公開 | 出す / 出さない | （暫定）`untrack` は出す、`batch` は coalesce があるので保留、`Watcher` は v1 非公開。Phase 5 までに確定 |

G1・G2 は**確定**（後戻りコスト大のため先行決定）。G3・G4 は暫定で、Phase 3 / Phase 5 までに確定。

---

## Phase 0 — リリース基盤整備（独立・随時並行）【S】【完了 2026-06-16】

> 実績: `version` を `0.0.0` → **`1.13.1`**（当時の現行リリースライン。現行は `1.15.0`）に、`description` から "PoC" を除去。`exports`（`.` / `./dom`）は据え置き。ルート README 追加は機能確定後（Phase 5）に回す。

- **スコープ**: `package.json` の `version` を [[feedback_version_alignment]] に従い state/fetch/autoloader/router と同一に揃える。`description` を "PoC" 文言から本実装表現へ更新。`exports` マップの最終確認。
- **成果物**: 更新済み `package.json`。ルート README への signals 追加（**ただし機能が固まる Phase 5 で最終文言確定**するため、ここでは枠だけ or Phase 5 に回す）。
- **受け入れ基準**: バージョンが他パッケージと一致。`npm publish --dry-run` 相当で files/exports に齟齬なし。
- **依存**: なし。
- **リスク**: 低。

---

## Phase 1 — packaging 本番化（reactive 単一コア化）★【M】【完了 2026-06-16】

> 実績: `rollup.config.js` を `index`/`dom` 単一 multi-input（`input:{index,dom}` + `output.dir`）に統合し、`manualChunks` で core 4 モジュールを共有 `core-*.esm.js` chunk に切り出し。min も対称化（`dom.esm.min.js` を出力）。両エントリが**同一 core chunk を参照**することを静的＋挙動の回帰テスト（`__tests__/packaging.test.ts`）で保証。example の import map を両エントリに戻し、server を `/signals/` 汎用配信化（hash 付き chunk 解決・traversal ガード）。混在 import の単一コアをサーバ経由で実機確認。

唯一の本質ブロッカー。現状を出荷すると buildless 混在 import で反応性が壊れる。

- **根本原因**: 現 `rollup.config.js` は `index` と `dom` を**別々の config オブジェクト**として出力するため、各バンドルが `reactive.ts` を独立にインライン内包する。モジュールグローバル（`currentObserver` / `currentOwner` / `pendingEffects` 等の tracking context）がバンドルごとに別個になり、`@wcstack/signals` と `@wcstack/signals/dom` を同一ページで混在 import すると signal の依存追跡が分断される。
- **対策**: `index` と `dom` を**単一ビルドの multi-input** に統合し（`input: { index: 'src/exports.ts', dom: 'src/dom.ts' }` + `output.dir`）、rollup に共有モジュール（`reactive` 他）を**共有 chunk として自動切り出し**させる。これで両エントリが単一 reactive コアを参照する。
  - min ビルドも同形で `output.dir` + terser、`dom` の `.min` 欠落を解消（出力対称化）。
  - `.d.ts` は dts プラグインで従来どおりエントリ別生成（型は二重化問題が無いので現状維持で可）。
  - buildless 検証: 共有 chunk が import map / 相対パスで解決できることを確認（chunk ファイル名・参照の相対性）。
- **成果物**: 改修 `rollup.config.js`、`dist/` の新出力構成、packaging 回帰テスト。
- **受け入れ基準**:
  - `@wcstack/signals` と `@wcstack/signals/dom` を**両方 import**し、一方で作った signal を他方の `effect` / `h` で購読 → DOM が更新される（= 単一コア）ことをテストで保証。
  - `examples/signals-live-search` を「単一エントリ回避」から**本来の混在 import**に戻して動作。
    - ※後日追記（2026-07-09）: パッケージ公開後、example は CDN（esm.run）ロードに切替。CDN では各エントリが自己完結バンドルになり混在 import はコア二重化を招くため、example は再び単一 `/dom` エントリ import に戻した（ローカル npm インストールでは共有 chunk により混在 import 可のまま。受け入れ基準の担保はパッケージング回帰テスト側で継続）。
  - `dist` に index/dom 双方の min が出力される。
- **依存**: なし（最初に着手）。
- **リスク**: 中。buildless（import map）での chunk 解決が肝。example を実ブラウザ相当（happy-dom + server.js）で通すこと。

---

## Phase 2 — bindNode プロトコル3サーフェス完全対応【M〜L】【完了 2026-06-16】

> 実績: `bindNode` に3メソッドを追加。**`on(prop, {fold,initial})`**＝event-token stream（`equals:()=>false` で per-emit 通知・既定 fold=latest・reduce 可）、**`bindInput(name, signal)`**＝signal→property writeback（`node[name]!==v` same-value ガードで write→event→write ループ遮断・返り値/`dispose` 両方で解除）、**`bindCommand(name, trigger, mapArgs?)`**＝command-token（trigger 変化で emit・初期値は primed で非発火・関数チェックは bind 時 fail-fast）。型互換は `bindNode.compat.test.ts` が実 `FetchCore.wcBindable`（`IWcBindable`）を `satisfies` で食わせて担保（G2 のドリフト防止）。`EventStreamOptions` 公開。テスト170件 100/100/100/100。

`bindNode` を properties latest スナップショットのみから、wc-bindable の全サーフェスへ拡張。

- **スコープ**:
  1. **event-token → stream signal**: per-emit 通知を `streamResource` の fold に繋ぐアダプタ（latest 既定 / reduce 可）。
  2. **signal → property writeback**: signal を購読し変化を node property へ反映する effect。双方向ループ防止は same-value ガード（[[notification-tag-design]] 等で実証済みの規範を継承）。
  3. **command-token（値変化 → emit）**: signal の値変化で command を起動する経路（Phase 4 と接続）。
  4. **型整合（G2）**: `WcBindableDescriptor` が実体 `IWcBindable`（`protocol` / `version` / `async` / `attribute` 付き）の**スーパーセット互換**であることをテストで保証。独自宣言は維持。
- **成果物**: 拡張 `bindNode.ts`、各サーフェスのユニットテスト、実 `FetchCore` での統合テスト更新。
- **受け入れ基準**:
  - event-token を持つ実ノードを bindNode → stream signal に畳めること。
  - signal → property の双方向で無限ループしない（same-value ガード）。
  - 実 `FetchCore.wcBindable`（properties/inputs/commands）が型エラーなく食えること（互換テスト）。
- **依存**: Phase 1（本番 packaging 上でテスト）。
- **リスク**: 中。双方向 writeback のループ・タイミング（coalesce との相互作用）。

---

## Phase 3 — h ハードニング + For / Index【M〜L】【完了 2026-06-16】

> 実績（3a）: 属性→プロパティ名リマップ表（`for`→`htmlFor` 等8件）、descriptor ベースの settable 判定（read-only な `firstChild` 等を `setAttribute` へ退避・own データプロパティも対応）、SVG 名前空間生成（`createElementNS`・曖昧タグ除外）。`__tests__/dom.hardening.test.ts` 10件。
> 実績（3b）: `For`（値/明示キー・行ごと `createRoot`・back-to-front 最小移動・index アクセサ・重複キー throw）と `Index`（位置キー・item アクセサ・grow/shrink）を `@wcstack/signals/dom` に追加。`onCleanup` で囲みスコープ破棄時に全行 dispose。`__tests__/list.test.ts` 17件。example のリスト描画を keyed `For`（key=id）化。
> ゲート: 152 テスト・カバレッジ **100/100/100/100**・build/lint クリーン。G3 を「`===` 既定＋明示 `key`」で確定。

### 3a. `setProp` ハードニング【S〜M】
- 属性⇄プロパティ名のリマップ（`for`→`htmlFor`, `colspan`→`colSpan` 等の最小表）。
- read-only プロパティ代入ガード（`key in el` が `firstChild` 等にも真な問題）。
- SVG 名前空間対応（`createElementNS`）。
- **受け入れ基準**: 各ケースの回帰テスト。既存挙動を壊さない。

### 3b. キー付きリスト `For` / `Index`【M〜L・§9-3】
最難所（行ごとスコープ破棄）は owner ツリーで解決済み。残りは diff のみ。

- **`For`（keyed・主役）**: 値の同一性（`===` 既定 / 明示 `key` 関数）。行は add / move / remove のみ再生成、中身変化では作り直さない。行ごとに `createRoot` で生成し、削除時に root dispose → 行内 effect 連鎖破棄。
- **`Index`（添字 key）**: 配列長変化時のみ行再生成。行に item を **signal** で渡す（プリミティブ配列向け）。
- **reconcile**: 旧 `key → {node, dispose}` Map を保持し、新配列走査で マッチ→再利用 / 新規→`createRoot` / 消滅→dispose+除去 / 並び替え→`insertBefore` 最小移動（初期は素朴な順次 insert、後で two-ended / LIS 最適化）。
- **既存 `insertReactive`** はスカラ reactive child 用に残し、配列は `For`/`Index` に誘導。
- **state の `createListDiff` は流用しない**（`IListIndex` / `loopContext` / パスアドレッシング密結合）。発想（indexByValue で重複値を添字配列管理）のみ借用。
- **成果物**: `For` / `Index`（`@wcstack/signals/dom`）、reconcile ユニットテスト（add/move/remove/重複キー/空配列）、`signals-live-search` のリスト描画を keyed 化した example 更新。
- **受け入れ基準**: 並び替え時に行 DOM が再生成されず移動のみ（ノード同一性をテストで確認）。削除行の effect が dispose される。
- **依存**: Phase 1。3a と 3b は並行可。
- **着手順**: `For` → example keyed 化 → `Index`。
- **リスク**: 中。重複キー・移動最小化の正しさ。まず正しさ優先（素朴 insert）、最適化は後。

---

## Phase 4 — resource × ノード cancel パターン確定【M・§5-2】【完了 2026-06-16】

> 実績: **`nodeSource(bound, run, {abort?})`** を追加。`resource` の source を生成し、AbortSignal を `once` リスナでノードの abort コマンド（既定 `"abort"`）へ橋渡してから `run` に委譲。PoC の手書き `sig→core.abort()`（特定ノード密結合）を**任意の wc-bindable ノード向けに一般化**。実 `FetchCore` で「args 変化→前リクエスト abort→ノードの AbortSignal aborted」を `nodeSource`+`resource` 経由で確認（integration テスト）。ノード自身の value/loading/error は `bound.signals` のまま。FetchCore.abort は idle 時 no-op で switchMap 初回も安全。テスト173件 100/100/100/100。

- **スコープ**: `FetchCore` が外部 AbortSignal を受けず内部 `abort()` 依存である現実に対し、「resource + bindNode で IO ノードを cancel する標準パターン」を確定・一般化（command `abort` 経由のブリッジを Phase 2 の command-token 経路に乗せる）。
- **成果物**: cancel ブリッジのヘルパ/規約、resource×実ノードの restart/abort 統合テスト、docs への規範追記。[[state-stream-type-design]] と合同。
- **受け入れ基準**: args 変化 → 前リクエスト abort → 実ノードの AbortSignal が aborted、を実 `FetchCore` で確認（PoC のブリッジを一般化した形で）。
- **依存**: Phase 2（command-token）。
- **リスク**: 中。state-stream 案との規範一致。

---

## Phase 5 — 仕上げ・確定・リリース【M】【1–3 完了 2026-06-16・4 publish のみ残】

> 実績（1–3）: **SPEC 昇格**＝[signals-state-design.md](signals-state-design.md) の状態を「設計検討中＋PoC」→「実装完了（v1.13.1・Phase 0–4 完了）」に確定。**README 本番化（ja/en）**＝PoC バナー除去、新 API（`For`/`Index`/`on`/`bindInput`/`bindCommand`/`nodeSource`）を Quick start・API リファレンスへ追加、**Phase 1/3 で偽になった2記述を訂正**（旧「buildless 単一エントリ規則」→「両エントリは共有 core chunk なので混在 import で単一コア」、旧「reactive children 丸ごと再生成・keyed なし」→ `For`/`Index` へ誘導）、`setProp` ハードニング反映、v1 スコープ外を明記、カバレッジ閾値表記 100/100/100/100。**ルート README**＝signals を Additional Packages に追加し "Twenty-two"→"Twenty-three"。最終ゲート 173 テスト・100/100/100/100・build/lint green。
>
> 残（4）: **`npm publish`**（outward-facing・要明示確認）。`SPEC.md` という別ファイル体裁は本リポジトリに前例が無いため、設計ドキュメントの確定化＋README で代替（独立 SPEC.md は作成せず）。

- **API 確定（G1/G4）**: 公開名・`untrack`/`batch`/`Watcher` の最終決定を反映。
- **SPEC 昇格**: [signals-state-design.md](signals-state-design.md) の「設計検討中」を解消し、他パッケージ同様 `SPEC.md` 体裁へ。確定した規範（cancel/restart, fold, キー戦略, same-value ガード）を規範言語で明文化。
- **README 本番化（ja/en）**: 使い方 + **v1 スコープ外を正直に明記**（SSR/hydration §5-6・深い反応性 proxy §5-4・backpressure・AsyncIterable 非協調 cancel のパーク leak）。ルート README に signals 追加。
- **テスト網羅**: dual-entry 単一コア / event-token fold / writeback / SVG / 属性名リマップ / For・Index reconcile。`streamResource` の example 追加。
- **リリース**: Phase 0 のバージョンで公開（`npm publish`）。
- **受け入れ基準**: SPEC・README・テスト網羅が揃い、`publish --dry-run` クリーン。
- **依存**: Phase 1〜4 完了。

---

## マイルストーン・サマリ

| MS | 内容 | 含むフェーズ | 出口条件 |
|---|---|---|---|
| **M1** | 本番 packaging | Phase 1 (+ Phase 0) | 混在 import で単一コア。example が本来 import で動作 |
| **M2** | プロトコル完全対応 | Phase 2 + Phase 4 | bindNode 3サーフェス + ノード cancel が実ノードで成立 |
| **M3** | UI 実用化 | Phase 3 | h ハードニング + For/Index keyed リスト |
| **M4** | 出荷 | Phase 5 | SPEC/README/テスト網羅・リリース |

推奨進行: **G（決定）→ M1 → (M2 ∥ M3) → M4**。M2 と M3 は並行可能。

---

## 関連

- [[signals-state-design]] — §8 PoC 結果 / §9 作業洗い出し。本計画の入力。
- [[state-stream-type-design]] — resource/streamResource の cancel/restart 規範を合同で確定（Phase 4）。
- [[feedback_version_alignment]] — Phase 0 のバージョン揃え方針。
