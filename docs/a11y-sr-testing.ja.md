# a11y 機能のスクリーンリーダー手動検証手順

スクリーンリーダーの挙動は意図的に**自動化しない**（a11y-design D11）。e2e は
Playwright が Chromium で assert できる範囲（`activeElement` の同一性・
`scrollY`・ARIA 属性・live region のテキスト）をすべて固定しており、リーダーが
実際に*何を話すか*は以下の手順で手動検証する。router の a11y 面・state のリスト
レンダラ・live region を使う examples に触れるリリースごとに 1 回実施する。

リーダー: **NVDA**（Windows・無料）+ Firefox または Chrome / **VoiceOver**
（macOS 内蔵・`Cmd+F5`）+ Safari。リポジトリルートを配信し
（`cd e2e && npm run serve`）、以下の fixture / examples を使う。

## 1. ルート告知 — `announce="title"`

ページ: `/e2e/fixtures/router-a11y-optin.html`

1. ページを読み込む。リーダーはページタイトルを 1 回読み上げ（ブラウザの挙動）、
   router からの**追加の読み上げは無い**こと — 初回描画では live region は空。
2. 「about」リンクを実行。内容が差し替わった後、「About — a11y fixture」
   （新しい `document.title`）がちょうど 1 回読まれること。
3. 戻る。「Home — a11y fixture」が 1 回読まれること。
4. 素早く何往復かする: 二重読み・古いタイトルが無いこと。

## 2. フォーカスポリシー — `focus="heading"`

同じページ。

1. 「about」を実行。フォーカスが `<h1>`「About」へ移り、リーダーがそれを話す
   こと（通常「About, heading level 1」）。
2. `Tab` はその見出しから、ルート内容の中／直後の次のフォーカス可能要素へ
   進むこと（ページ先頭からやり直しにならない）。
3. 属性なし（`/e2e/fixtures/router-a11y.html`）: ナビゲーション後にフォーカスは
   body へリセットされること（次の `Tab` で先頭から）— 手つかずのブラウザ既定。

## 3. リンクの `aria-current`

どちらの fixture でも可。ナビのリンクをリーダーのカーソルでなぞる: 今いる
ページのリンクだけが「current page（現在のページ）」付きで読まれること。
ナビゲートして再確認 — マーカーが追従すること。

## 4. リスト並び替えでフォーカスが生き残る — `moveBefore`

ページ: `/e2e/fixtures/state-move-before.html`

1. 行「two」の input へ `Tab` で入り、何か入力する。
2. フォーカスを input に残したまま、リーダーの実行操作（NVDA: オブジェクト
   ナビで `Enter` / VoiceOver: `VO+Space`）で swap ボタンを実行する — input の
   フォーカスを外してマウスでクリックしないのがポイント。
3. フォーカスは同じ input に残り（リーダーがフォーカス喪失を告げない）、
   入力テキストは無傷で、行は 4 番目に移動していること。

## 5. ライブフィード — `role="log"`

ページ: `examples/websocket-chat/*`（専用サーバーが必要）または
`examples/state-notification-chat`。

1. 追記された新着メッセージは polite に読まれること — リーダーの発話を遮らず、
   終わってから。
2. 読み上げは新しいエントリだけで、ログ全体の再読でないこと。
3. state-sse-dashboard: 更新の一時停止中はリーダーが沈黙し、画面上の数値は
   読める状態が保たれること。

## 6. Reduced motion — `<wcs-raf reduced-motion="pause">`

リーダー固有ではない: OS の「視覚効果を減らす」を有効にし（Windows: 設定 >
アクセシビリティ > 視覚効果 > アニメーション効果オフ / macOS: システム設定 >
アクセシビリティ > ディスプレイ > 視差効果を減らす）、オプトイン済みの raf
ループが停止すること（tilt-maze HUD の `suspended` チップ）と、設定を戻すと
**リロードなしで**再開することを確認する。

## 結果の記録

リーダー + ブラウザ + OS のバージョンと逸脱をリリース PR に記録する。設計と
矛盾するリーダー固有の癖は [a11y-design.md](./a11y-design.md) を参照する issue
にする — 黙って特定リーダーに合わせたコードにしないこと。
