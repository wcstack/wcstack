# パーミッションバナー デモ

`@wcstack/state` + `@wcstack/permission`（`<wcs-permission>`）+ `@wcstack/geolocation`（`<wcs-geo>`）。監視された state だけでパーミッション対応バナーを駆動する例。UI 層は `navigator.permissions` に一切触れない。

## はじめに

`index.html` をブラウザで開くだけ（静的サーバ、またはファイル直開き）。ビルド不要で、すべて `esm.run` から読み込まれる。Geolocation は secure context が必要: `localhost` か `https://` で動作。`file://` ではブラウザによってプロンプトが出ないことがある。

## 機能

- **`<wcs-permission name="geolocation">` が監視**: 許可状態を `state` / `granted` / `prompt` / `denied` / `unsupported` として state 化する。read-only でコマンドもプロンプトも無い。
- **`<wcs-geo>` が取得**: クリックで command-token 経由（`$command.locate.emit()` → `getCurrentPosition()`）に位置を取得し、`latitude` / `longitude` / `loading` を state へバインドバック。
- **`hidden@granted` のバナー**: 監視された state からブール 1 つでバナーを出し分ける。未許可なら表示、許可された瞬間に消える。live `change` 追従により、ブラウザ設定で許可を変えるとリロード無しで UI が更新される。

## ポイント

- **責務は 2 つ・要素も 2 つ**。許可を取りに行くのは機能ノード（`<wcs-geo>`）の仕事で、permission ノードは監視のみ。だから `<wcs-permission>` には `request` コマンドが無い（Permissions API に `request()` が無いため）。
- **監視ノードに command-token は適用されない**。`<wcs-permission>` は純粋な要素 → state プロデューサ（event-token のみ）。ボタンが駆動するのは permission 要素ではなく `<wcs-geo>`。
- `denied` はボタンを無効化し、バナー文言を「設定でブロック中」に切り替える。すべて派生 state で、UI 層に命令的な分岐は無い。
