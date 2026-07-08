# 出力状態の CSS 反映 — CustomStateSet (`:state()`) 横断導入 設計

- **日付**: 2026-07-09（同日改訂: デバッグ観測性の追加仕様 §3.8 を決定・反映）
- **ステータス**: 設計確定（決定ゲート通過済み・実装未着手）・変更計画付き
- **経緯**: `wcs-fetch[loading]` という CSS セレクタが（構文上有効だが）決してマッチしない問題の調査から、「出力状態を CSS から選択可能にする」横断設計に発展。7論点を提示し、以下の決定を得た。
- **関連**: [async-io-node-guidelines.md](async-io-node-guidelines.md)（§0 不変条件・§4.2 派生 getter）、[timing-and-firing-contract.md](timing-and-firing-contract.md)

## 0. TL;DR

全 I/O ノードの **boolean 出力状態を `ElementInternals.states`（CustomStateSet）に反映**し、CSS から `:state()` で選択可能にする。

```css
wcs-fetch:state(loading) ~ .spinner        { display: block; }
form:has(wcs-fetch:state(error)) .banner   { display: block; }
wcs-ws:state(connected) ~ .indicator       { color: green; }
wcs-permission:state(denied) ~ .fallback   { display: block; }
```

- **Core は無改変**。Shell が constructor で自分自身の `*-changed` イベントを購読し states を更新する（全 Core がイベントを Shell 要素自身に dispatch する既存不変条件を利用）
- 属性 reflect は**採用しない**（入出力混同が構造的に起きない `:state()` を採用。決定1・2・4）
- DevTools での観測は `debugStates` スナップショットゲッター＋ opt-in の `debug-states` 属性ミラーで担保（§3.8）
- 一斉変更は**可能**。ただし「Shell diff」と「テスト shim」の2スイープが不可分（§2）

## 1. 決定事項（確定済み・再議論しない）

| # | 論点 | 決定 |
|---|---|---|
| 1 | メカニズム | **CustomStateSet（`:state()`）**。属性 reflect は不採用 |
| 2 | 入出力の単方向性 | 決定1により論点消滅（`:state()` は外部から書けない） |
| 3 | 反映語彙 | 議論の通り（§3.2）。boolean observable＋派生 getter を反映、連続値・高頻度値は除外 |
| 4 | 命名・属性衝突 | 決定1により native 属性衝突は消滅。状態名規則のみ §3.3 で定義 |
| 5 | タイミング契約 | 議論の通り（§3.5）。timing-contract への節追加を含む |
| 6 | 一斉変更可否（実装） | 点検実施 → **可能**（§2） |
| 7 | 一斉変更可否（規範・テスト） | 点検実施 → **可能、ただしテスト shim 横展開と不可分**（§2） |
| 8 | デバッグ観測性（追加仕様） | **`debugStates` スナップショットゲッター＋`debug-states` 属性 opt-in の `data-wcs-state-*` ミラー**を採用（§3.8）。live な CustomStateSet の公開と常時属性反映は不採用 |

## 2. 点検結果: 一斉変更は可能か（決定6・7への回答）

全41ディレクトリを実査した（2026-07-09、2並列調査＋個別裏取り）。

### 2-1. 構造の均質性 — 機械的 diff の前提は成立

- 対象は Core/Shell 構造を持つ **I/O ノード系 33 パッケージ／37 タグ**（+ 対象外: state / router / signals / autoloader / server / vscode-wcs / poc-visual-editor、および fetch の補助要素 `wcs-fetch-header` / `wcs-fetch-body` / `wcs-infinite-scroll` = wcBindable なし）
- 全 Core が `constructor(target?) { this._target = target ?? this }` を持ち、イベントは例外なく Shell 要素自身に dispatch される → **Shell の自己リスナーで反映が完結し、Core は 1 行も変えない**
- Shell の自己 `addEventListener` には既存の前例がある（camera は constructor で2件、intersection / resize は connectedCallback で1件）
- `attachInternals` / `ElementInternals` / `CustomStateSet` の既存利用は **0 件**（純粋な新規追加）
- 大多数（約29パッケージ）は「2行 constructor＋observe/dispose 対称」の完全同型で、**同一テンプレの一括適用が可能**。個別手当てが要るのは4グループのみ（§6 Phase 3）:
  - **camera / recorder**: 重い constructor（shadow DOM・既存自己リスナー・visibilitychange 管理）に合流させる
  - **debounce / throttle**: `Throttle extends Debounce` でイベント接頭辞が動的（`wcs-debounce:` / `wcs-throttle:`）→ 反映マップも `eventPrefix` から生成する
  - **speech**: 独立2タグ（Speak / Listen）で反映対象イベント集合が別
  - **センサー4種＋tilt**: 反映対象が `error` のみ（boolean 出力を持たない）

