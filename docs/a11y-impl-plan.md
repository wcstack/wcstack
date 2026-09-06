# 実装計画: アクセシビリティ

- **状態**: **2026-08-28 全 Phase 実施完了**（Phase 0=PR #195 / 1=#196 / 2=#197 / 3=#198 / 4=#199 / 5=#200 / 6=#201 / 7=#202・docs=#194。すべて main へマージ済み）。同日アーキテクチャレビュー反映（T0-4 fallback 強制 e2e の追加・後半節番号の振り直し）。設計の正本は [a11y-design.md](./a11y-design.md)（以下「設計書」）。本書はその §11 を着手可能なタスク粒度・検証項目・DoD に展開した手順書。D1 / D2 / D6 は 2026-08-28 に推奨案どおり裁定済み。残タスクは「リリース時の作業」（ユーザー操作）のみ。
- **実施時に判明した実態差 2 件**: (a) websocket-chat react/vue の dist は**未追跡（完全 gitignore）** — リスク 7 の「追跡済み配信実体」前提は現状と不一致で、再ビルドしてもコミット対象なし（ソース修正のみコミット）。(b) state-notification-chat に「メッセージリスト」は実在しない — `role="log"` は唯一のページ内活動フィードである status 行に付けた（設計意図＝通知非依存のページ内告知はこれで満たされる）。
- **ブランチ**: Phase ごとに `--no-track` で切る（例: `fix/router-scroll-a11y`, `improve/state-move-before`）。コミットは `git commit -F`。
- **作業ディレクトリ**: Phase 0/1/3 = `packages/router/`、Phase 2 = `packages/state/` + `e2e/`、Phase 4 = `packages/raf/`、Phase 5 = `examples/` + `packages/state/examples/`、Phase 6 = `packages/vscode-wcs/` + `packages/lint/`、Phase 7 = docs と各 README。
- **新規パッケージ**: **作らない**（設計書 D8）。

---

## 0. 全体方針

### 0-1. 進め方と DoD（共通）

- **Phase 単位でコミット**する。各 Phase の共通 DoD:
  1. `npm test` green（既存テスト含む）
  2. `npm run test:coverage` の閾値維持（100/97/100/100 baseline）
  3. `npm run lint` pass
  4. `npm run build` が通る（**dist を生成したら戻してからコミット**）
- テストは実装と同時に書く。記述は日本語。
- e2e を触る Phase は「src 変更 → 該当パッケージ `npm run build` → `cd e2e && npm test`」の順を厳守（e2e はワーキングツリーの dist を見る）。
- 受け入れ条件は §8 のマトリクス（A1–A14）を正とし、各タスクに ID を付す。

### 0-2. 検証で確定している前提（計画の土台・全て file:line 裏取り済み）

- Navigation API 経路は intercept 仕様既定で scroll / focusReset とも既に正しい。**修理対象はフォールバック経路のみ**。
- `applyRoute` は `Promise<void>` で guard 拒否が呼び出し側から見えない（`applyRoute.ts:44`）。
- 接続済みノードの物理移動は全リポジトリで `createContent.ts:105` の 1 文のみ。同文は 4 つのノード状態を共有するため per-node ガード必須。
- happy-dom 20.3.7 に `moveBefore` は無い（新分岐は vitest で到達不能 → スタブ必須）。
- transition-runner の promise は **mutate 適用時**に解決する（アニメーション完了ではない）。
- `<wcs-head>` の title 差し替えは mutate() 内で同期完了し、commit 時点の `document.title` は新ルートの値（静的 title）。
- e2e は Chromium 単一（`e2e/playwright.config.ts:17`）。

---

## Phase 0 — 契約の明文化（挙動変更ゼロ・`packages/router/`）

### タスク

