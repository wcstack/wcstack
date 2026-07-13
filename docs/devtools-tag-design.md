# wcs-devtools（ページ内オーバーレイ DevTools）設計 (DevTools Tag Design Notes)

- Status: **Phase 1 実装完了（2026-07-14・未リリース）** — ランタイム接点の規範は
  [devtools-hook-protocol.md](devtools-hook-protocol.md)（以下「protocol」）。
  実装は packages/devtools/、example は examples/state-devtools-playground/、
  実ブラウザ受け入れは e2e/devtools-smoke.mjs（chromium 一気通貫）。
  実装時の決定記録・実測知見は §11 を参照。
- スコープ決定（2026-07-14 ユーザー決裁）: Phase 1 = フック実装 + オーバーレイ UI。
  対象は state + 配線（binding / command-token / event-token）。signals は後追い。
  ブラウザ拡張は Phase 3 判断保留。

## 0. 一言要約

`<script src=".../devtools/auto">` 一行でページに載る検査オーバーレイ。
**DevTools 自体が wcstack のカスタムタグ**であり（哲学との一貫性 = 差別化）、
UI は `@wcstack/state` 自身でレンダリングする（ドッグフーディング）。
ランタイムとの接点は protocol の global hook のみ — つまり devtools は
「wcstack で書かれた、wcstack の最初の本格アプリ」でもある。

## 1. パッケージ構成

- **`@wcstack/devtools`** 新パッケージ / タグは `<wcs-devtools>` 1 つ。
- 既存の Core / Shell 分割に従う:
  - **DevtoolsCore**（`core/`）— hook client。protocol registry への addListener、
    source 管理、**配線台帳**（node⇔binding⇔path。binding-added/removed イベントから構築、
    node は WeakRef 保持）、**タイムライン ring buffer**（既定 500 件 FIFO、
    notification の 50cap 前例の系譜）、値フォーマッタ（§6）。DOM 非依存・happy-dom 不要で
    テスト可能。
  - **WcsDevtools Shell**（`shell/`）— カスタム要素。ShadowRoot に UI を構築し、
    属性/ホットキー/ドック位置を管理。Shell クラスは export（既存規範）。
- `src/auto/` に単一タグ bootstrap（既存の copy-auto パターン）。
- **これは I/O ノードではない**: wcBindable / command-token / event-token 面は持たない
  （検査者が被検査プロトコルに参加すると循環する）。`static wcBindable` なし。

### 1.1 依存関係（例外の明文化）

- `@wcstack/devtools` は `@wcstack/state` に **dependencies** で依存する。
  ランタイム依存ゼロ原則の**初の明示的例外**であり、根拠は「devtools は state の
  付属工具であって基盤部品ではない」。README に明記。
- CDN 利用時に devtools が持ち込む state コピーがページ本体のコピーと別インスタンスに
  なっても**問題ない**: 検査は global hook 経由でありモジュール同一性に依存しない
  （protocol §2）。むしろ inspector / inspected のランタイム分離として働く。
- 自己除外: devtools 内部の `<wcs-state>` は予約名 `wcs-devtools-ui` を使う
  （protocol §5 の prefix 規範）。

## 2. 起動と表示形態

- 導入: `<script type="module" src="https://esm.run/@wcstack/devtools/auto"></script>`。
  auto は要素定義 + `document.body` 末尾に `<wcs-devtools>` が無ければ自動挿入。
  手動で `<wcs-devtools>` を書いた場合は auto は挿入しない。
- 初期状態は**閉**: 画面隅に小さなフローティングバッジ（wcstack ロゴ + source 数）のみ。
  クリックまたはホットキー（既定 `Alt+Shift+D`）でパネル開閉。
- パネルは ShadowRoot 内で完結（`:host` 固定配置・最大 z-index・`all: initial` 基点）。
  ページの CSS/DOM を一切変更しない。**ハイライトもページ要素の style/class を触らず**、
  ShadowRoot 内の絶対配置オーバーレイ box（`getBoundingClientRect` 追従）で描く。
- SSR: `data-wcs-server` 下では何も描画しない（protocol 原則 6 と対）。

