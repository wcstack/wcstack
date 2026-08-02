# 実装計画: `@wcstack/midi` → `@wcstack/audio`

- **状態**: 🟢 実行中（2026-08-02）。前提の [handle graph wiring ADR](./architecture-hardening/14-handle-graph-wiring.md) は G1〜G6 すべて採択済みで、全 Phase が着手可能。
- **設計正本**: [midi-tag-design.md](./midi-tag-design.md) / [audio-tag-design.md](./audio-tag-design.md) / [ADR 14](./architecture-hardening/14-handle-graph-wiring.md)
- **原型**: [examples/synth-playground/wcs-synth.js](../examples/synth-playground/wcs-synth.js)（1063行 JS・Playwright スモーク 14/14 安定）。挙動は実証済みであり、本計画は **「動く原型を wcstack の骨格に載せ替える」** 作業を規定する。ゼロからの設計ではない。

---

## 0. ロードマップ

| Phase | 内容 | 規模の見積り |
|---|---|---|
| **B** | PoC: Core だけで音を出す（G1 案D の実証） | ✅ 完了・約 750 行（Core 560 ＋ 検証系）・使い捨て |
| **A** | `@wcstack/midi` 単独昇格 | src 約 500 行 / テスト 55〜65 本 |
| **C** | `@wcstack/audio` パッケージ本体 | src 約 2,200〜2,800 行 / テスト 200〜260 本 |
| **D** | example 移植（synth-playground をパッケージ利用に） | 既存 example の書き換え |
| **E** | 規範文書の追補（契約・ガイドライン） | 4 文書に節を追加 |

ADR 採択後は **B を先に実施する**（300 行で C の構造前提を検証でき、失敗した場合の手戻りが最小になるため）。

Phase C は完成時点で **`state`（16,055行）/ `router`（2,837行）に次ぐ規模**になり、camera（2,018行）・speech（2,466行）を上回る。単一 PR にはしない（§7）。

---

## Phase A — `@wcstack/midi`

### A-1. 雛形
`packages/permission/` をコピー（最小構成の参照実装）→ `packages/midi/` にリネーム。`package.json` / `rollup.config.js` / `vitest.config.ts` / `eslint.config.js` / `tsconfig.json` を機械置換。`src/auto/auto.js` と `auto.min.js` は permission のものを写経して `bootstrapMidi` を呼ぶ形に。

### A-2. 実装
| ファイル | 内容 |
|---|---|
| `src/types.ts` | `IMidiMessage` / `IMidiDevice` / `MidiMessageType` / Core の値・入力・コマンド型 |
| `src/core/MidiCore.ts` | `requestMIDIAccess` ＋ permission 二相 ＋ ポート列挙 ＋ `statechange` ＋ メッセージ正規化 ＋ `send` ＋ `_gen`。**DOM 非依存（MUST）** |
| `src/midi/parseMessage.ts` | status バイト → `{ type, channel, note, velocity, control, value }`。**velocity 0 の note-on は note-off に正規化**（設計 §2.1） |
| `src/components/Midi.ts` | Shell。`upgradeProperties` → CustomStateSet 反映 → `connectedCallbackPromise` |
| `src/protocol/wcBindable.ts` | `scripts/sync-protocol-types.mjs` で生成（手書きしない） |

### A-3. テスト（目標 55〜65 本・カバレッジ 100 / 97+ / 100 / 100）
`FakeMIDIAccess` / `FakeMIDIInput` / `FakeMIDIOutput` を `__tests__/helpers/` に置く（intersection の `FakeIntersectionObserver` 同型）。

重点:
- メッセージ正規化の全分岐（noteon / noteoff / **velocity 0 の noteon** / cc / pitchbend / program / aftertouch / sysex / 未知 status）
- `channel` 属性フィルタ（境界: 1 と 16、範囲外）
- デバイス着脱で `devices` が **fresh array** として再 publish される（producer snapshot contract）
- `_gen`: `dispose()` 後に解決した `requestMIDIAccess` が listener を張らない
- `unsupported`（`navigator.requestMIDIAccess` 不在）・permission denied・sysex 拒否
- `send` の位置引数素通し（`number[]` と `Uint8Array` の両方）
- CustomStateSet 反映と `attachInternals` 不在環境での静かな無効化

