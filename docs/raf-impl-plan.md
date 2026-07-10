# @wcstack/raf 実装計画 (rAF Implementation Plan)

- Status: **実装完了（2026-07-10）** — Phase 1〜6 完了（テスト 90 本 100/100/100/100、
  迷路デモ 2 版の移行 + 実ブラウザ 24/24 合格、契約 §18 追補済み）。残りは Phase 7
  （リリース時の注意）のみ。実装で判明した計画からの逸脱: (1) 迷路の startGame に
  whenDefined ゲートを追加（emit 前に要素定義を待つ — 遅延 command 購読は emit を
  リプレイしないため）、(2) 描画反映は「同一フレーム」でなく「+1 フレーム」が実測
  （raf 固有でなく state のイベント駆動書き込み一般。§18.4）。
- 設計: [raf-tag-design.md](raf-tag-design.md)（G1/G2/G3 決定済み 2026-07-10）
- 決定サマリ: **独立パッケージ `@wcstack/raf` / `<wcs-raf>`**（G1=A）、
  **`running`/`suspended` 二相 + アクティブ時間 elapsed**（G2）、
  **中断跨ぎ dt=0 正規化・上限クランプなし**（G3）
- 雛形: `packages/timer`（レイアウト・テスト構成・`_gen`/SSR 規約をそのまま流用）

## 0. スコープ確定（決定の帰結 + 設計精緻化 1 点）

- 出力面: `tick` / `elapsed` / `dt` / `running` / `suspended`。
  イベントは `wcs-raf:tick`（detail = `{ count, elapsed, dt, timestamp }`）、
  `wcs-raf:running-changed`、`wcs-raf:suspended-changed` の 3 本。
- 入力面: `once` / `repeat` / `manual` / `trigger`（`interval`・`immediate`・`fps` は無し）。
- コマンド: `start` / `stop` / `reset` / `pause` / `resume`。
- **設計精緻化: elapsed は Σdt で導出する。** TimerCore の segment 簿記
  （`_accumulatedElapsed` + `_segmentStart`）は不要になる — G3 により中断跨ぎの
  dt が 0 なので、「アクティブ時間」は tick ごとに `elapsed += dt` するだけで
  自動的に成立する。elapsed の粒度はフレーム単位（tick 間の getter 読みは
  最後の値を返す）— rAF ノードの契約として README に明記。

## Phase 1: パッケージ雛形展開（packages/raf/）

1. `packages/timer` を `packages/raf` へコピー（`coverage/` `dist/` `.tsc-out/`
   `node_modules/` は除外）。
2. `package.json`: name=`@wcstack/raf`、version=`1.17.0`（次のリリース列車で
   全パッケージ一括 minor bump に同乗）、description/keywords を rAF 向けに
   （`requestanimationframe` / `animation` / `game-loop` / `frame`）。
3. **`package-lock.json` は timer のものを流用し、root エントリの `name` だけ
   `@wcstack/raf` に書き換える。** Windows 上で `npm install` から再生成しない —
   PR#57 で確認済みの Windows 生成 lockfile 問題（rollup の linux バイナリ欠落で
   CI build 失敗）を回避する。devDependencies は timer と完全同一なので解決結果も
   同一で正しい。
4. リネーム一式: `bootstrapTimer.ts`→`bootstrapRaf.ts`、`components/Timer.ts`→
   `components/Raf.ts`、`core/TimerCore.ts`→`core/RafCore.ts`。`config.ts` は
   `tagNames.raf = "wcs-raf"`、`triggerAttribute = "data-raftarget"`（autoTrigger は
   timer と対称に踏襲）。イベントプレフィックスは `wcs-raf:`。
5. `src/protocol/wcBindable.ts` は生成物 — `node scripts/sync-protocol-types.mjs`
   を実行して再生成する（スクリプトが新パッケージを自動発見するか最初に確認。
   しない場合は timer のコピーを DO NOT EDIT ヘッダごと維持し、スクリプトの
   対象リストに raf を追加する）。
