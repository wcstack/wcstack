# speech echo デモ（listen ⇄ speak）

`@wcstack/state` + `@wcstack/speech`。パッケージの両半身を1つのループに: `<wcs-listen>` が音声を state に認識し（event-token 側）、`<wcs-speak>` がそれを都度読み返します（command-token 側）。

## はじめに

**Chrome**（SpeechRecognition は Chrome 系のみ・ベンダープレフィクス）で、`https://` か `localhost` 上で `index.html` を開き、マイクの許可を与えてください。

## 機能

- **マイクのトグル**: `data-listentarget` の DOM autoTrigger（`start()` / `stop()` トグル）。
- **ライブ文字起こし**: `interimTranscript`（灰色・途中）と `finalTranscript`（確定）を state に束縛。
- **読み返し**: `$command.echo.emit(transcript)` で認識テキストを発話。
- **echo ループ対策**: `echoIt()` が `listening` の間は echo の emit を拒否し、合成音声が拾われて再認識されないようにします。このガードが `<wcs-speak>` ではなく state 側にあるのは、`speak()` が命令的で `manual` を尊重しないためです（`manual` が効くのはリアクティブな `say` パスだけ）。リアクティブ側をゲートしたい場合は `<wcs-speak data-wcs="say: transcript; manual: listening">` と束縛します。

## ポイント

- 認識 → state は **event-token** 方向（要素 → state）、読み返しは **command-token** 方向（state → 要素）。2つのタグがプロトコルの双対をパッケージ単位で実証します。
- `permission` を束縛し、マイク拒否を UI に表示できます。
- ここでは `continuous` は無効（1セッション1フレーズ）。`continuous max-restarts="5"` を足すと無音をまたいでセッションを継続します。
