# React から来た人へ

React を知っていて、これから wcstack でアプリを書く —— あるいは移す —— 人のためのページです。継ぎ目アプリ
`street-reports`（[seam-apps.ja.md](./seam-apps.ja.md)）から生まれました: 動いている React 19 のアプリ（react-router、
`AbortController` 付きの effect、Context、制御された入力、portal、遅延ルート、error boundary）とその e2e を、初めての
作者に渡しました。作者は e2e を変えずに wcstack へ移し、構文ごとに「どこへ行ったか」と「習慣がどこで道を誤らせたか」を
書き残しました。このページは、その記録を整えたものです。

English: [coming-from-react.md](./coming-from-react.md)

## React と違う 6 つのこと

1. **束縛に書くのはパスとフィルタで、式ではありません。** `data-wcs="hidden: loading|not"` であって `!loading` では
   なく、`if: count|gt(0)` であって `count > 0` ではありません。フィルタで言えないことは state の getter に書き
   （`get badgeText() { return …; }`）、束縛はその getter を名指します。JSX は値の所にどんな式でも書けますが、ここでは
   マークアップにあるのは名前だけで、JavaScript はすべて state の中です。
2. **`if:` と `for:` は `<template>` の上、`{{ }}` はテキスト。** `{cond && <p>…</p>}` は
   `<template data-wcs="if: cond"><p>…</p></template>` です。`<p>` そのものに書いても何もしません。`{{ name }}` が
   働くのはタグの間だけです: 属性は束ねるもので（`data-wcs="attr.href: href"`）、埋め込むものではありません。
3. **state はページに 1 つで、ルートより長生きします。** React のページコンポーネントはアンマウントされ、`useState` は
   消えます。`key={id}` はわざと消すための書き方です。ここでは、ルートのノードは外されてまた戻され、state はタブ全体で
   1 つのオブジェクトです: 選択、検索の文字、最後に表示したレコードは、戻ってきたときにも残っています —— そして
   レコード 51 を読み込んでいる間、state にはまだレコード 50 があります。ページが忘れるべきものは、入るとき・出るときに
   自分で戻します: router の `routeName`（`<wcs-router>` から束ねる）への `$watch` がその場所です。
4. **一覧の行は、そのオブジェクトです。`key` はありません。** 並べ替えや絞り込みは、同じオブジェクトの新しい配列を
   代入すれば、行がオブジェクトと一緒に動きます。オブジェクトを**差し替えた**行は新しい行で（フォーカスを失います）:
   オブジェクトを保つか、`$listKeys` を宣言して、取り直したデータでも行が保たれるようにします。その場での変更
   （`push`・`sort`・`this.report.status = v`・`Set.add`）は見えません: 代入します。
5. **フォームの部品と部品の入力は双方向です。** `value: form.title` は書き戻します。これがハンドラなしの「制御された
   入力」です。state が要素に従ってはいけない所 —— URL を表示する select —— では `value#ro:` と書いてイベントを
   扱います。部品の bindable なメンバーも双方向です: `#ro` を付けると prop になります。
6. **effect は 4 つのどれかです。** ほかの値から導く値は getter。副作用のある反応は `$watch` の項目（最初には走らず、
   getter を watch すると、値ではなく入力が変わったときに鳴ります）。取得・保存・タイマー・ストリーム・文書の題名は
   要素（`<wcs-fetch>`・`<wcs-storage>`・`<wcs-debounce>`・`<wcs-sse>`・`<wcs-head>`）。残り —— `document` へのリスナ、
   interval —— は、ページに入る所と出る所で手で始めて止めます（3 を参照）。

## 何がどこへ行くか