### 2.1 属性

| 属性 | 型 | 既定 | 意味 |
|---|---|---|---|
| `open` | boolean | なし | 初期状態でパネルを開く |
| `dock` | `"right" \| "bottom"` | `"bottom"` | ドック位置 |
| `hotkey` | string | `"Alt+Shift+D"` | 開閉ホットキー。`"none"` で無効 |
| `buffer` | int | `500` | タイムライン ring buffer 件数 |
| `hidden-states` | string | `""` | 追加で非表示にする state 名（カンマ区切り。`wcs-devtools*` は常に非表示） |

属性は起動時読み取り + `attributeChangedCallback` で反映。two-way 面は持たない（§1）。

## 3. UI 構成（MVP = 3 ペイン + ピッカー）

```
┌─ wcs-devtools ────────────────────────────────────────────┐
│ [source▾] [state▾] ⏸ 🗑 ⌖pick        [dock] [×]           │
├──────────────┬────────────────────────┬───────────────────┤
│ ① State Tree │ ② Bindings / Wiring    │ ③ Timeline        │
└──────────────┴────────────────────────┴───────────────────┘
```

### 3.1 ① State Tree ペイン

- source → state 要素（name）→ パスツリー。値は pull（`source.read`）で取得し、
  `state:update-batch` イベントの該当アドレスだけ再読して更新（全ツリーポーリング禁止）。
- 表示メタ: getter/setter/list/element パスのバッジ、`$streamStatus.*` は
  ストリーム名の行に status バッジとして畳み込み表示（protocol §4.6 — 専用配線不要）。
- **編集**: primitive 値はインライン編集 → `source.write`。通常のリアクティブ
  パイプラインを通る（protocol §3）ため、編集結果の DOM 反映やバッチが
  そのまま ③ に現れる = 編集自体が学習素材になる。
- 折りたたみ状態はパスをキーに保持。リスト配下は先頭 N 行 + 「さらに表示」
  （巨大リストでの read 爆発防止。N=20 起点、実装時に調整）。

### 3.2 ② Bindings / Wiring ペイン

- 2 方向の索引（Core の配線台帳から）:
  - **path → nodes**: パス選択で、束縛されている要素をリスト表示 + ページ上に
    オーバーレイ枠でハイライト。
  - **node → bindings**: ⌖ ピッカーモードでページ要素をホバー/クリック →
    その要素に載る binding（propName / path / filters / bindingType）を表示。
    逆リンクで ① の該当パスへジャンプ。
- token 配線も表示: state 要素の commandTokenNames / eventTokenNames（pull）と、
  binding 台帳中の command/event エントリを突合し「この state のこのコマンドは
  どの要素の何に繋がっているか」を一覧化。**subscriber 0 のコマンドは警告表示**
  （raf の空撃ちレース類の可視化。protocol §4.5）。
- 遅延アタッチ時（protocol §6）: ライブ台帳が空の場合は DOM 再スキャンによる
  **declared ビュー**に自動フォールバックし、ヘッダに
  「declared（宣言のみ・リロードでライブ化）」バッジ + リロードボタンを出す。
  declared エントリは filters 等パース結果は出せるが binding 実体・接続状態は出せない。

### 3.3 ③ Timeline ペイン

- ring buffer の時系列表示。行種別: `write`（path, value, oldValue?）/
  `batch`（アドレス数・展開でアドレス列挙）/ `command` / `event`（token 名, args 要約,
  subscriberCount）/ `element-(un)registered`。
- フィルタ: 種別チェックボックス + state 名。⏸ で購読一時停止（buffer は破棄しない）、
  🗑 でクリア。
- 行クリックで関連ペインへ（write → ① の該当パス、token → ② の該当配線）。
- パフォーマンス: 描画は rAF ごとに 1 回のバッチ追記（イベント毎 DOM 追加禁止）。
  バースト時は「+N 件」の圧縮行（protocol G-P の UI 側の受け皿）。

### 3.4 MVP に入れないもの（非目標）

