# @wcstack/midi

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/midi` は wcstack エコシステムのためのヘッドレスな Web MIDI コンポーネントです。

見た目を持つ UI ウィジェットではありません。
`@wcstack/geolocation` が現在地をリアクティブな状態に変えるのと同じように、**MIDI ハードウェアをリアクティブな状態に変える非同期プリミティブノード**です。

`@wcstack/state` と組み合わせると、`<wcs-midi>` はパス契約で直接バインドできます。

- **入力面**: `input` / `output` / `channel` / `sysex` / `auto`
- **出力状態面**: `message` / `type` / `channel` / `note` / `velocity` / `control` / `value` / `devices` / `connected` / `permission` / `error`
- **コマンド**: `request` / `close` / `send`

つまり、UI 層に `navigator.requestMIDIAccess()` や `onmidimessage` の配線を書かずに、MIDI コントローラでアプリケーション状態を宣言的に駆動できます。

`@wcstack/midi` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います。

- **Core**（`MidiCore`）— アクセス取得・ポート選択・メッセージのデコード・送信
- **Shell**（`<wcs-midi>`）— その状態を DOM の属性とライフサイクルに接続
- **Binding Contract**（`static wcBindable`）— 観測可能な `properties` と3つのコマンドを宣言

## なぜ入出力で1タグなのか

MIDI の入力と出力は別機能に見えますが、ページが持つ `MIDIAccess` は**1つだけ**で、両方向はそこから派生します。`<wcs-midi-in>` と `<wcs-midi-out>` に分割しても、同じハンドルを2要素が調停する必要が生まれるだけです。そこで `<wcs-ws>` が WebSocket の送受信を1タグで扱うのと同様に、`<wcs-midi>` が両方向を担います。（`@wcstack/speech` が2タグに分かれているのは、`SpeechSynthesis` と `SpeechRecognition` が**別々の API** だからです。）

> **Chromium 限定。** Web MIDI は Chromium 系のみで動きます。Firefox は既定で無効、Safari は未実装です。API が無い環境（非セキュアコンテキストを含む）では、`<wcs-midi>` は throw せず `permission = "unsupported"` を報告します。

## インストール

```bash
npm install @wcstack/midi
```

## クイックスタート

### 1. MIDI キーボードで音符を受ける

```html
<!-- I/O ノードを state より先に: module スクリプトは文書順に実行されるため、
     state が束縛する前に <wcs-midi> が定義済みになる。未定義の要素へ撃った
     command-token の emit は replay されない -->
<script type="module" src="https://esm.run/@wcstack/midi/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      held: [],
      $eventTokens: ["onMidi"],
      $on: {
        onMidi: (state, event) => {
          const { type, note } = event.detail;
          if (type === "noteon") state.held = [...state.held, note];
          else if (type === "noteoff") state.held = state.held.filter((n) => n !== note);
        },
      },
    };
  </script>
</wcs-state>

<wcs-midi auto data-wcs="eventToken.message: onMidi"></wcs-midi>

<p data-wcs="text: held"></p>
```

### 2. 明示的に要求するまで何も始まらない

`requestMIDIAccess()` は権限プロンプトを出しうるため、**要素を接続しただけでは何も起きません**。`auto` 属性を付けるか（上の例）、ユーザー操作からコマンドを撃ってください。

```html
<wcs-midi data-wcs="command.request: $command.connectMidi; connected: midiReady"></wcs-midi>

<button data-wcs="onclick: $command.connectMidi; hidden: midiReady">MIDI に接続</button>
```

### 3. フェーダーで値を駆動する

```html
<wcs-midi auto channel="1" data-wcs="control: cc; value: ccValue"></wcs-midi>