### 2-2. 命名の揺れ — 既に統一されていた（懸案の事実上の決着）

io-node-batch-implementation-plan.md 末尾の未決事項「cancelled/error 呼称のノード横断統一」を全パッケージ実査した結果:

- `error` はプロパティ名・イベント名（`wcs-<ns>:error`）として **26 パッケージで完全に統一**
- `cancelled`（二重l）は picker 系4パッケージ（contacts / credential / eyedropper / share）で**統一**（`wcs-<ns>:cancelled-changed`）
- `abort` は command 名としてのみ、`canceled`（単数l）/ `aborted` / `*-failed` は error detail 内の下位コード文字列としてのみ出現し、**状態名・イベント名としての揺れは存在しない**

→ 状態名を凍結する前提条件はクリア済み。追加の改名作業は不要。

### 2-3. 唯一の構造的制約 — テスト環境

- happy-dom は全パッケージで `^20.0.11`（実体 20.10.6）に統一されているが、**最新版でも `attachInternals` / `ElementInternals` / `CustomStateSet` を実装していない**（実測: `this.attachInternals is not a function`）
- → Shell diff 単独ではテストが全滅する。**各パッケージ `__tests__/setup.ts` への shim 横展開が不可分の第2スイープ**（§3.6）
- 幸い全 I/O ノードの setup.ts は均質なコメントスタブで、挿入場所は統一されている

### 判定

**一斉変更は可能。**「①Shell diff（29 同型＋4グループ個別）＋②テスト shim＋テスト追加」をセットで、パッケージ単位に完結する機械的スイープとして展開できる。規範文書（guidelines / timing-contract）の追記は横断1回で済む（§5）。

## 3. 設計

### 3.1 メカニズム

Shell constructor（`super()` → `new Core(this)` の直後）で `attachInternals()` を取得し、以後 states を更新する。**never-throw（guidelines §3.6）を貫徹**する:

- `attachInternals` 不在（happy-dom・旧環境）→ `null` にして反映を静かに無効化
- 旧 Chromium（125 未満）は非ダッシュ状態名の `states.add()` が SyntaxError を投げる → 取得時に probe（`add("wcs-probe")` → `delete`）で検出し無効化（graceful degradation: CSS が当たらないだけで機能は完全動作）

対応ブラウザ（新構文 `:state(x)`）: Chrome/Edge 125+・Safari 17.4+・Firefox 126+（Baseline）。

### 3.2 反映語彙の規範

**反映する**:
1. wcBindable で公開される **boolean 出力 observable**（専用 `*-changed` イベントを持つもの。例: `loading` / `connected` / `active` / `held` / `running`）
2. **boolean 派生 getter**（guidelines §4.2。例: permission の `granted` / `denied` / `prompt` / `unsupported`、orientation の `portrait` / `landscape`）— enum はこの既存規約を通してのみ反映する（新しい enum 展開規則は作らない）
3. **`error` の存在**（`wcs-<ns>:error` の detail が非 null なら on、null クリアで off。fetch 実装で detail=null のクリア発火を確認済み）

**反映しない**:
- 連続値・高頻度値（sensor reading・tilt の `alpha/beta/gamma`・座標・`progress`・`ratio`・`width/height`・`tick/elapsed`・`charIndex`・`duration`・`angle`・`count/total`）
- 連続ストリームイベント（reading / boundary / tick）からしか導出できない boolean（tilt の `absolute`）
- データ値（`message` / `value` / `entry` / 配列）
- 派生 getter が存在しない enum（clipboard の read/write permission、geolocation / camera / listen / tilt の permission、idle の `screenState`、network の `effectiveType`）→ **v1 対象外**。getter 追加は additive な wcBindable 変更として別提案（§7）

### 3.3 状態名

- 状態名 = wcBindable のプロパティ名（派生 getter 名）を **kebab-case 化**したもの。単語1つならそのまま（`loading`, `cancelled`, `granted`）。複数語は変換（`saveData` → `save-data`）
- CustomStateSet は大文字小文字を区別するため、camelCase をそのまま使わない（CSS 慣習との整合）
- 相互排他群（permission の4値など）は同一イベントから全状態を同時に set/delete する（§3.4 のマップがこれを自然に表現する）