| React | wcstack | |
|---|---|---|
| ページコンポーネント | ページの HTML の中の `<wcs-route>` の本体と、state の一節 | 形が違う |
| 小さな再利用コンポーネント | 部品: 宣言的カスタムコンポーネント（HTML だけ）か、`bind-component` のクラス | 形が違う |
| `props` | 部品の `$bindables`。`#ro` で束ねる | `#ro` が無ければ双方向 |
| コールバックの prop（`onPageChange`） | 部品が出すイベント: タグに `eventToken.page: pageChosen`、state に `$on.pageChosen` | 形が違う |
| `children` | ページの中の素の入れ子。部品は、自分が宣言した `<slot>` で受ける | — |
| `useState` | state のキー（ページより長生きする —— 自分で戻す） | 形が違う |
| `useReducer` | キーを書くメソッド | 形が違う |
| `useMemo` | getter（依存でキャッシュされる） | そのまま |
| `useCallback`・`useEffectEvent`・`StrictMode` | 何も: メソッドは安定していて、今の state を読む | 要らない |
| 要素への `useRef` | メソッドや `$watch` のハンドラの中の `document.getElementById`。`indeterminate:` などはプロパティの束縛 | 手で |
| `useId` | 行の getter から作る id（`attr.id: .domId`）。部品なら部品の shadow root | 手で |
| `useContext` | トップレベルのキーをパスで読む —— provider はありません。部品はページの state を読みません: 値を渡します | 形が違う |
| effect の中の取得と中断 | `<wcs-fetch manual>` と、url の getter への `$watch` がコマンドを出す。`value` は「最後の応答」なので、今ページが表示しているものかを確かめる | 形が違う |
| debounce した値 | `<wcs-debounce wait="300" data-wcs="source: text; value: textSettled">` | そのまま |
| `localStorage` と `storage` イベント | `<wcs-storage key="…" data-wcs="value#init=element: theme">`（文字列は JSON にせず、そのまま保存される） | そのまま |
| 文書の題名 | ルートの中の `<wcs-head><title>…</title></wcs-head>` | そのまま |
| イベントのストリーム | `<wcs-sse url="…" events="report" data-wcs="eventToken.message: onReport">` | そのまま |
| ルート、`useParams`・`useLocation`・`useSearchParams`・`useNavigate` | `<wcs-router>` の `params:`・`path:`・`searchParams:` を state に束ねる。書くのは `navigateUrl`（push）か `replaceUrl`（replace） | そのまま |
| `<Link>`・`<NavLink>` | `<wcs-link to="…">`。区画には `match="prefix"`、それを読み上げにも言うなら `current="page"`（4.30 から） | そのまま |
| `<Navigate replace>` | パスを返すガード | 形が違う |
| `useBlocker` と自前のダイアログ | 4.32（未リリース）から、`<wcs-router>` の `leaveHold: dirty`: ナビゲーションを止め、`leaving` が行き先を言い、自前のダイアログが router の `proceed()` / `stay()` で答えます（router の README「ページ自身の「離れますか」」）。4.31 までは、`leaveConfirm` のブラウザの `confirm()` だけでした | 無い |
| `React.lazy` | 部品は、そのタグが最初に現れたときに autoloader が読み込む。コードはメソッドの中で `import()` し、読む側を state のフラグで止める | 形が違う |
| error boundary | state の `$errorCallback(error, info)`: 失敗した束縛を聞き、ページが自分の代わりの表示を出す（`if: pageOk`）。state ごと —— 部品には部品のものがあります | 形が違う |
| portal | ダイアログとトーストを `<body>` の終わり、router の外に書く: 動かすものがありません。束ねるマークアップは `<body>` の中に | 形が違う |
| `flushSync`、`setState` の直後の ref | 書き込みはマイクロタスクで描かれます: それを現した値の `$watch` の中で要素を探します | 無い |
| `className={cx(…)}` | クラスごとに `class.NAME: flag`、または getter に `attr.class:` | 形が違う |
| `style={{ width: pct + '%' }}` | `style.width: pct|unit(%)` | そのまま |
| `onClick={() => remove(id)}` | `onclick: remove` —— ハンドラはメソッドの名前で、`(event, ...ループの添字)` を受けます。行は `this[".id"]` か `data-*` 属性で読みます | 形が違う |
| 制御された入力 | `value: path` | そのまま |
| ラジオのグループ | `attr.value: .value; radio: form.priority` —— 値が先 | そのまま |
| 楽観的な更新と巻き戻し | 同じコードで、キーを書く | そのまま |
| バッチ | 同じ: 続けて書いても描くのは 1 回 | そのまま |