- **T0-1**: `NavigateEventLike`（`Router.ts:12-18`）に `scroll` / `focusReset` オプションを追加し、`intercept` 呼び出し（`Router.ts:235`）に仕様既定 `"after-transition"` を明示 + 設計書 §3-1 の趣旨コメント。
- **T0-2**: `packages/router/README.md` / `README.ja.md` に「Accessibility contract」節 — Navigation API 委譲とフォールバック経路の挙動を明文化。
- **T0-3**: e2e 回帰 spec（`e2e/tests/router-a11y.spec.ts` 新設）: リンク遷移後に `window.scrollY === 0` と `document.activeElement` リセットを assert（Chromium = Navigation API 経路の既定挙動の固定）。
- **T0-4**: **フォールバック強制手法の成立確認** — `addInitScript` で `window.navigation` を undefined 化（`Object.defineProperty(window, 'navigation', { value: undefined })`）した context を同 spec 内に用意し、click 遷移が pushState 経路（`wcs-link` の click ハンドラ）を踏むことを assert（`getNavigation()` は毎回 `window.navigation` を動的参照 — `Navigation.ts:19-20`）。成立すれば Phase 1 の A3 を実ブラウザで固定できる。不成立なら §9 リスク 1 の WebKit 検討に戻す。

### 検証項目

- `__tests__` の mock intercept が余分キーで壊れないこと。
- 既存 e2e green のまま（挙動変更ゼロの証明）。

### DoD

共通 DoD + T0-3 / T0-4 の spec が green。**この Phase はどの裁定にも依存しない**。

---

## Phase 1 — router の修理（既定オン・`packages/router/`）

### タスク

- **T1-1**: `applyRoute` を `Promise<boolean>`（committed）に変更 — `applyRoute.ts:44` を `return false`、`:47` の後に `return true`。呼び出し 3 箇所（navigate else 分岐 / `_onNavigateFunc` handler / `_onPopState`）の型を追随（戻り値を使うのは T1-2 のみ）。
- **T1-2**: `Router.navigate()` else 分岐（`Router.ts:208` の後）: `committed === true` のときだけ `window.scrollTo(0, 0)`。**`_onPopState` は触らない**（native scroll restoration が正解）— 「popstate で scroll しない」ことを固定する unit テストを追加。T0-4 の fallback 強制手法で「push 後 scrollY=0・popstate では scroll しない」（A3）を **e2e でも**固定する。
- **T1-3**: `aria-current="page"` — `Link.ts:179` に `setAttribute`、`:181` に `removeAttribute`。テストは `Link.test.ts:308-343` / `794-874` の既存パターン（location defineProperty mock / `anchorElement` getter / `_updateActiveState` 直接呼び）を流用し assert を `getAttribute("aria-current")` に。
- **T1-4**: `<wcs-link>` 属性転送 — anchor 生成時（`Link.ts:102-106` 間）に `aria-` prefix + 固定 5 名（`title`/`rel`/`target`/`download`/`hreflang`）を一括コピー（`to`/`style`/`class` 除外）。固定 5 名を `observedAttributes`（`:11`）に追加し `attributeChangedCallback`（`:161-169`）にミラー分岐（null ガード維持 — upgrade 前発火で落ちないこと）。
- **T1-5**: README（`:289-302` の Link 節）に aria-current・転送許可リスト・「動的 aria-* は追従しない」制限（**data-wcs バインド経由も生成 anchor に届かない**具体例つき — 設計書 §5）・「Navigation API 環境では素の `<a>` も動く（条件 2 つ）」を明記。

### 検証項目

- guard 拒否時に scroll しない（GuardCancel → fallback 再ナビの経路で `scrollTo` が呼ばれない spy テスト）。
- 転送コピーで `style`/`class` が漏れない（ホストの `display:none` が anchor に乗ったら即死のため必須ケース）。

### DoD

共通 DoD + 上記検証。**追随**: wcstack-skill（router 挙動・wcs-link 属性の変更に該当 → §10）。

---

## Phase 2 — state `moveBefore`（`packages/state/` + `e2e/`）

### タスク

- **T2-1**: `createContent.ts:105` を設計書 §4-1 のガード付き分岐に。`markObserverSkipOnAdd`（`:104`）は両分岐の前で維持。ガードの理由（4 状態共有・throw 条件）をコメントで残す。
- **T2-2**: unit — コンテナに `moveBefore` スタブ（insertBefore 委譲 + 記録）を立てて新分岐をカバー。`list.stableListOrder.test.ts:339` の spy を **moveBefore 込みの合算 ≤2** に拡張。
- **T2-3**: e2e — 新 spec + fixture: リスト行内の `<input>` にフォーカス → keyed swap → `document.activeElement` 同一性と入力値維持を assert（Chromium 133+ は moveBefore 実装済み）。
- **T2-4**: `e2e/bench/jsfb-verify.mjs` を再実行し、keyed-swap 検出（mutation record 依存）と swap 数値が変わらないことを確認。数値が動いたら bench コメント（`:8`）を実態に合わせる。
- **T2-5**: view-transition 相互作用 — autoNaming 行 + 進行中 VT + moveBefore の組で `e2e/tests/view-transition.spec.ts` green を確認。

