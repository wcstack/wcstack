# speech echo デモ（listen ⇄ speak）

`@wcstack/state` + `@wcstack/speech`。パッケージの両半身を1つのループに: `<wcs-listen>` が音声を state に認識し（event-token 側）、`<wcs-speak>` がそれを都度読み返します（command-token 側）。

## はじめに

**Chrome**（SpeechRecognition は Chrome 系のみ・ベンダープレフィクス）で、`https://` か `localhost` 上で `index.html` を開き、マイクの許可を与えてください。

## 機能

- **マイクのトグル**: `data-listentarget` の DOM autoTrigger（`start()` / `stop()` トグル）。
- **ライブ文字起こし**: `interimTranscript`（灰色・途中）と `finalTranscript`（確定）を state に束縛。
- **読み返し**: `$command.echo.emit(transcript)` で認識テキストを発話。
- **echo ループ対策**: `<wcs-speak data-wcs="manual: listening">` が録音中はリアクティブ発話パスをミュートし、合成音声が再認識されないようにします。

## ポイント

- 認識 → state は **event-token** 方向（要素 → state）、読み返しは **command-token** 方向（state → 要素）。2つのタグがプロトコルの双対をパッケージ単位で実証します。
- `permission` を束縛し、マイク拒否を UI に表示できます。
- ここでは `continuous` は無効（1セッション1フレーズ）。`continuous max-restarts="5"` を足すと無音をまたいでセッションを継続します。