### 3.4 配線方式 — canonical snippet

Shell にのみ以下を追加する（Core 無改変）。パッケージ間でコードは共有せず、他の規約同様**コピー・パターン**とする（自己完結・依存ゼロ原則）:

```ts
private _internals: ElementInternals | null = null;

// デバッグ用スナップショット（契約外・§3.8）。live な CustomStateSet は返さない。
get debugStates(): string[] {
  return this._internals ? [...this._internals.states] : [];
}

private _initInternals(): ElementInternals | null {
  // never-throw (guidelines §3.6): attachInternals 不在（happy-dom / 旧環境）や
  // 非ダッシュ状態名を拒む旧 Chromium (<125) では反映を静かに無効化する。
  try {
    if (typeof this.attachInternals !== "function") return null;
    const internals = this.attachInternals();
    internals.states.add("wcs-probe");
    internals.states.delete("wcs-probe");
    return internals;
  } catch {
    return null;
  }
}

private _wireStates(map: Record<string, (detail: any) => Record<string, boolean>>): void {
  if (this._internals === null) return;
  const states = this._internals.states;
  for (const [event, toStates] of Object.entries(map)) {
    this.addEventListener(event, (e) => {
      const debug = this.hasAttribute("debug-states"); // §3.8 opt-in ミラー
      for (const [name, on] of Object.entries(toStates((e as CustomEvent).detail))) {
        try {
          // 式文の三項演算子は ESLint no-unused-expressions に抵触するため if/else（パイロットで確定）
          if (on) { states.add(name); } else { states.delete(name); }
        } catch { /* never-throw */ }
        if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
      }
    });
  }
}
```

constructor での利用例（fetch）:

```ts
constructor() {
  super();
  this._core = new FetchCore(this);
  this._internals = this._initInternals();
  this._wireStates({
    "wcs-fetch:loading-changed": (d) => ({ loading: d === true }),
    "wcs-fetch:error":           (d) => ({ error: d != null }),
  });
}
```

相互排他群（permission）:

```ts
this._wireStates({
  "wcs-permission:change": (d) => ({
    granted: d === "granted", denied: d === "denied",
    prompt: d === "prompt", unsupported: d === "unsupported",
  }),
});
```

継承構造（throttle）はマップを `eventPrefix` から組み立てる:

```ts
const prefix = (this.constructor as typeof Debounce).eventPrefix;
this._wireStates({ [`${prefix}:pending-changed`]: (d) => ({ pending: d === true }) });
```

### 3.5 タイミング契約（timing-and-firing-contract へ横断節として追記）

1. **states は「最後に発火した `*-changed` / `:error` イベントの同期写像」である**（プロパティの写像ではない）。反映は当該イベントの dispatch 中に同期実行される
2. Shell の反映リスナーは **constructor（= upgrade 時）で登録**され、以後解除しない（自己参照のためリークなし）。upgrade 後に登録された利用者リスナーからは**常に反映済みの states が見える**。upgrade 前に登録されたリスナーは反映前に走り得る（契約として明記）
3. 同値ガードは**イベント側の契約に従う**。同値ガードなしの無条件発火（fetch の `loading-changed`、timing-contract §1.1）でも `add`/`delete` は冪等なので観測可能な差異はない
4. **disconnect で states は消さない**（Core 状態と同じく持続）。`dispose()` が状態リセットのイベントを発火するノードでは states も自動追従する。初期状態は全オフ（全 Core の反映対象初期値が false 系であることを確認済み）

### 3.6 テスト戦略（第2スイープ・Shell diff と不可分）

- 各パッケージ `__tests__/setup.ts`（現在コメントスタブ）に共通 shim を追加:
  `HTMLElement.prototype.attachInternals` が**未定義のときのみ** FakeElementInternals（`states` = 素の `Set` 互換）を返す定義を挿入し、`WeakMap<Element, FakeElementInternals>` で記録。`__tests__/helpers` に `getStates(el)` 検査ヘルパ
  （「未定義のときのみ」により、将来 happy-dom が実装しても衝突しない）