### DoD

共通 DoD + T2-3 の activeElement assert green + T2-4 の数値記録。**追随**: 構文・プロトコル変更なし → skill 追随不要（明示判定）。

---

## Phase 3 — `focus=` / `announce=`（D1/D2 裁定済み・`packages/router/`）

### タスク

- **T3-1**: live region — `Router._initialize` で `<wcs-router>` 直下に空の `role="status"` 要素を sr-only クリップ（`display:none` 禁止）で生成、`disconnectedCallback` で撤去。
- **T3-2**: `announce="title"` — `applyRoute` の committed 判定直後（mutate の外）で `region.textContent = document.title`。初回描画（`lastRoutes.length === 0`）はスキップ。マルチ router は自分の commit のみ。
- **T3-3**: `focus="heading"` — 同地点で**リーフ route が挿入した内容**の最初の `h1`〜`h6` に `tabindex="-1"` + `focus()`（探索範囲と「見出し不在時は何もしない」は設計書 §3-4 の規定どおり。不在時のテストも追加）。初回スキップ。**`focus=` 指定時のみ** intercept に `focusReset: "manual"` を渡す（二重処理防止・検証済み）。
- **T3-4**: `docs/timing-and-firing-contract.md` に「route commit 後のフォーカス・告知」節を追加（同書 §6 の保守規約に従う）。§4-3 のフレーム着地（view-transition 下で drain がフレームに遅れる）と矛盾しない文面にする。
- **T3-5**: テスト — unit（属性なしで region が空のまま / guard 拒否で不変 / 初回スキップ）+ e2e（遷移後の region テキスト・heading フォーカス）。

### DoD

共通 DoD + T3-5。**追随**: wcstack-skill（router 新属性 → §10 必須）。README 両言語。

---

## Phase 4 — raf `reduced-motion`（D6 裁定済み・`packages/raf/`）

### タスク

- **T4-1**: RafCore — `_updateSuspended` を `running && (hidden || reducedGate)` に拡張。`observe()` で MQL change 購読・`dispose()` で解除（`_visibilityDoc` と同型）。reduce オン→`_clearHandle()`、オフ→`_lastTs = null` + 再アーム（dt=0 境界）。`start()` は reduce 中なら suspended のまま非アーム。`_frame` 尾部は reduce 中に再要求しない。再アームは `_gen` ガードと `_handle !== null` 再入規則を通す（二重ループ防止）。
- **T4-2**: `matchMedia` 注入（RafScheduler 注入と同型）— テストが preference と change イベントを直接制御できるようにする。
- **T4-3**: Shell — wcBindable inputs に `{name:"reducedMotion", attribute:"reduced-motion"}`、値正規化は未知→`"run"`。`types.ts` の `WcsRafInputs` 追随。
- **T4-4**: README / README.ja — suspended の意味拡張（visibility + reduced-motion の 2 原因）を明記。`pause()` と混ぜない設計理由も 1 段落。
- **T4-5**: timer — **保留で確定**（D6 裁定 2026-08-28）。TimerCore に suspended 概念を足す拡張は実需が出るまで行わない（本タスクは記録のみ・コード変更なし）。

### 検証項目（順序の罠）

reduce オン中に hidden → visible、reduce 中に start、hidden 中に reduce 解除 — どの順でも「両原因が消えたときだけ 1 本のループが再アーム」をテストで固定。

### DoD

共通 DoD。**追随**: wcstack-skill（raf 新属性 → §10 必須）。

---

## Phase 5 — examples 底上げ（設計書 §7 の 10 件）

### タスク

- **T5-1〜T5-10**: 設計書 §7 の番号どおり。要注意 3 点: (a) tilt-maze は `onkeydown#prevent` 禁止（Tab まで殺す）・ハンドラ内で Arrow 系のみ preventDefault・blur で KEYS クリア（stuck-key 防止）、(b) websocket-chat react/vue は **dist 再ビルド後に戻さず配信物として更新コミット**（examples の dist は配信実体 — packages の dist とは扱いが逆）、(c) sse-dashboard の Pause は両ペイン同時。
- **T5-11**: 修正した examples が repo 全体 CI の wcs-validate ゲート（error severity）を通ることを確認。

