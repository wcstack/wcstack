# TODO

## LayoutOutlet

- [ ] 動的なLight DOMスロット対応
  - Routeのshow()時に親LayoutOutletを探索してスロット再配置を行う仕組み
  - 現状、Light DOM（`disable-shadow-root`）では`<wcs-layout>`の直接の子要素のみがスロット対象

## Router

- [x] ルートが1つも定義されていない場合のエラーメッセージ改善
  - 現状：`"No route matched for path: /"`
  - 改善案：「ルートが1つも定義されていません」と明示

## Route

- [x] 同一階層での重複ルート警告
  - parse時にパターンの重複をチェックし、`console.warn`を出す
  - `index`属性を持つルートは親との重複を許容（意図的な設計のため）
  - 同じ階層で同一パターンが複数ある場合のみ警告

## Architecture : Multi-Router & Scalability

- [ ] マルチインスタンス対応 (Multi-Router)
  - `Router` クラスのシングルトン制限（`_instance` check）を撤廃
  - `basename` に基づくイベント無視ロジックの追加
  - マイクロフロントエンド対応

- [ ] 拡張パラメータ型定義 (Typed Parameters)
  - **前提タスク: マッチングアルゴリズムの刷新**
    - 現在の「連結正規表現方式」から「セグメント分解マッチング方式」へ移行
    - 理由: ユーザー定義型の正規表現に含まれるキャプチャグループ `()` によるインデックスずれ問題を回避するため
  - パスパラメータに型制約と変換ロジックを導入
  - 構文: `:userId(int)`
  - ビルトイン型: `int`, `float`, `bool`, `uuid`, `slug`, `isoDate`, `any`
  - 機能:
    - 正規表現によるマッチング制限
    - マッチ後の値変換（例: String -> Number）
    - カスタムバリデーション（範囲チェックなど）
  - エラーにはしない（意図的なケースもあり得るため）
