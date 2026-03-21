# state + fetch demo

`@wcstack/state` と `@wcstack/fetch` の連携デモです。ユーザー一覧の取得・フィルタリング・詳細表示・新規作成（POST）を行います。

## 起動方法

```bash
# 1. 各パッケージをビルド
cd packages/state && npm run build && cd ../..
cd packages/fetch && npm run build && cd ../..

# 2. デモサーバーを起動
node examples/state-fetch/server.js
```

http://localhost:3000 でアクセスできます。

## 機能

- **ユーザー一覧**: `/api/users` からデータを取得しリスト表示
- **ロールフィルタ**: All / Admin / Editor / Viewer でフィルタリング
- **詳細表示**: ユーザーをクリックすると `/api/users/:id` から詳細を取得
- **新規作成**: フォームから POST でユーザーを作成、完了後にリストを自動リロード