## 何が噛みつき、誰がそれを言うか

どれも、作者が実際に書いたか、完成したアプリの写しでわざと作って、lint・型検査・単体テスト・e2e・ブラウザに
かけたものです。下の「lint」と `[wcs/…]` のコンソールのメッセージは 4.30 のものです。4.29 までは、
その多くが何も言いませんでした。

| 習慣 | 起きること | 誰が言うか |
|---|---|---|
| 束縛に式（`!loading`・`count + 1`・三項・`` `/r/${id}` ``・`format(date)`） | 束縛が失敗する: そんなパスは無い | lint `wcs/binding-expression`。コンソール: "An expression is not a path" |
| 属性の中の `{{ }}`（`href="/reports/{{ id }}"`） | 属性に波括弧が残る | lint `wcs/attribute-mustache`。`[wcs/attribute-mustache]` |
| 要素に書いた `if:` / `for:` | 常に表示・行は 1 つ | lint `wcs/structural-element`。`[wcs/structural-element]` |
| `key={…}` | 何もしない | lint `wcs/key-binding` |
| `this.items.push(x)`・`this.report.status = v` | 何も描かれない | lint `wcs/array-mutation`・`wcs/nested-assign` |
| `Set` に `this.selected.add(id)` | 何も描かれない | lint `wcs/collection-mutation` |
| `style: { width }` | style が付かない | `[wcs/style-object]` |
| `false` の `attr.disabled: flag` | `disabled="false"`: ずっと無効 | lint `wcs/binding-type-expectation` |
| 部品への `onSubmit: handler` | `Submit` という名前のイベントのリスナ | lint `wcs/event-name-case` |
| 行の中の固定の `id` | どの行も同じ id: ラベルは最初の行に届く | lint `wcs/row-id-shared` |
| inline の state の中の `./lib/x.js` の `import` | state が始まらない（`blob:` の URL から評価される） | lint `wcs/inline-import`。コンソールが書き方を言う |
| ページの state を戻さない（アンマウントも `key={id}` も無い） | 前のページの選択・文字・レコードが残っている | 誰も: 自分のテスト |
| cleanup の無い effect | 離れたページの interval とストリーム | 誰も |
| 中断しない取得、`await` の後の書き込み | 新しい URL の下に古い応答 | 誰も |
| 書き込みの直後の ref | `null` —— 要素が描かれるのはマイクロタスクの後 | 素の `TypeError` |
| キー入力のたびに来ると思った `onchange:` | DOM の `change`: 確定のとき | 誰も |
| `value#ro:` の下でハンドラが値を変換する | state が変わらないと、欄には打ったものが残る | 誰も: setter で正規化する |
| `<body>` の外に置いた束縛 | 束ねられない | 誰も |
| テキストに `false` | `false` と表示される（React は何も出さない） | 誰も |
| JSX の流儀の、要素の間の改行 | HTML は空白を保つ: `新規28 件` ではなく `新規 28 件` | 自分のテスト |
| 二度押しされた async のハンドラ | 要求が 2 回 | 誰も: `disabled: sending` と、先頭のガード |

そのまま持ち込めるもの: バッチ、楽観的な更新、束ねた入力の下でのオブジェクトのイミュータブルな更新（フォーカスも
キャレットも保たれる）、遅い CPU や IME での入力、そして `lib/` —— React の入っていないコードは、そのまま移りました。

## 移植を確かめる

- 手元の e2e を保ち、移植に対して走らせます: 静的な検査が見つけなかったものを見つけたのは e2e でした。role・label・
  テキストで探す e2e は、どのフレームワークがページを描いたかを気にしません。
- `npx @wcstack/lint --strict --root=<配信するディレクトリ> index.html parts/*.html`。`wcs-schema`
  （[`@wcstack/typescript`](../packages/typescript/README.md)）の `stateSchema` を付けると、パスの打ち間違いが error に
  なります。ページごとのモジュールを `...spread` で合わせた state は、lint には読めません: state を 1 つの
  オブジェクトリテラルに保つか、`mount=` のボリュームで分けます。
- `@wcstack/testing` の `mount()` は、実際の state のファイルと部品を単体テストに読み込みます。
