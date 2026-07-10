# wcs-raf（フレームソースノード）設計論点 (rAF Tag Design Notes)

- Status: **設計確定（2026-07-10 G1/G2/G3 決定済み）→ 実装計画は [raf-impl-plan.md](raf-impl-plan.md)**
- 起点: examples/state-tilt-maze / signals-tilt-maze で `<wcs-timer interval="16">` を
  ゲームループに流用した際、(1) setInterval が vsync に揃わない、(2) dt を利用側で
  自前計算・クランプする必要がある、の 2 点が判明したこと。
- 雛形: `@wcstack/timer`（TimerCore）。本ドキュメントは
  [async-io-node-guidelines.md](async-io-node-guidelines.md) の § 番号を参照する。

## 0. 一言要約

`requestAnimationFrame` を宣言的タグにした `wcs-timer` の兄弟。「時間の経過」では
なく「**描画機会**」をリアクティブ状態にする。timer との差別化の本体は
(a) vsync 整合、(b) `dt` の一級出力、(c) バックグラウンド完全停止の意味論、の 3 つ。

---

## 1. 基本形: rAF は一回性 API — Core が再登録ループを持つ

`setInterval` と違い rAF は one-shot。Core はコールバック内で次フレームを再登録する
ループを回し、stop/dispose で `cancelAnimationFrame` する。

- コールバック引数の `DOMHighResTimeStamp` を **elapsed / dt の唯一の時刻源**とする
  （`performance.now()` を混ぜない）。rAF timestamp は同一フレームの全コールバックで
  共有される「フレーム開始時刻」であり、dt 計算の正はこちら。
- API 解決は呼び出し時（§3.7）: `globalThis.requestAnimationFrame` を start 時に引く。

## 2. 【未決ゲート G1】パッケージ配置 — 独立 vs timer 同居

| 案 | 内容 | 根拠 / 前例 |
|---|---|---|
| A | `@wcstack/raf` 新パッケージ / `<wcs-raf>` | 1 タグ 1 API 原則（timer=setInterval、raf=rAF） |
| B | `@wcstack/timer` に `<wcs-raf>` を同居 | speech の 2 タグ 1 パッケージ、debounce/throttle の Core 共有前例。面が tick/elapsed/running + start/stop/… とほぼ同一で「時間源が違うだけの兄弟」 |
| C | `<wcs-timer mode="raf">` | **却下推奨**: 入力面が別物（interval が無意味になり、once/immediate の意味も変わる）。属性の組み合わせ表が汚れる |

- B は timer の minor bump を伴う（1.17.0 → 1.18.0）。A は新規 publish 1 個。
- CDN 1 行哲学はどちらでも満たす。
- 推奨は **B**（Core の scheduling 部だけ差し替えて共有 or 姉妹 Core）。ただし
  パッケージ粒度はプロジェクトの一貫性判断なので未決ゲートとする。

## 3. 出力面: `dt` を一級にする（timer に無い新出力）

イベントは 1 本 + 派生 getter（§4.2、FetchCore の value/status 前例）:

- `wcs-raf:tick` — detail = `{ count, elapsed, dt, timestamp }`
- properties: `tick`(=count) / `elapsed` / `dt` / `running`
- `tick` は同値ガード**なし**（毎フレーム発火 — 発火契約 §9.2 の reading 型）。
  `running` は同値ガード**あり**。

### 3.1 dt の規範（【未決ゲート G3】中断を跨ぐ dt）

- 定義: 直前 tick の rAF timestamp との差（ms）。初回 tick は `dt = 0`。
- **中断（stop→start、pause→resume、タブ非表示→復帰）を跨ぐ最初の tick も `dt = 0`**
  に正規化することを推奨。規範文: 「dt は連続稼働中のフレーム間隔のみを表す。
  中断を跨いだ値は届かない」。
  - これで迷路デモが自前でやっていた dt クランプ（40ms 上限）のうち
    「タブ復帰でボールがテレポートする」問題がノード側で消える。
  - 上限クランプ（max-dt 属性）はやらない: 低フレームレート機での物理の質は
    利用側のドメイン判断。素通し + 中断 0 化が最小で誠実。