6. `rollup.config.js` / `tsconfig.json` / `eslint.config.js` / `vitest.config.ts` /
   `__tests__/setup.ts` は原則そのまま（パッケージ名依存の記述が無いか確認のみ）。
7. `src/auto/auto.js` / `auto.min.js`: bootstrapRaf 呼び出しに書き換え。

## Phase 2: RafCore（設計 §1/3/4/6/7/8 の実装化）

```
constructor(target?: EventTarget, scheduler?: { request(cb): unknown; cancel(handle): void })
```

- **スケジューラ注入**（テスト正攻法・§3.7）: 既定は呼び出し時に
  `globalThis.requestAnimationFrame` / `cancelAnimationFrame` を解決。不在なら
  `start()` は silent no-op（never-throw・**error 面なし** — resize 前例）。
- 内部状態: `_tick` `_dt` `_elapsed` `_running` `_suspended` `_paused`
  `_lastTs`（null = 次 tick の dt は 0）`_repeat` `_runStartTick` `_gen` / `_runGen`。
- **フレームループ**: `cb(ts)` → `_runGen` ガード（§3.4 MUST）→
  `dt = _lastTs === null ? 0 : ts - _lastTs` → `_lastTs = ts` →
  `_tick++` / `_elapsed += dt` / `_dt = dt` → `wcs-raf:tick` dispatch →
  repeat 到達なら stop、さもなくば re-request。時刻源は rAF timestamp のみ
  （`performance.now()` を混ぜない）。
- **G3 の実装**: `start()` / `resume()` / visible 復帰の 3 箇所で `_lastTs = null`。
- **G2 の実装**: `observe()` で `document` の `visibilitychange` を購読
  （document 不在環境では no-op）。`suspended = _running && visibilityState === "hidden"`
  を同値ガード付きで dispatch。hidden 遷移で `_lastTs = null` も実施。
  hidden 中の rAF handle は放置でよい（ブラウザが配送を止める）— 明示 cancel +
  visible 再 request にするかはテスト容易性を見て実装時に選ぶ（既定: 放置 =
  コード最小）。`dispose()` で購読解除。
- コマンド意味論: `start` = no-op if running / `stop` = 値保持で run 終了 /
  `reset` = stop + tick/elapsed/dt を 0 / `pause` = handle cancel・running=false・
  値と repeat 残数を保持 / `resume` = pause からのみ再開（`_lastTs = null`）。
  `suspended` は「running かつ hidden」なので pause/stop 中は常に false。
- 同値ガード: `running` / `suspended` = あり、`tick` = なし（毎フレーム発火 —
  発火契約 §9.2 の reading 型）。
- `static wcBindable`:
  - properties: `tick`(getter: detail.count) / `elapsed`(detail.elapsed) /
    `dt`(detail.dt) — 3 つとも `wcs-raf:tick` から（§4.2 の 1 イベント + 派生 getter）、
    `running`(running-changed) / `suspended`(suspended-changed)。
  - commands: start / stop / reset / pause / resume。
- SSR: `ready` は即 resolve（timer と同じ §3.8）。

## Phase 3: Shell（components/Raf.ts）

- 属性: `once` / `repeat` / `manual` / `debug-states`。`interval` `immediate` は
  存在しない（timer からの削除点）。
- `trigger` プロパティ入力（false→true エッジで start — timer と同一）。
- connect: 非 `manual` なら `observe()` + `start()`（auto-start は timer と対称）。
  SSR で回り続ける件は README の「SSR では manual 推奨」明記のみで対応。
- `:state(running)` + `:state(suspended)`（§17「イベントの同期写像」規約。
  customStates.test の雛形を流用）。
- autoTrigger: `data-raftarget` クリック起動（timer の autoTrigger.ts 流用）。

## Phase 4: テスト（__tests__）

- `helpers.ts` に **FakeScheduler** を追加: `pump(timestamp)` でフレームを手動
  駆動（timestamp を明示指定 — dt 検証の要）。happy-dom の rAF 実装には依存しない。
  visibility は `document.visibilityState` の defineProperty 差し替え +
  `visibilitychange` dispatch でモック。