### A-4. example / README
- `packages/midi/examples/midi-fader/` — MIDI コントローラのフェーダーで `<wcs-state>` の値を駆動する最小デモ。**synth に一切依存しないこと**が「Web MIDI は独立した I/O ノードである」の実証になる。
- `README.md` / `README.ja.md`（設計 §7 の罠を明記）＋ **headless（Core）利用の節**（ガイドライン §9）。

### A-5. 受け入れ条件
1. `npm test` / `npm run test:coverage` / `npm run lint` / `npm run build` が全て通る
2. 設計 §9 の★3件（タグ構成・`auto` 属性・`input` 省略時の挙動）が確定して README に反映されている
3. Chromium 実機で MIDI デバイスからの入力が state に届く（手動確認・MIDI 機材が必要なため CI 対象外）

---

## Phase B — PoC: Core だけで音を出す【✅ 完了 2026-08-02・6/6 合格（3回反復で 18/18）】

### B-0. 結果サマリ

| 成果物 | 内容 |
|---|---|
| [`e2e/fixtures/audio-graph-poc/AudioGraphCore.js`](../e2e/fixtures/audio-graph-poc/AudioGraphCore.js) | `Patch` → グラフ。DOM 参照ゼロ。約 560 行 |
| [`e2e/fixtures/audio-graph-poc/instrument.js`](../e2e/fixtures/audio-graph-poc/instrument.js) | 任意の `BaseAudioContext` の結線を記録するラッパ（実 context にもモックにも掛かる） |
| [`e2e/fixtures/audio-graph-poc/FakeAudioContext.js`](../e2e/fixtures/audio-graph-poc/FakeAudioContext.js) | ヘッドレス代替。`AudioParam` のオートメーション呼び出しを記録 |
| [`e2e/tests/audio-graph-poc.spec.ts`](../e2e/tests/audio-graph-poc.spec.ts) | B-3 の6条件を実 Chromium で検証 |

**得られた確証**:
- `Patch`（plain object）だけで音が出る。DOM も カスタム要素も一切使っていない → **G1 案D は成立する**。
- `AudioNode` は Core の外に一度も出ていない → **G2 の「内部完結」は構造として実現可能**。
- モック context と `OfflineAudioContext` のエッジ集合が **完全一致**（20 エッジ）→ Phase C のテスト戦略（モックで形状・実ブラウザで信号）の土台が成立。
- ボイス回収が **`currentTime` の前進だけ**で起きる（コード中にタイマーが1つも無い）→ 設計 §6-1 の是正が実装可能と確認。

**設計へのフィードバック**:
- `structureKey()`（トポロジだけを直列化し、数値を除外するハッシュ）で **`setPatch` が rebuild と live 更新を自動判別する**。呼び出し側は属性の種類を分類する必要がなく、いつでも patch 全体を再投入してよい。→ Shell が大幅に簡素化される。設計 §5 の「冪等な `setPatch`」はこの形で実現する。
- **リミッター（`threshold = -18 dBFS` ≒ 振幅 0.126）は想像よりずっと早く効く**。振幅ベースの assert はこの閾値より下で組まないと「音が増えても RMS が増えない」ため成立しない。Phase C のテストにも同じ制約が効く。
- C-2 の是正候補 #4（analyser の `destination` 直結）は **誤り**だった。エッジ実測の結果、gain 0 の keep-alive は信号を運ばず、`destination` 以外に繋ぎようがない（master へ戻すとフィードバックループ）。原型のままで正しい。

### B-1. 目的とスコープ

**目的**: 「DOM を歩かずに `Patch`（plain object）だけで音が出る」ことを確認し、Core / Shell 境界の設計が成立することを実証する。ここが崩れると Phase C の構造が全部変わる。

**スコープ（最小・使い捨て）**: `e2e/fixtures/audio-graph-poc/` に置き、原型の `WcsSynth._buildScope` から DOM 依存を剥がした Core を書く。タグは作らない。Phase C で `packages/audio/src/core/AudioGraphCore.ts` に置き換わる。

```js
const patch = {
  nodes: [{ kind: "osc", key: "o1", params: { frequency: 440 },
            children: [{ kind: "gain", key: "g1", params: { gain: 0.2 } }] }],
  voices: [],
};
const core = new AudioGraphCore();
core.setPatch(patch);
core.noteOn(69);
```

### B-2. 検証手段: `OfflineAudioContext`【重要】

「音が出る」を主観でなく**サンプル値で証明する**。`OfflineAudioContext` は

- **ユーザージェスチャを必要としない**（`AudioContext` の autoplay ゲートを回避できる）
- **実時間より速くレンダリングし、結果を `AudioBuffer` として返す**（決定的・再現可能）
- headless Chromium で動くので **Playwright から CI で回せる**

