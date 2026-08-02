# midi-fader — MIDI コントローラでページを動かす

`@wcstack/midi` の最小デモです。あえて**シンセに一切依存しない**構成にして、
Web MIDI が「音を出すためのもの」ではなく汎用の入力ノードであることを示します。
ノートとコントロールチェンジが `<wcs-state>` に流れ込み、普通の HTML として
描画されます。

```bash
npx serve packages/midi/examples/midi-fader
# あるいはリポジトリ全体を配信: cd e2e && npm run serve
```

Chromium 限定です（Firefox / Safari は Web MIDI 未実装）。`requestMIDIAccess()`
はプロンプトを出しうるため、アクセス要求はクリックから行います。

## 見どころ

- `<wcs-midi>` は**自身の描画を持ちません**。状態を生むだけで、ページ上の全ての
  ピクセルはパスにバインドされた普通の HTML です。
- `eventToken.message: onMidi` がメッセージ1件を1 occurrence として配送します。
  各メッセージ種別が**このページにとって**何を意味するかは `$on` ハンドラが決めます。
- `command.request: $command.requestMidi` でアクセス要求をボタンから撃つので、
  権限プロンプトがユーザー操作に紐づきます。
- ステータスの丸は `wcs-midi:state(connected)` でスタイリングしています。出力状態が
  バインディング層を通らずに CSS へ届く例です。