## 4. 【未決ゲート G2・最大論点】バックグラウンド完全停止と running の二相化

rAF は非表示タブで **0 Hz（完全停止）**。setInterval の ~1 Hz スロットルと違い、
「start 済みだが 1 フレームも届かない」時間が普通に発生する。
→ 「意図」と「実際」が乖離する。これは **wakelock の desired(`active`) / actual(`held`)
二相（発火契約 §15.1）と同型**の問題。

| 案 | 内容 | コスト / 帰結 |
|---|---|---|
| A | `running` = 意図のみ。停止は暗黙（README に明記するだけ） | 実装最小。timer との差別化が dt だけになる |
| B | 二相化: `running`（意図）+ `suspended`（実際に配送が止まっているか）。`visibilitychange` を購読 | wakelock の語彙を流用でき、`:state(suspended)` も反映できる。elapsed のアクティブ時間化（§4.1）と同じ購読で済む |
| C | 素朴のまま、将来の `wcs-pagevisible`（候補カタログ B）との合成に委ねる | ノード間合成の実証にはなるが、elapsed / dt の整合はページ側の責務になり規範が書けない |

### 4.1 elapsed の定義

- 非表示中の時間を elapsed に含めると「ゲーム内時間」が飛ぶ。TimerCore の
  segment 簿記（`_accumulatedElapsed` + `_segmentStart`）をそのまま流用し、
  **visibility hidden で segment を閉じる = elapsed は「アクティブ時間」**とするのが
  ゲーム用途の実需に合う。これは案 B と同じ `visibilitychange` 購読を要する。
- 推奨: **B + アクティブ時間 elapsed + 復帰初回 dt=0（G3）** の三点セット。
  この問題設定こそ raf 固有の設計価値であり、ここを素通しにするなら
  タグ化する意味が薄い。

## 5. 入力面: timer からの踏襲と削除

| 入力 | 判断 | 理由 |
|---|---|---|
| `interval` | **削除** | rAF に周期は無い |
| `once` | 踏襲 | 「次の描画機会に 1 回」= rAF の素の意味論そのものの宣言化。`repeat="1"` の糖衣（timer と同型） |
| `repeat="N"` | 踏襲 | N フレームで停止 |
| `immediate` | **削除** | 初回 tick が既に「次の描画機会」であり、それより早い意味のある時点が存在しない |
| `manual` / `trigger` | 踏襲 | timer と同一の意味論（trigger は false→true エッジ） |
| `fps` / `every="N"`（間引き） | **v1 では入れない** | YAGNI。時間ベースの間引きは `wcs-throttle` に合流可能（ただし frame-aligned ではない旨を README に注記）。将来 `fps` 属性を足す余地だけ残す |

- auto-start 既定は timer と同一（connect で開始、`manual` でオプトアウト）。
  迷路デモは timer 版で auto-start + step 側 no-op ガードが成立済み。

## 6. commands: pause / resume の再定義

timer の `pause` は「部分周期の保持」に意味があったが、rAF に部分周期は無い。
pause と stop の差は **elapsed 簿記と repeat カウントの継続性だけ**になる。

- 案 (a): `start` / `stop` / `reset` のみに絞る。
- 案 (b): 5 コマンド踏襲。`stop` = run 終了（次の start は新しい run）、
  `pause` = segment 中断（elapsed・repeat 残数を保持）。
- §4 で visibility による**自動 suspend** を入れるなら、`pause` は「手動 suspend」
  として対称になり簿記も共有できる → **(b) 推奨**。

## 7. SSR / 非対応環境 / never-throw

- `error` 出力面は**持たない**（resize の前例・発火契約 §12.4）: rAF に恒常的な
  失敗モードがほぼ無く、unsupported は silent no-op + `ready` 即 resolve（§3.8）。
