# state-testing-todo

`@wcstack/state` で作った todo ページと、それを [`@wcstack/testing`](../../packages/testing/) でヘッドレスに動かす vitest スイート — ページ断片をマウントし、フォームに入力して送信し、チェックを切り替え、DOM を assert します。ブラウザ不要・ビルド不要。

```bash
cd examples/state-testing-todo
npm install
npm test
```

ページ自体はビルド不要です: `index.html` を任意の静的サーバーで開けば動きます（`@wcstack/state` を CDN から読みます）。テストは CDN に触れません — `mount()` が要素を自分で登録するので、スイートは `<main id="app">` の断片だけをマウントします。

スイートが示すこと:

- `mount(html)` → 初期描画がそのまま assert できる。
- 入力（`input.value = …; fire(input, "input")`）と送信（`fire(form, "submit")`）はユーザーと同じ双方向バインドとハンドラを通る。`await settle()` で書き込みが DOM に届く。
- `app.state().write(...)` で state 側からページを動かし、`app.state().read(...)` で覗く。
- 算出 getter（`$getAll("todos.*.done", [])` による `remaining`）は行のチェックボックスが変わると再描画される。

`file:` の devDependencies はこのリポジトリのパッケージを指しており、チェックアウトから実行できます。自分のプロジェクトでは公開版を使ってください（`npm i -D @wcstack/testing @wcstack/state @wcstack/server vitest happy-dom`）。