- タイムトラベル / スナップショット diff — in-place 変異規範（性能記録 §7.0）と正面衝突。
  「やらないことリスト」入り。
- get（読み取り）トレース、プロファイラ（フレームグラフ等）— Phase 3 以降の別議論。
- signals ペイン — protocol §8 の識別子問題が先。ペインの枠だけ設計上予約
  （source.kind でタブ出し分けするため UI 構造の変更は不要）。
- ブラウザ拡張パネル — protocol 不変更で後付け可能（シリアライズ層を足すだけ）。

## 4. ドッグフーディングの設計則

- UI は ShadowRoot 内の `<wcs-state name="wcs-devtools-ui">` + `data-wcs` で組む。
  state の ShadowRoot rootNode サポート（`stateElementByName` の ShadowRoot 分岐）を使う。
- **hook イベント → UI state への流し込みは Core が座標変換する**: 生の内部オブジェクト
  （IBindingInfo / IAbsoluteStateAddress）を UI state に入れない（§6 フォーマッタを通した
  表示用 plain object のみ）。生参照を reactive proxy に入れると検査対象を devtools の
  依存追跡が触ってしまう。
- 高頻度イベント（timeline）は `<wcs-state>` の配列 push で受けず、Core 側 ring buffer +
  「表示ウィンドウの plain 配列を rAF で丸ごと差し替え」= リストレンダリングは
  差分エンジンに任せる（jsfb で実証済みの経路に載せる）。
- devtools 自身の更新が hook に流れるのは prefix 除外で UI から消える（protocol §5）。
  ただし「devtools を devtools で見る」デバッグモードとして `hidden-states` から
  除外を外せる余地は残す（規範上は表示既定 OFF のみ）。

## 5. 遅延アタッチ UX（protocol §6 の UI 側）

1. auto スクリプトがページ末尾・動的挿入などで**バインディング構築後**に走った場合:
   - State Tree / Timeline(以後) / 値編集は全機能動作
   - Wiring は declared ビュー + 「リロードでライブ化」導線
2. 推奨ロード位置は「state の auto より前の `<head>`」と README に明記
   （module script は文書順実行のため前置で必ず先行アタッチになる）。

## 6. 値フォーマッタ（Core）

- 表示用変換の規範: primitive → そのまま / 配列・plain object → 深さ 2 +
  省略記号（展開はオンデマンド read）/ それ以外（MediaStream, Blob, Element,
  Proxy 検出不能な class インスタンス等）→ `[[ClassName]]` タグ表示のみ。
- **絶対に structuredClone / JSON.stringify を全値に無差別適用しない**
  （camera G1: 生ハンドルが state 外で流れる世界と共存するため。循環・巨大値対策も兼ねる）。
- args（token）の要約は先頭 3 引数 × 各 80 文字上限。

## 7. テスト計画

- カバレッジ: 既存規範どおり 100/97/100/100 を目標。
  - Core（hook client / 台帳 / ring buffer / フォーマッタ）: 純ロジックで到達容易。
    protocol registry のモック source / listener を作って往復。
  - Shell: happy-dom で開閉・属性反映・ペイン切替・declared フォールバック。
    オーバーレイ枠の座標追従は getBoundingClientRect をスタブ。
- state 側計装のテストは state パッケージ内（bridge の attach/detach、イベント発火、
  detach 後の残留ゼロ = protocol §7-2/7-3）。
- 受け入れベンチ: protocol §7-1（jsfb-verify.mjs、detach 状態で計装前後一致）。
- 実ブラウザ確認: examples の 1 本（下記）を Chrome/Firefox/Safari で目視
  （オーバーレイ z-index / ピッカー / ハイライト追従は happy-dom で検証不能）。

## 8. example

- `examples/state-devtools-playground/` — 既存デモ級の小さな ToDo + `$streams` カウンタ +
  command/event token（`<wcs-timer>` あたり）を 1 ページに載せ、devtools の 3 ペイン全部が
  仕事をする最小構成。CDN 一行導入（`esm.run/@wcstack/devtools/auto`）の実演を兼ねる。