<!-- CC 7 は慣習的にボリュームフェーダー -->
<meter min="0" max="127" data-wcs="value: ccValue"></meter>
```

### 4. MIDI デバイスへ送信する

```html
<wcs-midi auto output="Synth" data-wcs="command.send: $command.midiSend"></wcs-midi>
```

```js
// 位置引数はそのまま素通しされる（command-token）
state.$command.midiSend.emit([0x90, 60, 100]);
```

## メッセージ面

1つのイベント（`wcs-midi:message`）がメッセージ全体を運び、個々のフィールドは同じイベントからの派生 getter です。必要なものだけをバインドできます。

| プロパティ | 型 | 備考 |
|---|---|---|
| `message` | object | `{ data, port, portName, timestamp, ...デコード結果 }` |
| `type` | string | `noteon` / `noteoff` / `polyaftertouch` / `controlchange` / `programchange` / `aftertouch` / `pitchbend` / `sysex` / `other` |
| `channel` | number \| null | 1〜16。システムメッセージは `null` |
| `note` | number \| null | 0〜127 |
| `velocity` | number \| null | **0〜1 に正規化** |
| `control` | number \| null | コントローラ番号。生の 0〜127 |
| `value` | number \| null | 生の 0〜127。**ピッチベンドのみ -1〜1** |

2つの正規化を行っています（さもないと全ての利用者が同じ処理を書くことになるため）。

- **velocity 0 の note-on は `noteoff` として報告します。** 多くのコントローラは本来の 0x8n note-off を送らず、note-on のまま扱うと音が鳴りっぱなしになります。生のステータスバイトは `message.data[0]` に残っています。
- **velocity は 0〜1** なので、そのままゲインに掛けられます。コントローラ値は意味がコントローラ依存なので生の値のままです。

`message` は状態ではなく **occurrence** です。同じ内容の note-on 2回は別々の打鍵なので、同値ガードは行いません。`data` はメッセージごとに新しい `Uint8Array` で、プラットフォームのバッファをそのまま渡すことはありません（RxJS の replay や React のスナップショットで保持しても安全です）。

## ポート

| 属性 | 省略時 | 指定時 |
|---|---|---|
| `input` | **全ての**入力ポートを購読 | ポート id、または名前の前方一致（大文字小文字を無視） |
| `output` | `send()` は**最初の**出力ポートへ | ポート id、または名前の前方一致 |
| `channel` | 全チャンネルを配送 | そのチャンネル（1〜16）のみ配送。システムメッセージは常に通す |

既定で全ポートを購読するのは MIDI の期待に合わせたものです。挿したコントローラはページが名前を指定しなくても鳴るべきです。

接続中の要素で `input` / `output` / `channel` を変更すると、**既存のアクセスに対して購読を張り替えます**。再要求は行わないので、権限プロンプトが再度出ることはありません。

`devices` は全ポートを `{ id, name, manufacturer, direction, state }` として publish し、着脱のたびに更新します。デバイス名は一意ではない（同一機種を2台挿すと同じ名前になる）ため、特定の1台を指したい場合は id を使ってください。

## 権限

`permission` はおなじみの4値です: `prompt` / `granted` / `denied` / `unsupported`。

`navigator.permissions.query({ name: "midi" })` に答えるブラウザでは、サイト設定で権限が取り消された場合も再要求なしに状態へ流れます。答えないブラウザでは `request()` の結果から推定します。

`sysex` はシステムエクスクルーシブの許可を要求します。これは**別個の、より制限された権限**なので、実際に SysEx が必要でなければ付けないでください。

## `:state()` による CSS スタイリング

Shell は出力状態を `ElementInternals.states` に反映します。

```css
wcs-midi:state(connected) { --midi-dot: limegreen; }
wcs-midi:state(denied)    { --midi-dot: crimson; }
wcs-midi:state(unsupported) { --midi-dot: dimgray; }
wcs-midi:state(error)     { --midi-dot: orange; }
```

デバッグ中は `debug-states` 属性を付けると `data-wcs-state-*` にもミラーされます。`ElementInternals` が無い環境では反映だけが静かに無効化され、他の機能はそのまま動きます。

## ヘッドレス利用（Core）

`MidiCore` は DOM を必要としない公開サーフェスです。

```js
import { MidiCore } from "@wcstack/midi";

const core = new MidiCore({ channel: 1 });
core.addEventListener("wcs-midi:message", (e) => console.log(e.detail.type, e.detail.note));
await core.request();
core.send([0x90, 60, 100]);
// ライフサイクルは利用者の責任: dispose() しないと、生きている onmidimessage
// ハンドラがこのインスタンスをポートの寿命だけ到達可能に保つ。
core.dispose();
```

別経路で得たバイト列をデコードするために `parseMessage(data)` も単体で export しています。

## エラー

throw は一切しません。失敗は状態として現れます。

| 状況 | `permission` | `error` | `errorInfo.code` |
|---|---|---|---|
| `navigator.requestMIDIAccess` 不在 | `unsupported` | `"unsupported"` | `capability-missing` |
| ユーザーが拒否 / ポリシーでブロック | `denied` | rejection のメッセージ | `not-allowed` |
| その他のアクセス失敗 | `denied` | rejection のメッセージ | `access-error` |
| `send()` の失敗 | 変化なし | throw のメッセージ | `send-failed` |

## 注意点

- **Chromium 限定**。セキュアコンテキストが必要。
- **velocity 0 の note-on は note-off**（上記）。
- **`sysex` は別権限**で、拒否されやすい。
- **デバイス名は一意ではない**。id を推奨。
- **`statechange` は1台につき複数回飛びうる**（入力側と出力側が別々に届く）。`devices` は内容比較しているので、実際に変化していなければ再 publish されません。

## ライセンス

MIT