- happy-dom は rAF を実装しているため SSR（@wcstack/server）中も tick し得る。
  スナップショット取得は有限時間なので実害は限定的だが、README に
  「SSR では manual 推奨」を明記するか、`data-wcs-server` 環境での auto-start
  抑止を Shell に入れるかは実装時の小論点。
- `_gen` 世代ガードは MUST（§3.4）: `cancelAnimationFrame` が handle を消しても、
  dispose 後の stale fire 防御は timer と同じ belt-and-braces で持つ。

## 8. タイミング契約の追補（timing-and-firing-contract.md）

実装時に検証して 1 章を追加する:

- rAF コールバックは task でも microtask でもない **rendering 直前の専用スロット**で
  走る。tick → event-token → state 書き込み → state の updater（microtask）は
  **同一フレームの描画前に flush される**。これが「rAF 源にすれば本当に vsync に
  揃う」ことの根拠であり、明文化してデモ（§12）からトレースする。
- signals 側も同様（effect は microtask バッチ）。

## 9. Shell / `:state()` 反映

- `:state(running)` は timer と同一（`running-changed` の写像、§17）。
- G2 で二相化を採る場合は `:state(suspended)` を追加
  （`suspended-changed` イベントの同期写像として — §17.2 の「states はイベントの写像」
  規約に従う。派生 boolean なのでガイドライン §4.2 とも整合）。

## 10. 複数インスタンス — 共有スケジューラはやらない

各インスタンスが自前で rAF を登録する（timer が各自 setInterval を持つのと対称）。
ブラウザの rAF コールバック多重登録コストは無視できる一方、モジュール共有ループは
世代管理・テスト・dispose 順序を複雑化するだけ。**決定扱いでよい**。

## 11. テスト設計

- happy-dom の rAF 実装に依存せず、**Core にスケジューラ注入**
  （camera の Fake* / worker の makeWorker 前例）: `(cb) => handle` / `cancel` /
  timestamp 供給を Fake が握る。vitest fakeTimers の `toFake:
  ["requestAnimationFrame"]` は補助に留める。
- `visibilitychange`（G2 採用時）のモック、dt=0 正規化の境界（初回 / stop→start /
  pause→resume / hidden→visible）、repeat 境界、_gen stale fire。
- カバレッジ基準 100/97/100/100（§8）。

## 12. 受け入れ基準 — 迷路デモの移行で検証する

state-tilt-maze / signals-tilt-maze の `<wcs-timer interval="16">` を `<wcs-raf>` に
置換して:

1. 利用側の自前 dt 計算・クランプが消える（detail.dt をそのまま積分に使う）
2. タブ非表示→復帰でボールがテレポートしない（G3 の規範で保証）
3. 実ブラウザ検証（既存の Playwright チェック一式 + 自動走破）が両版でパスする
4. README の「timer は vsync に揃わない」注記を「raf に置換可能」へ更新する

## 13. 命名

- パッケージ `@wcstack/raf` / タグ `<wcs-raf>`。略語は `sse` の前例があり整合。
  （G1 で timer 同居案なら「@wcstack/timer の `<wcs-raf>`」になる。）
- 代案 `<wcs-frame>` は Frame API 一般と紛らわしく、`<wcs-animation-frame>` は冗長。

---

## ゲート決定（2026-07-10）

| ゲート | 問い | 決定 |
|---|---|---|
| G1 | 独立パッケージか timer 同居か | **A: 独立 `@wcstack/raf` / `<wcs-raf>`**（推奨は B だったが、1 タグ 1 API 原則を優先。TimerCore はコード雛形として流用し、Core 共有はしない） |
| G2 | running の二相化（+ アクティブ時間 elapsed）を入れるか | **入れる**（`suspended` 出力 + `:state(suspended)` + elapsed のアクティブ時間化） |
| G3 | 中断を跨ぐ dt を 0 に正規化するか | **する**（上限クランプはしない） |

実装計画: [raf-impl-plan.md](raf-impl-plan.md)