- テストテンプレ（タグごとに 5〜8 本、記述は日本語）:
  1. 初期状態は全オフ
  2. 状態イベントで on になる（`getStates(el).has("loading")`）
  3. 逆イベントで off に戻る
  4. `error` が detail 非 null で on / null クリアで off
  5. `attachInternals` 不在でも throw しない（shim を外した要素で構築。`debugStates` は空配列を返す）
  6. （相互排他群のみ）1イベントで全状態が整合的に切り替わる
  7. `debugStates` はスナップショットを返す（返り値を変更しても states に影響しない）
  8. `debug-states` 属性ありで `data-wcs-state-*` がトグルされ、属性なしでは一切書かれない
- ガード分岐（`_internals === null` 経路）を 5 で踏むため、カバレッジ **100 / 97+ / 100 / 100 を維持可能**

### 3.7 SSR

`:state()` は HTML にシリアライズできないため、SSR 初期ペイントには状態スタイルが乗らない（**受容済みの制約**。決定1のトレードオフ）。@wcstack/server は無改変。初期ペイント対策が要る場面には `wcs-x:not(:defined)` パターンを README で併記する。

### 3.8 デバッグ観測性（決定8）

**動機**: CustomStateSet には観測性の穴がある。`attachInternals()` は同一要素に2回呼べない（2回目は NotSupportedError）ためコンソールから states を覗けず、DevTools の Elements パネルは custom state を表示しない。`$0.matches(':state(x)')` は使えるが、状態名を知らないと列挙できない。

**1. `debugStates` ゲッター（全 Shell 標準装備）**

- 現在 on の状態名の**スナップショット配列**を返す（§3.4 スニペット参照）
- **live な CustomStateSet を返してはならない**（MUST NOT）— 返すと `el.debugStates.add(...)` で外部書き込みが可能になり、「`:state()` は外から書けない」という決定1・2の核心が崩れる
- `_internals` null（happy-dom・旧環境）では空配列
- **契約外**: wcBindable に載せない（バインド対象にしない）。README で「デバッグ用・セマンティクス保証外」と明記

**2. `debug-states` 属性による opt-in 属性ミラー**

```html
<wcs-fetch url="/api" debug-states></wcs-fetch>
<!-- → 状態変化のたびに data-wcs-state-loading / data-wcs-state-error がトグルされ、
     Elements パネルで変更がリアルタイムにハイライトされる -->
```

- **既定 OFF**。`debug-states` 属性が付いている要素のみ、states 更新と同時に `data-wcs-state-<name>` 属性をトグルする
- 属性名は **`data-wcs-state-*` 名前空間**（利用者の `attr.data-*` バインド圏との衝突回避）
- **常時反映は不採用**: 棄却済みの属性 reflect（§7）の再導入となり、`[data-wcs-state-*]` への CSS 依存が事実上の公開 API 化する（Hyrum の法則）。本番の style recalc / MutationObserver / スナップショット差分コストも全利用者に転嫁される。README には「**CSS はこの属性ではなく `:state()` に書くこと**」を明記する
- `debug-states` は**非 observed の入力属性**。イベント発火時に `hasAttribute` で都度判定する（付け外しは次のイベントから反映。外した後の残存 `data-wcs-state-*` は掃除しない — デバッグ用途では許容し、その旨を README に記す）
- `_internals === null` の環境ではミラーも無効（states の「表示」であって代替サーフェスではない。旧ブラウザ向けフォールバックとして使わせない）

## 4. パッケージ別 反映状態マップ（v1 確定語彙）