### DoD

lint / wcs-validate green + 手動動作確認 + 既存 e2e smoke（tilt-maze / sse-dashboard / cross-tab-todo は既存 spec あり — green 維持）。

---

## Phase 6 — 静的検査 `wcs/aria-attr-unknown`（`packages/vscode-wcs/` + `packages/lint/`）

### タスク

- **T6-1**: `service/ariaValidator.ts` 新設（純関数・DOM/vscode 依存なし）。`findAllBindAttributes` / `parseBindingExpression` を再利用（再実装禁止 — IDE/CI パーサ乖離防止のコメント指示に従う）。WAI-ARIA 属性リストは出典と更新手順のコメント付き。
- **T6-2**: `core/diagnostics.ts` に `wcs/aria-attr-unknown` を追記（**append-only 公開契約 — 名前はここで確定**）。`core/messages.ts` に ja/en 両カタログ。severity は **warning リテラル**。
- **T6-3**: `core/validateDocument.ts` の push リストに配線 → IDE と CLI に同時到達（`@wcstack/lint` は dist のバイトコピーなのでコード変更ゼロ）。
- **T6-4**: テスト — `__tests__/ariaValidator.test.ts` + `core.cli.test.ts` パターンで IDE/CLI parity。`attr.aria-labels` → 「did you mean aria-label」ケースを必須に。
- **T6-5**: `packages/lint` を build して smoke green を確認（warning なので exit 契約は不変 — `smoke-test.mjs:106-119` の対ケースは**触らない**）。

### DoD

共通 DoD + wcs-validate ジョブ green（新 warning が repo の HTML に出ても error でないため CI は落ちない — 出た warning は Phase 5 の対象かを確認して記録）。

---

## Phase 7 — README / docs（横断）

### タスク

- **T7-1**: 地雷系 8 パッケージ README（英日）に "Accessibility" 節（設計書 §9 の表とテンプレ）。
- **T7-2**: timer / raf / sse / websocket README に「既存 pause/close command の a11y 文脈での紹介」1 段落。
- **T7-3**: SR 手動検証手順（NVDA / VoiceOver でのルート遷移・live region 確認）を docs に追加。
- **T7-4**: `e2e/README.md` の既知 drift（スペック一覧が実体 25 本より古い・CI トリガー記述）を新 spec 追加のついでに修正。

### DoD

`docs/README.md` の言語規約（リンクは言語内で閉じる）に適合。

---

## 8. 受け入れ条件マトリクス

| ID | 条件 | Phase |
|---|---|---|
| A1 | Navigation API 経路のリンク遷移後に scrollY=0・フォーカスリセット（e2e で固定） | 0 |
| A2 | intercept オプションが明示され、`NavigateEventLike` がそれを表現できる | 0 |
| A3 | フォールバック push 遷移後に scrollY=0、popstate では scroll しない（unit + T0-4 の fallback 強制 e2e） | 1 |
| A4 | guard 拒否時に scroll / focus / announce が一切動かない | 1, 3 |
| A5 | active リンクの `<a>` に `aria-current="page"` が付き、外れると消える | 1 |
| A6 | `<wcs-link aria-label>` が生成 `<a>` に転送され、`style` / `class` は転送されない | 1 |
| A7 | keyed swap 中の行内 input のフォーカスと入力値が生き残る（Chromium e2e） | 2 |
| A8 | swap 移動 ≤2 の契約が insertBefore + moveBefore 合算で維持される | 2 |
| A9 | `announce="title"` で遷移後に live region へ新 title が入り、属性なしなら region は空のまま | 3 |
| A10 | `focus="heading"` で新ルートの最初の見出しにフォーカスし、初回描画では動かない | 3 |
| A11 | reduce オン中の start / オン中の visible 復帰 / 解除 のどの順でもループが 1 本だけ再アーム | 4 |
| A12 | tilt-maze が矢印キーだけでクリア可能 | 5 |
| A13 | `attr.aria-labels` に warning + 修正候補が IDE / CLI 双方で出る | 6 |
| A14 | 8 パッケージ README に Accessibility 節（英日） | 7 |