したがって Core は **`BaseAudioContext` を注入可能**にしておく（設計 §4 の config 差し替えがそのまま効く）。これは Phase C のテスト戦略を「モックでの形状検証」＋「実ブラウザでの信号検証」の2階建てにする土台でもある。

### B-3. 証明すべきこと（受け入れ条件）
1. **`Patch` から音が出る（DOM ゼロ）** — `OfflineAudioContext` でレンダリングした buffer の RMS が閾値を超える
2. `setParam("o1", "frequency", 880)` が rebuild なしで反映される — レンダリング結果のゼロ交差数が周波数に追従する
3. `voices` 付き `Patch` でポリフォニーが動く — 和音のレンダリング振幅が単音を上回り、`poly` 上限でスティールが起きる
4. `setPatch` に同一構造を渡しても rebuild しない（冪等）
5. **モック `AudioContext` に同じ `Patch` を食わせると、接続エッジの集合が実 context と同型になる**（→ Phase C のテスト戦略の土台）
6. **`env` の release 後、ボイスが `currentTime` の前進だけで回収される**（`setTimeout` に依存しない・設計 §6-1）

---

## Phase C — `@wcstack/audio`

### C-0. パッケージ構成
```
packages/audio/
  src/
    auto/auto.js, auto.min.js
    core/
      AudioGraphCore.ts        # 中核。Patch → グラフ。DOM 非依存（MUST）
      builders/                # kind ごとの AudioNode 構築（osc/noise/biquad/gain/delay/shaper/env/lfo/analyser）
      VoiceAllocator.ts        # ポリフォニー・ノートスティール・遅延スイープ回収
      context.ts               # Symbol.for 経由の共有 AudioContext（config 差し替え可）
    patch/
      types.ts                 # Patch / PatchNode（公開型）
      compilePatch.ts          # DOM サブツリー → Patch（Shell 側・DOM 依存）
      resolveRef.ts            # getRootNode() 起点の id 解決
    components/
      Audio.ts                 # <wcs-audio> ルート Shell
      AudioNodeShell.ts        # ノードタグ共通基底（descriptor のみ・key 保持）
      Osc.ts / Noise.ts / Biquad.ts / Gain.ts / Delay.ts / Shaper.ts / Env.ts / Lfo.ts / Analyser.ts
      Voice.ts
    bootstrapAudio.ts / config.ts / registerComponents.ts / raiseError.ts / types.ts / exports.ts
    protocol/wcBindable.ts     # 生成物
  __tests__/
    helpers/FakeAudioContext.ts
    *.test.ts
```

`exports.ts` から必ず出すもの: `bootstrapAudio` / `getConfig` / `AudioGraphCore` / `Patch`・`PatchNode` 型 / 全 Shell クラス（`WcsAudio` / `WcsOsc` / …。[feedback: Shell クラス export](../CLAUDE.md) 準拠）。

### C-1. 実装順
1. **`context.ts`** — 共有 `AudioContext`（`Symbol.for("@wcstack/audio.context")`・config で差し替え可）、`state` 監視、`resume`、unsupported フォールバック。
2. **`patch/types.ts`** — `Patch` / `PatchNode`。ここが Core/Shell の唯一の契約面。
3. **`AudioGraphCore`** — Phase B の PoC を TS 化。2 パス構築（入れ子に沿って生成 → id 参照を解決）、`setParam` / `setProp`、`dispose`、`_gen`、never-throw、`ready`。
4. **`VoiceAllocator`** — ポリフォニー、最古ノートスティール、per-voice gain、暗黙の安全エンベロープ、**audio クロック基準の遅延スイープ回収**（設計 §6-1）。
5. **`AudioNodeShell`（基底）** — `key` 採番、数値属性 → `core.setParam` 転送、構造属性 → dirty マーク、`upgradeProperties`。**`AudioNode` を保持しない**。
6. **各ノードタグ Shell** — 基底 ＋ `static wcBindable`（`properties: []`）＋ 属性定義。ほぼ宣言のみ。
7. **`<wcs-audio>` ルート Shell** — `compilePatch` の呼び出し、絞り込み済み `MutationObserver`、microtask coalesce、master gain ＋ limiter、`noteOn` / `noteOff` / `allNotesOff`、CustomStateSet、`connectedCallbackPromise`、`adoptedStyleSheets` によるスタイル適用。
8. **`<wcs-analyser>`** — `command.sample` → fresh `Uint8Array` → `wcs-analyser:frame`。master 経由の常時 pull パスと `statechange` 再接続（設計 §7）。