- 既存 example（例: state-sse-dashboard）に「devtools を足して開いてみる」1 行追記の
  ドキュメント導線も検討（導線修理 P0 との接続点）。

## 9. 実装順（Phase 1 内の刻み）

1. **P1-a: protocol 実装（state 側）** — registry 最小実装 + bridge + 計装 5 点
   （protocol §4）。テスト + jsfb ベンチゲート。ここまでで console から
   `__WCSTACK_DEVTOOLS_HOOK__` を叩いて全機能検証可能（= UI なしで動作実証）。
2. **P1-b: DevtoolsCore** — hook client / 台帳 / ring buffer / フォーマッタ。
3. **P1-c: Shell UI** — ①→③→②の順（②のピッカー/ハイライトが最も実ブラウザ依存）。
4. **P1-d: example + README（ja/en）+ 実ブラウザ確認**。
- リリース単位: state の計装（P1-a）は state の minor に同乗、`@wcstack/devtools` は
  v1.0.0 新規 publish（バージョン整合規範に従い他パッケージと番号は揃えない…ではなく
  **揃える**: 既存の「全パッケージ同版」運用に従う）。

## 10. 未決ゲート（実装時判断）

- **G-U1: ①の更新粒度** — update-batch 該当パスの再読で足りるか、getter 派生の
  表示ずれ（依存で再計算されるが batch に現れないケースが無いか）を実装時に検証。
  ずれる場合は staticDependency/dynamicDependency（pull 済み）で閉包を取って再読。
  → **P1 実装は timeline 変更時に State ペインを丸ごと再描画**（キー数十個の
  pull 再読は十分軽い）。getter ずれ問題は構造上発生しない。粒度最適化は将来課題。
- **G-U2: ピッカーのイベント占有** — 「奪う」（capture + stopPropagation）で実装・
  実ブラウザ確認済み。**確定**。
- protocol 側ゲート G-R / G-P は protocol 文書参照。

## 11. 実装時の決定記録（2026-07-14・Phase 1）

1. **UI レンダリングは vanilla DOM（§4 のドッグフーディングを P2 送りに変更）**。
   根拠: devtools の UI を検査対象ランタイム（page の updater キュー・microtask
   drain）に載せると、タイムライン描画 60fps 分の負荷が計測対象そのものに混入する
   （観測者効果）。vanilla 化により @wcstack/state への依存も消え、**ゼロ依存原則の
   例外（§1.1）は不要になった** — 接点は global hook のみで、モジュール同一性
   非依存という protocol の性質がそのまま inspector/inspected 分離になる。
   wcs-state ドッグフーディングは「devtools を devtools で見る」デモとして P2 で再評価。
2. **描画は rAF 合流**（イベント毎 DOM 追加なし）。帰結として headless / 非表示
   タブでは rAF が発火せず描画が止まる（見えていないので実害なし）。テストは
   `__flushRenderForTest()` シームを使う（unit / e2e スモーク共通）。
3. **happy-dom で捕まえた実装バグ 2 件**（実ブラウザにも波及し得た）:
   (a) pick モードの capture ハンドラは `event.target` の shadow retarget を
   前提にできない → `target.getRootNode() === shadowRoot || target === this`
   の二重判定に修正。(b) `rootNode instanceof Document` はテスト環境の Document
   実体と一致しないことがある → `nodeType` 判定に変更（state 本体の
   constructor.name 判定と同じ側）。
4. **ハイライトはクリック時スナップショット + 2 秒で自動消去**（追従なし）。
   getBoundingClientRect 追従（スクロール/リサイズ listener）は複雑さに見合わず
   P1 では見送り。
5. **protocol に `keys()` pull API を追補**（state 側 §4 実装と同時）。
   IStateElementSummary.paths は binding 済みパスしか持たず、State ツリーの
   描画起点にならないため。additive change（版据え置き）。

## 12. P2 以降のバックログ（2026-07-14 論点整理）

### P2-1: signals 対応（最大のかたまり）