## 9. リスク

1. **フォールバック経路の実ブラウザ検証** — Chromium は Navigation API を持つが、T0-4 の fallback 強制（`addInitScript` で `window.navigation` を undefined 化）が成立すれば Chromium のまま実ブラウザで踏める（`getNavigation()` は毎回 `window.navigation` を動的参照）。不成立の場合のみ happy-dom unit だけが防衛線となり、WebKit project 追加を再検討（§11）。
2. **moveBefore のブランケット適用は throw する** — same-parent ガードを外す「簡略化」を将来のリファクタで入れないこと（コード内コメントで防衛）。
3. **coverage 閾値**: happy-dom に moveBefore / MQL change 配送が無い → スタブ・注入なしでは 100/97 を割る（T2-2 / T4-2 が対策）。
4. **raf の再アーム競合**: `_gen` / `_handle` 規則を通さないと二重ループ（Phase 4 検証項目）。
5. **severity 昇格の再発形**: `wcs/aria-attr-unknown` を error 化する日が来たら smoke-test 対ケース更新 + repo CI ゲートが examples で落ち始める（#180/#183 と同型）。warning 据え置きが既定。
6. **vscode-wcs は CI matrix 外**: Phase 6 自体は wcs-validate 独立ジョブが守るが、state 側 wcBindable 変更への追随遅れの構造は残る。
7. **checked-in dist**（websocket-chat react/vue）: gitignore パターンに合致するが**追跡済みの配信実体** — src 修正時は再ビルドして dist ごと更新コミット（packages/*/dist の「戻してからコミット」とは逆の扱い）。
8. **bound title の staleness**: announce は commit 時スナップショット（設計書 D2）— state 未ロード時の空読みは仕様として README に明記し、テストでも固定する。

## 10. 追随チェックリスト

- [x] **wcstack-skill**（別リポジトリ wcstack/wcstack-skill）: references 更新済み — **wcstack-skill PR #2**（v1.32+ 注記付き。該当リリースが出たらマージし `metadata.wcstack-version` を bump する）。Phase 0 / 2 / 5 / 6 / 7 は構文・属性・プロトコル変更なしのため追随不要（明示判定）。
- [x] 各パッケージ README は英日両方（`README.md` / `README.ja.md`）— 全 Phase で実施済み。
- [x] `timing-and-firing-contract.md` §20（英日・Phase 3 で追記）。
- [x] `e2e/README.md` のスペック一覧 — Phase 0/2/3 で追記、Phase 7 でドリフト全解消（9 smoke + 17 fixture = 実体 26 spec）。
- [ ] vscode-wcs は独立バージョン — Phase 6 は vsix publish（ユーザー操作）+ `@wcstack/lint` リリースの両方が揃って初めて IDE / CLI が一致する。

## 11. 未解決

設計書 §12 と同じ: if 分岐のフォーカス復元（需要待ち）、バインド title の再読み上げ。（D1 / D2 / D6 は 2026-08-28 裁定済み。フォールバック強制 e2e は T0-4 で**成立を実測** — `window.navigation` の own-property 潰しで Chromium のまま pushState / popstate 経路を踏めた。WebKit project は不要）

---

## リリース時の作業（未実施・ユーザー操作）

- **すべて追加的変更 — minor で足りる**。i18n の minor リリース（`config.locale` 既定変更・破壊的）が未実施のため、**同じ minor に同乗できる**。
- ノートに 1 行ずつ入れる非破壊の変更:
  - router: フォールバック経路（Navigation API 非対応ブラウザ）で push 遷移後にページ先頭へスクロールするようになった
  - router: `<wcs-link>` が生成する `<a>` に `aria-current="page"` が付くようになった / `aria-*` ほか許可リスト属性を転送するようになった
  - state: リスト並び替えが `moveBefore()` 対応ブラウザでフォーカス・iframe・アニメーション状態を保存するようになった
  - raf: `reduced-motion="pause"` 属性を追加。`suspended` の原因に reduced-motion が加わった（既定は従来どおり）
  - router: `focus` / `announce` 属性を追加（オプトイン）
  - lint / vscode-wcs: `wcs/aria-attr-unknown`（warning）を追加 — vsix publish が別途必要
- 確認事項: 新 lint 診断コード名の最終確定（append-only のため publish 後は変更不可）。
