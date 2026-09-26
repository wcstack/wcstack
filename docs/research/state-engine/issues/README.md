# 現行の未解決 Issue を Chromium で確かめる

計測 2026-09-26。対象は #2 を除く未解決 Issue（#258、#319〜#323）と、この調査で起票した #324。記録は [addons-plan.ja.md](../../../state-engine-rewrite/addons-plan.ja.md) の「現行の未解決 Issue の影響」。

| ファイル | 中身 |
|---|---|
| `run.mjs` | #319〜#323 の再現手順（Issue の本文のまま）を現行 3.3.0 と state-next で、#258 の SSR の場合と、行の中のコンポーネントのクラスを後から定義する場合を state-next で流す |
| `listindex.mjs` | #324（`for` で描いていないリストの行を添字のパスで読み書きする）の 4 つの形を両方で流す |
| `ssr-*.html` | サーバの出力。`__tests__/issues.test.ts` と同じ手順（happy-dom で描いてスナップショットを組む。`@wcstack/server` と同じ）で作った。クライアント側は、`<wcs-state>` にインラインの状態を戻して読み込む |
| `run-result.txt`・`listindex-result.txt` | 実行結果 |

どちらもリポジトリの `e2e/` に入っている Playwright を使う。両パッケージをビルドしてから、このディレクトリで `node run.mjs`・`node listindex.mjs` を実行する。