- テストマトリクス:
  - dt: 初回 = 0 / 連続フレームの差分 / stop→start 跨ぎ 0 / pause→resume 跨ぎ 0 /
    hidden→visible 跨ぎ 0（G3 の 4 境界すべて）
  - elapsed: Σdt に一致・中断中は増えない（アクティブ時間）・reset で 0
  - suspended: hidden/visible 遷移で発火・同値ガード・pause/stop 中は false・
    hidden 中に pump しても tick が出ない
  - repeat / once（=repeat 1 糖衣）境界、再 start で残数リセット（_runStartTick）
  - trigger の false→true エッジ / manual / autoTrigger（data-raftarget）
  - `_gen`: dispose 後の stale コールバックが状態変異も dispatch もしない
  - rAF 不在環境: start が silent no-op・ready 即 resolve
  - wcBindable 面: プロパティ/コマンド宣言、spread（`...:`）互換
  - `:state(running)` / `:state(suspended)` 反映（対応・非対応環境）
- 基準: **100/97/100/100**、テスト記述は日本語（§8）。

## Phase 5: ドキュメント

- `packages/raf/README.md` + `README.ja.md`: リファレンス一式 +
  **「vs `wcs-timer`」比較表**（時間源 / interval 無し / dt / バックグラウンド挙動 /
  suspended）+ dt 規範の明文（「dt は連続稼働中のフレーム間隔のみを表す」）+
  SSR 注意。
- `docs/timing-and-firing-contract.md` に § 追補「@wcstack/raf — tick の配送
  スロットと描画順序」: rAF コールバック（rendering 直前スロット）→ event-token →
  state 書き込み → updater（microtask）flush → **同一フレームの描画**、の縦契約。
  ※ 書く前に実ブラウザで検証する（Playwright: tick ハンドラの DOM 書き込みが
  次フレームの rAF から観測して 1 フレーム以内に反映されていること）。
- ルート README / README.ja のパッケージ表に `@wcstack/raf` 追加、
  リポジトリ CLAUDE.md の I/O node リストにも 1 行追加。

## Phase 6: 受け入れ — 迷路デモ 2 版の移行（設計 §12）

- `examples/state-tilt-maze`: `<wcs-timer interval="16">` → `<wcs-raf>`。
  `$on.frameTick` が `event.detail.dt` を直接使い、`performance.now()` /
  `lastT` の**計測コードが消える**。物理側の上限クランプは
  `Math.min(dt, 40)` の 1 行として**残す**（設計 §3.1: 低フレームレート機の
  トンネリング防御はドメイン判断 — V_MAX×dt < 壁厚 12px の成立条件）。
- `examples/signals-tilt-maze`: 同様（`loop.signals.dt.peek()`）。
- 検証: 既存の Playwright チェック一式（16 項目相当）+ 自動走破を両版で再実行。
  加えて「タブ非表示→復帰でボールがテレポートしない」を suspended/dt=0 の
  実機確認として 1 項目追加。
- 両 README の「timer は vsync に揃わない」系の注記を raf へ更新
  （`:state(running)` の game loop チップはタグ名変更のみでそのまま動く）。

## Phase 7: リリース時の注意（実装外・発車前チェック）

- 新パッケージの**初回 publish は release.yml の非冪等ループ問題の当たり所**
  （途中失敗 → 部分公開 + タグなし、再実行は既公開と衝突）。raf を含む
  リリースの前に「既公開バージョンはスキップ」ガード（`npm view` で存在確認）
  を先に入れることを推奨 — 既存の P0 課題と同件。
- バージョンは全パッケージ整合ポリシーに従い、次の列車（1.18.0 想定）で初出。

## 実施順序

Phase 1 → 2 → 4（Core テストを Shell より先に回す）→ 3 → 4 残り（Shell/状態反映）
→ 5 → 6。Phase 6 が受け入れゲート — 通らなければ設計に戻る。
