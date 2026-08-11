# 設計メモ: `@wcstack/midi`（`<wcs-midi>`）

- **状態**: ✅ 設計確定（2026-08-02）。**[handle graph wiring ADR](./architecture-hardening/14-handle-graph-wiring.ja.md) に依存しない**（ハンドルもグラフも持たない）。実装計画は [audio-impl-plan.ja.md](./audio-impl-plan.ja.md) Phase A。
- **対象 WebAPI**: Web MIDI API（`navigator.requestMIDIAccess({sysex})`、`MIDIAccess`、`MIDIInput` / `MIDIOutput`、`midimessage` イベント、`statechange` イベント、`MIDIOutput.send()`）。
- **位置づけ**: [examples/synth-playground](../examples/synth-playground/) から切り出す最初のパッケージ。**Web MIDI は synth と独立に意味を持つ**（MIDI コントローラで UI を操作する、フェーダーで state を駆動する等）純粋な Web 標準 I/O ノードであり、ハンドルもグラフも持たない。既存のノード骨格にそのまま収まる。
- **前提資産**: permission（4値 permission surface・`_permGen` 世代ガード・unsupported フォールバック・pure monitor 型）、websocket（1タグで送受信の双方向・接続状態）、broadcast（message を occurrence として流す・同値ガードしない）、notification（permission を誘発する command）、sensor 族（connect では何も始まらない・start コマンド駆動）。

---

## 0. 方向性: 双方向（event-token ＋ command-token）

| サーフェス | 種別 | 内容 |
|---|---|---|
| 受信 | event-token | デバイスからの MIDI メッセージ → state へ |
| 送信 | command-token | `send(data)` で MIDI OUT デバイスへ |
| デバイス着脱 | event-token | `statechange` → `devices` を再 publish |
| permission | property | 4値（`prompt` / `granted` / `denied` / `unsupported`） |

permission タグが monitor 専用だったのは Permissions API に `request` が無いからだった（[permission-tag-design](./permission-tag-design.md) §0）。**Web MIDI は `requestMIDIAccess()` 自体が request** なので、notification / camera と同じく command-token が成立する。

---

## 1. タグ構成: 1タグか2タグか【✅ 1タグで決定】

| 案 | 構成 | 評価 |
|---|---|---|
| **A. 1タグ `<wcs-midi>`** | `input` / `output` 属性でポートを選び、受信は event・送信は command | `MIDIAccess` はページ全体で1つの共有リソースであり、分割しても両者が同じ access を調停する必要がある。websocket（`<wcs-ws>` 1タグで送受信）と同型 |
| B. 2タグ `<wcs-midi-in>` / `<wcs-midi-out>` | speech（TTS/STT）・camera（camera/recorder）と同じ分割 | 用途が入力のみ／出力のみに偏るのは事実。ただし Core を共有する必要があり、分割の利得が小さい |

- **推奨: 案A（1タグ）**。理由: 分割の主目的は「別々の Web API を別々のタグに割り当てる」ことだが、MIDI は入出力とも単一の `MIDIAccess` から派生する。speech は `SpeechSynthesis` と `SpeechRecognition` という**別 API** だったので分割に意味があった。
- **リリース後の分割は破壊的変更**になるため、本ゲートは実装着手前に確定させる。

---

## 2. メッセージ surface — raw ＋ 派生 getter

ガイドライン §4.2「複合状態は 1 イベント＋派生 getter に分解する」に従う。

- イベントは `wcs-midi:message` 1本。`detail` は `{ data: Uint8Array, port: string, timestamp: number }`。
- 派生 getter: `type`（`"noteon"` / `"noteoff"` / `"controlchange"` / `"pitchbend"` / `"programchange"` / `"aftertouch"` / `"sysex"` / `"other"`）、`channel`（1〜16）、`note`、`velocity`（0〜1 に正規化）、`control`、`value`。
- **semantics: `"event"`（MUST 宣言）**。同一内容のメッセージ連打は別々の occurrence なので**同値ガードしない**（broadcast / websocket の `message` と同型）。
- **producer snapshot contract**: `data` は受信ごとに**新しい `Uint8Array` を割り当てて publish する**（プラットフォームのバッファを再利用しない）。RxJS の replay がバッファを抱え込んでも安全にする。

### 2.1 note on / note off の正規化【罠】
MIDI では「velocity 0 の note-on」が note-off として使われる。派生 getter の `type` は**これを `"noteoff"` に正規化する**（原型 synth-playground の `wcs-synth.js` の `_onMessage` と同じ扱い）。生の status バイトが必要な利用者は `data[0]` を読める。

---

## 3. 開始タイミングと permission

- **connect では何も始まらない**（idle §14.1 / sensor 族 §9.1 と同型）。`command.request` で `requestMIDIAccess()` を呼ぶ。
- 理由: `requestMIDIAccess()` は環境によってパーミッションプロンプトを出す。ページを開いただけでプロンプトが出るのは行儀が悪い。
- **✅ 決定 3-1**: `auto` 属性でオプトインの自動要求を許す（**既定 off**）。ユーザー操作起点であることが自明なページ（MIDI 前提のツール）で `<wcs-midi auto>` と書ける。
- **sysex**: `sysex` 属性で `requestMIDIAccess({ sysex: true })`。sysex は別 permission であり拒否されやすい。既定 false。
- **secure context 必須**。非 https では `navigator.requestMIDIAccess` が存在しない → `unsupported`。
- **対応環境**: Chromium 系のみ（Firefox は既定無効、Safari 非対応）。**never-throw** で `unsupported` に落とす。

---

## 4. デバイス列挙と着脱

