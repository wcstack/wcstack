# state-devtools-playground

`<wcs-devtools>` の 3 ペイン全部が仕事をする最小ページ。

- **State** — カウンタ（素の write + computed getter）、ToDo（リスト diff・
  ワイルドカード getter）、時計 state。値はインライン編集でき、編集は通常の
  リアクティブパイプラインを通るのでページ側（`double` getter 含む）が更新される。
- **Wiring** — ページ上の全 `data-wcs` 配線のライブ台帳。State ペインのパスを
  クリック（またはページ要素を ⌖ pick）すると束縛ノードがハイライトされる。
- **Timeline** — 操作ごとの `write` → `batch` 行に加え、`<wcs-timer>` 時計の
  `command`/`event` 行。**fire ghost command** ボタンは購読者ゼロのコマンド
  空撃ち（whenDefined 前配線レースの典型）で、警告バッジの実演。

## 実行

パッケージは CDN（[esm.run](https://esm.run)）から読み込むため、バックエンドも
ビルドも不要。任意の静的サーバーで動く:

```bash
npx serve examples/state-devtools-playground
# → 表示された URL を開き Alt+Shift+D（または WCS バッジをクリック）
```

## メモ

- devtools のスクリプトを**最初**に読むことでバインディング構築前にフックが
  繋がり、Wiring ペインがライブ台帳になる。`@wcstack/state` より後ろに移す
  （または後から注入する）と "declared" フォールバックとリロード導線が見られる。
- パネルを開いている間はページの一部が覆われる（右ドックにするか閉じれば操作可）。