### C-2. 原型から必ず是正する 5 点（＋是正不要と判明したもの 1 点）
| # | 原型 | 是正 |
|---|---|---|
| 1 | `MutationObserver` が `subtree: true` で無差別 → 無関係な DOM 変更で音が切れる（[:538](../examples/synth-playground/wcs-synth.js#L538)） | audio タグ関連の変異だけに絞る |
| 2 | rebuild の coalesce が `setTimeout(0)`（[:596](../examples/synth-playground/wcs-synth.js#L596)） | microtask（横断契約 §3） |
| 3 | id 解決が `document.getElementById` / `querySelector`（[:650](../examples/synth-playground/wcs-synth.js#L650)・[:827](../examples/synth-playground/wcs-synth.js#L827)） | `getRootNode()` 起点 ＋ ルートサブツリー限定 |
| 4 | ~~analyser が `ctx.destination` 直結でリミッターを迂回~~ → **是正不要**。gain 0 の keep-alive は信号を運ばず、`destination` へ繋ぐ以外に選択肢がない（master へ戻すとフィードバックループ）。Phase B のエッジ実測で確認済み。常時 pull と `statechange` 再接続はそのまま**維持** |
| 5 | `document.head` へグローバル CSS 注入（[:1050](../examples/synth-playground/wcs-synth.js#L1050)） | `getRootNode().adoptedStyleSheets` |
| 6 | ボイス回収が `setTimeout` → バックグラウンドタブで回収されず蓄積（[:499](../examples/synth-playground/wcs-synth.js#L499)） | audio クロック基準の遅延スイープ |

### C-3. テスト戦略【本パッケージ最大の作業・目標 200〜260 本】

happy-dom に Web Audio は無い。`__tests__/helpers/FakeAudioContext.ts` を自前で用意する。

```ts
// 記録するもの: ノード生成・connect/disconnect のエッジ集合・AudioParam のオートメーション列
class FakeAudioContext {
  currentTime = 0;                 // テストが手動で進める（決定的）
  state: "suspended" | "running" | "closed" = "suspended";
  readonly edges = new Set<string>();   // "osc#1 -> biquad#2" / "lfo#3 -> biquad#2.frequency"
  readonly created: FakeNode[] = [];
  createOscillator() / createGain() / createBiquadFilter() / ...
}
```

- **グラフ形状のアサーション**: エッジ集合を正規化した文字列にして比較するヘルパ（`expectGraph(core, ["osc:o1 -> gain:g1", "gain:g1 -> master"])`）。Phase B-2-5 で同型性を確認済みの前提に立つ。
- **オートメーションのアサーション**: `FakeAudioParam` が `setValueAtTime` / `linearRampToValueAtTime` / `setTargetAtTime` / `cancelScheduledValues` の呼び出しを時刻つきで記録する。ADSR の形は「スケジュール列」として検証する（実波形は検証しない）。

重点項目:
1. **構築** — 入れ子チェーン / 葉のマスター接続 / `out=` の多対一 / `out="id.param"` / `param=` の親解決 / 未解決参照の `warn`（never-throw）
2. **live 更新 vs rebuild** — 数値属性で rebuild が起きない、構造属性で起きる、無関係な DOM 変更で起きない、`setPatch` の冪等性（設計 §5 の表を1テスト1行で網羅）
3. **ボイス** — poly 上限でのスティール、同一ノート再打鍵、release 後の回収、ゲート無しパッチの安全エンベロープ、**`currentTime` を進めるだけでの回収**（タイマーに依存しないこと）
4. **ライフサイクル** — `disconnectedCallback` で全ノード `disconnect` ＋ 全 source `stop`、再接続、`_gen`
5. **context** — `Symbol.for` 共有、config 差し替え、`suspended` のまま `noteOn`、unsupported、SSR（`AudioContext` 不在）
6. **analyser** — fresh 配列であること（2回の `sample` が別インスタンスを返す）、`statechange` での再接続
7. **CustomStateSet** — `:state(running)` 等の反映と `attachInternals` 不在環境での無効化

**カバレッジ 100 / 97+ / 100 / 100 を維持する。** 実音の正しさはモックでは検証できない → Phase C-4 が担う。

### C-4. 実ブラウザ検証（Playwright）
原型のスモーク 14 項目（グラフ形状・各段での可聴信号・ボイスライフサイクル・和音割り当て・ポインタ操作）を `e2e/` に移植し、**パッケージ版でも 14/14 が再現すること**を移植完了の判定基準にする。C-2 の是正 6 点はここで回帰を見る（特に #4 analyser の常時 pull と #6 バックグラウンド回収）。

---

## Phase D — example 移植

- `examples/synth-playground/` を `@wcstack/audio` 利用に書き換える。`wcs-synth.js` は削除し、**`<wcs-keys>` だけを example ローカルのコンポーネント**として残す（ADR G6）。
- オシロは `<wcs-analyser>` ＋ `<wcs-raf>` ＋ example の canvas 描画に分解する。**「描画を持たないパッケージでも同じ絵が描ける」ことの実証**を兼ねる。
- スライダーは生の属性書き込みではなく `data-wcs` バインドに置き換える（`<wcs-state>` 統合のショーケース）。
- MIDI は `@wcstack/midi` を CDN から読む。
- `examples/README.md` / `README.ja.md` の記載を更新。

---

## Phase E — 規範文書の追補

| 文書 | 追加内容 |
|---|---|
| [timing-and-firing-contract.md](./timing-and-firing-contract.md) | 新節「`@wcstack/audio` — 適用時刻と再構築の契約」: desired のみ公開・可聴時刻は非規定（ADR G4）、rebuild 誘発条件・可聴断絶・microtask coalesce・冪等（ADR G5） |
| [async-io-node-guidelines.md](./async-io-node-guidelines.md) | §1「確定すべき論点」に「**外部クロックを持つか**（持つなら適用時刻を規定しないことを明記）」を追加 |
| [architecture-hardening/12](./architecture-hardening/12-wc-bindable-observable-inventory.md) | audio の property を棚卸しに追加（`handle` は増えないことの記録） |
| [architecture-hardening/README.md](./architecture-hardening/README.md) | 論点一覧に 14 を追加 |

---

## 7. PR 分割方針

単一 PR にしない。

1. `feat(midi): add @wcstack/midi`（Phase A）
2. `docs(adr): handle graph wiring` ＋ 決定の記録（ADR 採択時）
3. `feat(audio): AudioGraphCore and patch types`（Phase C-1 の 1〜4 ＋ そのテスト）
4. `feat(audio): custom element shells`（Phase C-1 の 5〜8 ＋ そのテスト）
5. `test(audio): real-browser smoke`（Phase C-4）
6. `examples: port synth-playground onto @wcstack/audio`（Phase D）
7. `docs: contract additions for external-clock nodes`（Phase E）

3 と 4 の間で Core だけが単独で動く状態を作り、**「Core は公開ヘッドレスサーフェス」が机上でなく実際に成立していることを PR の粒度で示す**。

---

## 8. リスクと打ち手

| リスク | 打ち手 |
|---|---|
| モック `AudioContext` の忠実度が足りず、通るのにブラウザで鳴らない | Phase B-2-5 でモックと実 context のエッジ同型性を先に確認する。実音は Phase C-4 の Playwright に必ず担わせる |
| カバレッジ 100% がオーディオスレッド由来の分岐で達成できない | 分岐をすべてメインスレッド側（スケジュール呼び出しの発行）に閉じ込める設計にする。`currentTime` はモックで手動制御する |
| Phase C が長期化して main から乖離する | PR を §7 のとおり 5 本に割る。Core（3）だけで独立して価値があり、単独マージ可能 |
| ADR が No になり作業が無駄になる | Phase A（midi）と Phase B（PoC・使い捨て 200 行）だけ先行する。Phase C は G1・G2 確定後 |

---

## 9. 成果物チェックリスト

- [ ] `packages/midi/`（src / `__tests__` / README ja・en / examples / dist ビルド通過）
- [ ] ADR 14 の G1〜G6 が決定済み（`状態` を ✅ に更新）
- [ ] `packages/audio/`（同上）
- [ ] `e2e/` に audio のスモーク 14 項目
- [ ] `examples/synth-playground/` がパッケージ利用に移植済み（`wcs-synth.js` 削除）
- [ ] `examples/README.md` / `README.ja.md` 更新
- [ ] Phase E の 4 文書の追補
- [ ] `CLAUDE.md` のパッケージ一覧に `@wcstack/midi` / `@wcstack/audio` を追加
- [ ] [wcstack-skill](https://github.com/wcstack/wcstack-skill) の references に新タグを追随
