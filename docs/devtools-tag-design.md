# wcs-devtools（ページ内オーバーレイ DevTools）設計 (DevTools Tag Design Notes)

- Status: **設計ドラフト（2026-07-14・未実装）** — ランタイム接点の規範は
  [devtools-hook-protocol.md](devtools-hook-protocol.md)（以下「protocol」）
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
- **G-U2: ピッカーのイベント占有** — pick モード中の click を capture+stopPropagation で
  奪うか、奪わず選択のみにするか。既定は「奪う」(誤操作防止) で実装し実ブラウザで判定。
- protocol 側ゲート G-R / G-P は protocol 文書参照。