- **順序**: signals の PoC→本実装移行（signals-migration-plan、未着手）の後に載せる。
  PoC の reactive.ts に計装しても作り直しになる。逆に移行計画の決定ゲートに
  「hook protocol を実装可能な形にする」を制約として追加しておく。
- **識別子問題（入口ゲート）**: 推奨 = `signal(v, { name })` の opt-in 命名 +
  owner tree 位置からの自動命名の併用。dev モード時スタック捕捉案は重くて却下寄り。
- **ホットパス規範の再検証**: signal read/write は set trap より桁違いに細粒度。
  write 毎イベントは危険 — microtask flush 単位のバッチイベント、または
  recompute / effect-run を一級イベントにする設計論点が新規に立つ。
- **見せる面**: graph 列挙 API（WeakRef で GC 寿命を変えないこと）/ resource status /
  For・Index。UI は `kind: "signals"` タブ出し分け（protocol §8 予約済み）。
  グラフ可視化は v1 テーブルで十分（有向グラフ描画は踏まない）。
- **dev.ts との関係**: 「dev.ts=警告 / hook=検査、統合しない」を維持。ただし警告の
  hook への複製発行（統合でなく転送）は Timeline に警告が並ぶ中間案として検討価値あり。

### P2-2: ドッグフーディング再評価（§11-1 の宿題）

- vanilla 化の根拠は実装で裏付けられ、恒久 UI を wcs-state 化する動機は弱い。
- 着地案: 恒久 UI は vanilla のまま、**「devtools を devtools で見る」example**
  （`wcs-devtools*` 既定除外を外す表示モード）をデモ性の見せ札にする。

### P2-3: P1 で意図的に落とした機能（小粒・フィードバック駆動）

1. Timeline フィルタ UI（種別 + state 名。§3.3 の未実装分・実装小）
2. ハイライトのスクロール追従（現状クリック時スナップショット + 2 秒消去、§11-4）
3. State ペイン更新粒度の最適化（G-U1 続き。巨大 state の実測が出てから）
4. 依存グラフ表示（static/dynamicDependency は pull 済み未表示。signals グラフ表示と
   UI 共通化を狙う）
5. token 配線一覧（commandTokenNames × binding 台帳の突合。subscriber 0 の
   **恒常的**警告 — Timeline は発火時しか出ない）
6. `$streams` バッジ（$streamStatus のツリー畳み込み）
7. パネル状態の sessionStorage 永続化 / モバイル表示
8. declared ビューは「表示専用」の線を維持（bindTextParser への追随はしない）

### P3: ブラウザ拡張（判断保留の継続）

- プロトコル準備は済み（生参照は原則 4 でオーバーレイ前提と明示済み。拡張化は
  devtools 側にシリアライズ層を足すだけでプロトコル不変更）。
- 発火条件を先に定義: 「オーバーレイで足りない実例（本番サイト検査・iframe 跨ぎ・
  DevTools パネル常設要望）が溜まったら」。コストは Manifest V3・審査・別リポ運用。

### 横断

- **リリース戦略**: P1 は P2 を待たず次 minor で出荷（state 計装同乗 + devtools 新規
  publish + example CDN 化）。P2-3 の優先度はリリース後のフィードバックで決める。
- **プロトコル進化**: signals は additive（version 1 のまま）。破壊的変更が要るのは
  「payload の生参照をやめる」時だけで、それは P3 でも不要（devtools 側変換で吸収）。
- **本番置き忘れ**: devtools は値編集 UI を誰にでも与える。script を入れなければ
  載らない構造だが、README に「本番ページに置かない」注意 + 環境別に外す運用例を
  一行足す（P2-3 と同時で可）。
- **バースト実測の宿題（G-P 続き）**: 1 万行リスト置換時の binding イベント量は未実測。
  jsfb ベンチ + devtools 接続状態の計測を P2 入りの受け入れに含める。

### 推奨順序

1. すぐ: P1 リリース + P2-3-1（フィルタ UI）級の低コスト改善
2. signals 移行 Phase 1-3 完了後: P2-1（識別子 API を移行計画のゲートに追加）
3. デモ需要が出たら: P2-2 の example 方式
4. 実需が溜まったら: P3
