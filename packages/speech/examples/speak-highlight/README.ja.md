# speak + 単語ハイライト デモ

`@wcstack/state` + `@wcstack/speech`（`<wcs-speak>`）。音声合成を状態遷移として扱い、`charIndex` / `spokenWord` 出力でカラオケ風の単語ハイライトを駆動します。

## はじめに

`index.html` をブラウザで開くだけ（静的サーバ、またはファイル直開き）。ビルド不要 — すべて `esm.run` から読み込みます。

## 機能

- **Speak / Stop** を command-token で実行（`$command.say.emit(text)` / `$command.stopSpeak.emit()`）。
- **単語ハイライト**: `<wcs-speak>` が読み上げ中の `charIndex` と `spokenWord` を報告。3つの派生 getter（`before` / `current` / `after`）が読み上げ中の単語の周辺でテキストを分割し、`.hl` span で強調します。
- UI 層に**命令的な発話コードがない** — ページは `speechSynthesis.speak()` を一切呼びません。

## ポイント

- `command.speak: $command.say` は emit したテキストをそのまま `<wcs-speak>.speak(text)` へ転送します（command-token の引数転送契約）。
- ハイライトは純粋な派生状態: `pos`（`charIndex`）が変わるたびに `before/current/after` が再計算されます。
- `unsupported` を束縛し、SpeechSynthesis 非対応環境でも UI が破綻しません。
