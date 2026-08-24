# リスト遷移デモ

`@wcstack/state` + `@wcstack/view-transition`（`<wcs-view-transition>`）。素の CSS では届かない 2 つ —— **退場**と**移動** —— と、届く 1 つを並べて、その差が目で見えるようにしたデモ。

## はじめに

`index.html` をブラウザで開くだけ（静的サーバ、またはファイル直開き）。ビルド不要で、すべて `esm.run` から読み込まれる。

行を追加し、シャッフルし、1 つ削除してみる。次に **disable transitions** にチェックを入れて同じ操作をすると、入場だけは相変わらずフェードし（これは CSS）、退場と移動は瞬間的に切り替わる（これがタグのしていた仕事）。

## 機能

- **入場にコストは要らない。** `li { transition: …; @starting-style { … } }` で新しく挿入された行はアニメーションする。パッケージは一切関与しない —— `@wcstack/view-transition` が存在する前からできていたことであり、見落とされやすいのでここに書いておく。
- **退場と移動にはスナップショットが要る。** 削除された行は同期で detach され、並べ替えには中間状態が無いので、CSS が transition すべき対象がそもそも残らない。`<wcs-view-transition>` は drain の DOM 変更を `document.startViewTransition` へ渡し、ブラウザが変更**前**の状態を捕まえる。
- **`naming="auto"`** が各行に一意な `view-transition-name` と `wcs-row` グループクラスを付けるので、`::view-transition-old(*.wcs-row)` / `::view-transition-new(*.wcs-row)` の 1 組でリスト全体を書ける。
- **`data-wcs="disabled: animationsOff"`** で arbiter を state から止められる。DOM 変更は変わらず適用され、落ちるのはアニメーションだけ。

## ポイント

- **これはポリシーノード。** 何も描画せず、自身のデータもバインドせず、アニメーションを記述もしない —— アニメーションは `::view-transition-*` に対する CSS の仕事。タグを外せば、ページは以前と完全に同じ挙動・同じタイミングに戻る。
- **削除は同期のまま。** アニメーションのために行を mount したままにはしないので、リスト差分・content プール・`if`/`for` の不変条件はどれも触られていない。Vue 風の leave クラスではなく View Transition を選んだ理由がこれ（[設計文書](../../../../docs/view-transition-design.ja.md) §2）。
- **知っておくべき帰結が 1 つ。** タグが `state` 参加者を受け付けている間（既定）、drain は microtask ではなくフレームで適用される。state に書いてから `await Promise.resolve()` で DOM を読むコードは遷移を待つ必要がある。`$updatedCallback` はバインディング適用直後に発火する点は変わらない。
- **`auto` はロード順に依存する。** 名前は content の mount 時に割り当てられるので、このページは `@wcstack/view-transition` を `@wcstack/state` より**前**に読み込んでいる。逆順だと最初の行に名前が付かず、後から付け直されることも無い。