| タグ | 反映する状態 | 備考 |
|---|---|---|
| `wcs-fetch` | `loading` `error` | パイロット |
| `wcs-upload` | `loading` `error` | `progress` 除外 |
| `wcs-storage` | `loading` `error` | |
| `wcs-ws` | `connected` `loading` `error` | `readyState` は既存 boolean で代替済み |
| `wcs-sse` | `connected` `loading` `error` | |
| `wcs-broadcast` | `error` | boolean 出力なし |
| `wcs-worker` | `running` `error` | |
| `wcs-timer` | `running` | error なし |
| `wcs-debounce` / `wcs-throttle` | `pending` | eventPrefix 動的（§3.4） |
| `wcs-clipboard` | `loading` `monitoring` `error` | permission 2系統は getter なし→v1外 |
| `wcs-contacts` / `wcs-credential` / `wcs-eyedropper` / `wcs-share` | `loading` `cancelled` `error` | picker 系4種同型 |
| `wcs-fullscreen` | `active` | error 未公開（公開追加はしない） |
| `wcs-pointer-lock` | `active` | 同上 |
| `wcs-pip` | `active` | 同上 |
| `wcs-network` | `save-data` `supported` | kebab-case 変換の唯一の例 |
| `wcs-intersect` | `visible` `observing` `intersecting` | `ratio` 除外 |
| `wcs-resize` | `observing` | box 値除外 |
| `wcs-screen-orientation` | `portrait` `landscape` `error` | イベント ns は `wcs-orientation:` |
| `wcs-geo` | `watching` `loading` `error` | permission は getter なし→v1外 |
| `wcs-idle` | `active` `error` | `screenState` は getter なし→v1外 |
| `wcs-wakelock` | `held` `error` | |
| `wcs-permission` | `granted` `denied` `prompt` `unsupported` | 相互排他群（1イベント→4状態） |
| `wcs-notify` | `granted` `denied` `prompt` `unsupported` `error` | 同上＋error |
| `wcs-defined` | `defined` `error` | ともに `wcs-defined:change` の detail から導出 |
| `wcs-camera` | `active` `error` | permission 2系統は getter なし→v1外 |
| `wcs-recorder` | `recording` `paused` `error` | `duration` 除外 |
| `wcs-speak` | `speaking` `paused` `pending` `unsupported` `error` | |
| `wcs-listen` | `listening` `unsupported` `error` | permission は getter なし→v1外 |
| `wcs-tilt` | `error` | `absolute` は連続 `:change` 派生→除外 |
| `wcs-accelerometer` / `wcs-gyroscope` / `wcs-magnetometer` / `wcs-ambient-light-sensor` | `error` | reading は除外 |

対象外: `wcs-state` / `wcs-ssr` / `wcs-autoloader`（観測可能状態なし）、`wcs-fetch-header` / `wcs-fetch-body` / `wcs-infinite-scroll` / router の構造要素（wcBindable なし）。`wcs-route` の `active` は §7 参照。

## 5. 規範文書への反映（横断1回）

1. **async-io-node-guidelines.md**:
   - §0 不変条件に **#10** を追加: 「boolean 出力 observable と error 存在を CustomStateSet に反映する（`:state()` 対応）。反映は Shell のみで行い Core に持ち込まない。attachInternals 不在環境では静かに無効化（never-throw）」
   - **§4.5（新設）**「出力状態の CSS 反映」: §3.4 の canonical snippet・語彙規則（§3.2）・状態名規則（§3.3）・デバッグ観測性（§3.8: `debugStates` スナップショット MUST / live Set 返却 MUST NOT / `debug-states` opt-in ミラー）を規範化
2. **timing-and-firing-contract.md**: 横断節（§3 と同格）として §3.5 の 4 契約を追記。以後の新規ノードは tag-design doc に反映状態マップを1表含めることを guidelines §1 のチェックリストに追加
3. 本設計の位置づけ: これは**ノード実装規約**であり wc-bindable-protocol（プロトコル仕様）の変更ではない。spec-proposal は不要

## 6. 変更計画

前提: **v1.16.0 リリーストレインは堰き止めない**。本件は全て 1.16.0 発車後に着手し、**1.17.0**（additive minor）で出荷する。

### Phase 0 — 設計確定（本ドキュメント）
- 命名統一の懸案は点検で決着済み（§2-2）。fullscreen / pointer-lock / pip の error 公開は**行わない**と決定（scope 外の API 追加をしない）
- 完了条件: 本 doc の承認

### Phase 1 — パイロット（fetch、0.5〜1日）
1. `Fetch.ts` に §3.4 テンプレ適用（`loading` / `error`）
2. `__tests__/setup.ts` shim ＋ `helpers` の `getStates()` ＋ テストテンプレ 5 本（§3.6）
3. guidelines §0-10 / §4.5、timing-contract 横断節を起草（規範はパイロットと同時に固める）
4. 実ブラウザ E2E: 既存 example（state-fetch 系）に `:state(loading)` スピナーを追加し、Chrome / Safari / Firefox で目視確認
- 完了条件: fetch のカバレッジ 100/97+/100/100 維持・E2E 目視 OK・テンプレの最終形確定

