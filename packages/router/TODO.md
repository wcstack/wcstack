# TODO

## LayoutOutlet

- [ ] 動的なLight DOMスロット対応
  - Routeのshow()時に親LayoutOutletを探索してスロット再配置を行う仕組み
  - 現状、Light DOM（`disable-shadow-root`）では`<wcs-layout>`の直接の子要素のみがスロット対象

## Router

- [ ] ルートが1つも定義されていない場合のエラーメッセージ改善
  - 現状：`"No route matched for path: /"`
  - 改善案：「ルートが1つも定義されていません」と明示

## Route

- [ ] 同一階層での重複ルート警告
  - parse時にパターンの重複をチェックし、`console.warn`を出す
  - `index`属性を持つルートは親との重複を許容（意図的な設計のため）
  - 同じ階層で同一パターンが複数ある場合のみ警告
  - エラーにはしない（意図的なケースもあり得るため）