- `devices` プロパティ: `{ id, name, manufacturer, direction, state }[]`。**fresh array を再割当て**して publish（producer snapshot contract・camera の `devices` と同型）。
- `MIDIAccess.statechange` で再列挙 → `devices` 更新。同値ガードは**内容比較**（id + state の複合キー）で行い、着脱が無ければ再 publish しない。
- ポート選択: `input` / `output` 属性は **id または name の前方一致**を受ける。省略時は
  - `input` 省略 → **全入力ポートを購読**（synth-playground と同じ挙動。MIDI は「刺さっているものを鳴らす」が既定期待）。
  - `output` 省略 → `send` は**最初の出力ポート**へ。出力が無ければ no-op（never-throw）。

---

## 5. wcBindable サーフェス

```ts
static wcBindable: IWcBindable = {
  protocol: "wc-bindable", version: 1,
  properties: [
    { name: "message",    event: "wcs-midi:message",    semantics: "event", getter: e => e.detail },
    { name: "type",       event: "wcs-midi:message",    semantics: "event", getter: e => /* 派生 */ },
    { name: "channel",    event: "wcs-midi:message",    semantics: "event", getter: e => /* 派生 */ },
    { name: "note",       event: "wcs-midi:message",    semantics: "event", getter: e => /* 派生 */ },
    { name: "velocity",   event: "wcs-midi:message",    semantics: "event", getter: e => /* 派生 */ },
    { name: "devices",    event: "wcs-midi:devices",    semantics: "state" },
    { name: "connected",  event: "wcs-midi:statechange",semantics: "state" },
    { name: "permission", event: "wcs-midi:permission", semantics: "state" },
    { name: "error",      event: "wcs-midi:error",      semantics: "state" },
    { name: "errorInfo",  event: "wcs-midi:error",      semantics: "state" },
  ],
  inputs: [
    { name: "input", attribute: "input" }, { name: "output", attribute: "output" },
    { name: "channel", attribute: "channel" }, { name: "sysex", attribute: "sysex" },
  ],
  commands: [
    { name: "request", async: true }, { name: "close" }, { name: "send" },
  ],
};
```

- `send(data, timestamp?)` は **位置引数素通し**（[command-token 引数転送](./spec-proposal-command-token-arguments.md) の MUST）。`data` は `number[]` / `Uint8Array` の両方を受ける。`await` しない。
- **CustomStateSet**: `:state(granted)` / `:state(connected)` / `:state(unsupported)` / `:state(error)` を Shell が反映（[custom-state-reflection-design](./custom-state-reflection-design.ja.md) 準拠）。

### 5.1 配線例

```html
<wcs-midi data-wcs="eventToken.message: onMidi; devices: midiDevices; command.send: $command.midiSend" auto></wcs-midi>
```
```js
$eventTokens: ["onMidi"],
$commandTokens: ["midiSend"],
$on: {
  onMidi: (state, event) => {
    const { type, note, velocity } = event.detail;
    if (type === "noteon") state.held = [...state.held, note];
    else if (type === "noteoff") state.held = state.held.filter(n => n !== note);
  },
},
```

---

## 6. 発火契約（timing-and-firing-contract.ja.md 行き）

- **初回スナップショット消失は起きない**。`requestMIDIAccess()` は async であり、`connectedCallback` 中の同期 dispatch が無い（permission §11.2 と同型・screen-orientation §7.1 の問題を回避）。
- `message` は同値ガード**なし**（occurrence）。`devices` / `connected` / `permission` / `error` は同値ガード**あり**。
- `_gen` 世代ガード: `request()` ごと＋ `dispose()` で bump。dispose 後に解決した `requestMIDIAccess` が listener を張らない。
- `dispose()` は全 `input.onmidimessage = null` ＋ `access.onstatechange = null`。**原型 synth-playground の `wcs-synth.js` で実証済み**（正本の実装は [`packages/midi/src/core/MidiCore.ts`](../packages/midi/src/core/MidiCore.ts) の `dispose()`）。

---

## 7. 罠（README Notes 行き）

- **Chromium 限定**。Firefox / Safari では `unsupported`。
- **secure context 必須**。
- **velocity 0 の note-on は note-off**（§2.1）。
- **sysex は別 permission** で拒否されやすい。
- **デバイス名は不安定**（同一機種を複数刺すと名前が重複する）。id での指定を推奨。
- **`statechange` はポート追加時に複数回飛ぶ**ことがある（input/output 別々）。同値ガード必須。

---

## 8. 実装順

1. **`MidiCore`**: `requestMIDIAccess` ＋ permission 二相 ＋ ポート列挙 ＋ メッセージ正規化 ＋ `send` ＋ `_gen`。DOM 非依存。
2. **`<wcs-midi>` Shell**: 属性 → 入力 property、`upgradeProperties`、CustomStateSet 反映、`connectedCallbackPromise`。
3. **テスト**: `FakeMIDIAccess` / `FakeMIDIInput` / `FakeMIDIOutput` モック（intersection の `FakeIntersectionObserver` 同型）。メッセージ正規化・velocity 0・channel フィルタ・着脱・`_gen`・unsupported フォールバックを重点。**目標 55〜65 本**、カバレッジ 100 / 97+ / 100 / 100。
4. **example**: MIDI フェーダーで `<wcs-state>` の値を駆動する最小デモ（synth 非依存であることの実証を兼ねる）。
5. **README ja/en**（§7 の罠を明記）＋ **headless（Core）利用の節**（ガイドライン §9）。

## 9. 決定事項

| 論点 | 決定 |
|---|---|
| §1 タグ構成 | ✅ **1タグ `<wcs-midi>`**（2026-08-02・リリース後変更不可の一方通行として確定） |
| §3-1 `auto` 属性 | ✅ 許す・既定 off |
| §4 `input` 省略時 | ✅ 全入力ポートを購読 |