### Phase 2 — 標準テンプレ組の一斉展開（29 タグ、3 バッチ、各 2〜4時間）
機械的スイープ。1 バッチ = 1 ブランチ/PR（io-node バッチ実装の前例に倣う）:
- **2a 非同期 I/O 系**: upload / storage / websocket / sse / broadcast / worker / timer
- **2b picker・モニタ系**: contacts / credential / eyedropper / share / clipboard / geolocation / idle / wakelock / network
- **2c 表示・permission 系**: fullscreen / pointer-lock / pip / intersection / resize / screen-orientation / permission / notification / defined / tilt / センサー4種
- 各パッケージの diff: Shell 約+35行（`debugStates` / debug ミラー込み）・setup.ts 約+15行・helpers 約+10行・テスト+5〜8本
- 完了条件: バッチ内全パッケージのカバレッジ維持・`npm run build` 通過

### Phase 3 — 個別手当て組（1日）
- **camera / recorder**: 既存の重い constructor・自己リスナーと共存させる（`_wireStates` は既存リスナー登録の後に置く）
- **debounce / throttle**: `eventPrefix` 動的解決でマップ生成（§3.4）。Throttle 側のテストで `wcs-throttle:pending-changed` 経由の反映を独立検証
- **speech（Speak / Listen）**: 2タグ各々にマップ定義
- 完了条件: 同上＋throttle の継承経路テスト

### Phase 4 — ドキュメント・ショーケース（1〜2日）
- 対象 33 パッケージの README.md / README.ja.md に「CSS スタイリング（`:state()`）」節をテンプレで追加（対応状態の一覧表＋スニペット）
- ルート README に横断 1 節（対応ブラウザ・graceful degradation の注記込み）
- examples に `:state()` ショーケースを 1 本（fetch ローディング＋ws 接続インジケータ＋permission フォールバックの複合、権限不要のものをファーストビューに）

### Phase 5 — リリース
- **1.17.0**（minor・additive）として全パッケージ一括。リリースノートに「`:state()` 対応」を筆頭機能として記載し、対応ブラウザと旧環境での挙動（スタイルが当たらないだけ）を明記
- 総見積: 実働 約1週間相当

## 7. やらないこと・フォローアップ候補（別判断）

**やらない（v1 スコープ外）**:
- 属性 reflect の**常時**適用（決定1で不採用。将来も再訪しない — `:state()` と二重化するコストに見合わない。§3.8 の `debug-states` opt-in ミラーは唯一の例外であり、契約面には昇格させない）
- fullscreen / pointer-lock / pip への error プロパティ公開（wcBindable の変更は本件と独立）
- 連続値の量子化反映（progress の 25% 刻み等 — 需要が出てから）

**フォローアップ候補（additive・需要駆動）**:
1. **派生 boolean getter の補完**: clipboard（read/write permission）・geolocation・camera（2系統）・listen・tilt の permission、idle の `screen-locked`、network の `effective-type` 群。§4.2 整合の欠落補完であり、追加すれば §3.2 のルールで自動的に反映対象になる
2. **`wcs-route` の `active`**（router パッケージ）: I/O ノード外だが `wcs-route:active-changed` という同型イベントを既に持ち、ナビゲーション強調（`wcs-link` 側含む）として**本件で最も実用価値の高い応用**。router は Shell/Core 構造が異なるため個別設計で別途判断
3. happy-dom が ElementInternals を実装したら shim を撤去（「未定義のときのみ定義」なので放置しても無害）

## 8. リスク と 緩和

| リスク | 緩和 |
|---|---|
| 旧 Chromium（<125）でスタイルが当たらない | probe による静かな無効化（機能は完全動作）。README に対応表を明記 |
| happy-dom が将来 attachInternals を実装し shim と衝突 | shim は「未定義のときのみ定義」で前方互換 |
| テスト +150〜200 本の恒久メンテ負担 | テンプレ化された同型テストのみ。guidelines §4.5 に雛形を規範として置き逸脱を防ぐ |
| upgrade 前登録リスナーが反映前の states を見る | timing-contract に契約として明記（§3.5-2）。実害のある利用形態は稀 |
| `:state()` の知名度不足で使われない | Phase 4 のショーケースと README 節で「CSS だけでローディング UI」を看板化。SSR 制約も正直に併記 |
| `data-wcs-state-*` に CSS 依存が生まれ事実上の API 化する | 既定 OFF の opt-in・`debug-` を冠した属性名で意図を明示・README で「CSS は `:state()` に書く」を明記（§3.8） |
| `debugStates` が非公式バインド対象として使われる | wcBindable 非掲載＋スナップショット返却（書き込み不能）＋「保証外」の README 明記 |
