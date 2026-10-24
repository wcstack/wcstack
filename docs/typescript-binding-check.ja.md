# `data-wcs` の結び付けを TypeScript で検査する

- **状態**: 検討・試作・設計（2026-10-24）。ブランチ `research/typescript-binding-check`、[typescript-content-mapper.ja.md](./typescript-content-mapper.ja.md) の上に乗る。未実装。§8 の決定は著者のもの。
- **読み手**: wcstack の静的検査（`wcs-validate`・VS Code 拡張・`wcs-tsc`・content mapper）を設計・保守する人と、方針を決める著者。
- **数値の出どころ**: リポジトリの外（scratchpad）に置いた試作の mapper を、TypeScript 7.1.0-beta の `tsc --runExternalCode` と `tsc --lsp` で、例の 58 ページ（`examples/` と各パッケージの `examples/`）にかけた結果。比較の相手は同じページへの `wcs-validate --lang=en`。

## 1. 発想

content mapper（TypeScript 7.1）は `.html` 全体を受け取り、任意の TypeScript と範囲の対応を返せる。いまの mapper が TypeScript に渡すのは `<wcs-state>` のスクリプトだけだが、**結び付け（`data-wcs`・`{{ }}`・`<!--@@: -->`）も TypeScript の式に落とせば、結び付けの誤りを TypeScript 自身が属性の中の位置で報告できる**。vue-tsc がテンプレートを型検査するのと同じ発想である。

```html
<p data-wcs="textContent: coutn"></p>
```

```ts
// state のブロックの出力の末尾に、mapper が合成する（coutn の文字を属性の中の文字に結ぶ）
{ const { coutn: __v } = __s; }
// → page.html(21,27): error TS2339: Property 'coutn' does not exist on type '__WcsBindView<__T0>'.
```

## 2. いまの検査は二本立て

| 対象 | 誰が検査するか | 型の出どころ |
|---|---|---|
| `<wcs-state>` のスクリプト | TypeScript（`wcs-tsc`・拡張・content mapper） | TypeScript の推論 |
| 結び付けのパス・フィルタ・構文 | `wcs-validate`（拡張と CLI の共通の検証器） | スクリプトを解析した**候補集合**（推定。だから `wcs/binding-path-missing` は warning）か、`wcs-schema` が作る sidecar の `stateSchema`（あれば error） |

`stateSchema` を作る `wcs-schema` は TypeScript のコンパイラ API を使うので、TypeScript 7 では動かない（[typescript-content-mapper.ja.md](./typescript-content-mapper.ja.md) §7）。

## 3. 仮説

- **H1** パスの検査が「推定の候補集合」から「TypeScript の推論した型」になる。
- **H2** インラインの state なら `wcs-schema` も sidecar も要らない。
- **H3** 型でしか言えないことが言える（`for:` の対象が配列か、`onclick:` の先が関数か、フィルタの入力の型、要素のプロパティの型）。
- **H4** エディタでも同じ判定になり、hover や定義ジャンプも効く。

## 4. 問い

| # | 問い | 答え（§6） |
|---|---|---|
| Q1 | パスの誤りを、属性の中のパスの位置で報告できるか | できる。合成の文字から始まる範囲は前の段の終わりにずれるので、キーの引用符は Atom で結ぶ |
| Q2 | どの式の形なら `noImplicitAny` に依らず報告され、文言が読めるか | 分割代入。要素アクセスは `noImplicitAny` のときだけ報告される |
| Q3 | state の型を結び付けの検査にどう届けるか | `export default X` を `const __wcsState = X; export default __wcsState;` にし、検査はモジュールの末尾に置く。呼び出しのコールバックの中に置く形は、型が黙って `any` になった |
| Q4 | 文法の範囲 | 結び付け 1,301 件のうち 1,178 件（90.5%）を検査。残りはトークン（98）・置き場所に依存する `src`（24）・添字（1） |
| Q5 | `wcs-validate` との一致 | 正しいページで TypeScript 版は 0 件、`wcs-validate` は 76 件（うち 9 件は型が分かる誤報）。打ち間違いの検出は TypeScript 97.3%、`wcs-validate` 99.2%（ただし全件 warning で、正しいページにも出す） |
| Q6 | 型でしか言えない検査の誤報 | `for:`・`on*:`・フィルタは誤報 0。要素のプロパティの型は厳密に比べると 23 件の誤報（数値を文字列のプロパティへ）、緩めると 0 件だが何も捕まえない |
| Q7 | 型の限界 | 形の分からない部分木（`any`・`null`・`{}`・空の配列の行）は黙らせる。4.6.2 の getter の `any` は本体の写しで取り戻せる。JavaScript のオブジェクトリテラルの型は開いている。どれも「黙って効かなくなる」危険を持つ |
| Q8 | 速さ | 58 ページで 330 ms → 535 ms（中央値、起動込み） |
| Q9 | 役割分担 | §7.6 |
| Q10 | エディタ | 言語サーバーの診断は CLI と同じ。hover は全形で、定義ジャンプは最上位のキーで効く |

## 5. 試作

試作は約 500 行の mapper で、vscode-wcs の部品（`parseWcsStateElements`・`stripWcsImportRanges`・`getterAnnotationOffsets`・`findAllBindAttributes`・`parseBindTextWithPositions`・`findAllMustacheSyntax` / `findAllCommentBindings`・`getRowShorthandForPath` / `getResolvedForListPath`・manifest の `builtinFilterMeta`）を import し、esbuild で束ねた。検査の種類はオプションで切り替える。

測り方は 3 つ。

1. **フィクスチャ**: 意図した 10 件の誤り（存在しないパス・`for:` に数値・`onclick:` に数値・フィルタの入力の型・知らないフィルタ・volume のパス・コメントの結び付け）と、黙るべき形（path getter・`$1`・省略パス・空の配列の行）を 1 ページに置く。
2. **正しいページ**: 例の 58 ページは実際に動くので、結び付けの診断が出れば誤報である。
3. **突然変異**: 例のページを写し、検査できる結び付けのパスの末尾すべてに `Zq` を足し（1,196 か所）、TypeScript 版と `wcs-validate` がそれぞれ変異の位置で報告したかを数える。

## 6. 結果

### 6.1 位置と式の形（Q1・Q2）

- **分割代入** `const { "users.*.nmae": __v } = __s;` は、`noImplicitAny` の有無に依らず TS2339 を出す。要素アクセス `__s["users.*.nmae"]` は `noImplicitAny` のときだけ TS2551（「Did you mean」付き）を出し、無ければ黙る。関数の引数（`path<P extends keyof S>(p)`）は TS2345 で、文言が型の和になる。→ 分割代入を使う。「Did you mean」は出ない。
- 誤りの範囲が合成の文字（キーの引用符）から始まると、TypeScript はその始点を前の段の終わりに寄せる（`coutn` が列 32、`.nmae` が前のパスの直後と報告された）。キーの対応は次のように作る。
  - 識別子として書けるパス（`count`）: 引用符なしのキーを Verbatim で結ぶ。
  - それ以外（`users.*.name`）: 引用符を、パスの両端の長さ 0 の位置への Atom にし、中身を Verbatim で結ぶ。
  - 書いた文字と検査するキーが違う省略パス（`.name` → `users.*.name`）と volume のパス: キー全体を、書いたパスへの Atom で結ぶ。
- 上の 3 形で、フィクスチャの 10 件はすべて属性の中の正しい行と列に出た。突然変異でも、捕まえた変異はすべて変異の位置ちょうどに出た。

### 6.2 state の型の届け方（Q3）

supplemental の出力は import できないので、検査は state を定義するブロックの出力の中に置く必要がある。

1. **最初の形**: `export default __wcsBindings(defineState({…}), (__s) => { …検査… })` とし、コールバックの引数の型を `T` から作った。結び付けの検査はこれで動いた。ところが getter の型を取り戻そうとして、コールバックの中で `typeof __t` から作った型を使うと、それから導いた型がすべて `any` になり、どの検査も黙った（エラーは出ない）。
2. **採った形**: `export default X` を合成の `const __wcsState = X; export default __wcsState;` にし（`export default ` の文字は結ばない）、検査はモジュールの末尾に `type __T0 = …typeof __wcsState…` から置く。変数の型は初期化式だけで決まり、検査が推論に絡まない。
3. **volume**（`<wcs-state mount="cart">`）: `cart.` で始まるパスは、`cart.` を外して volume のブロックで検査する。
4. **`src` の state**（`<wcs-state src="./state.js">`）: その要素のための出力で `import __wcsState from "./state.js"` する。JavaScript のファイルのオブジェクトリテラルの型は TypeScript では**開いて**いて（無いプロパティを読んでも誤りにならない）、そのままではどの検査も黙った。mapped type（`{ [K in keyof S]: S[K] }`）に通して閉じる。

### 6.3 文法の範囲（Q4）

| 形 | 扱い |
|---|---|
| 属性の結び付け・`{{ }}`・`<!--@@: -->` | 検査する |
| `for:` の中の `*` のパス・path getter のキー（`"users.*.ageCategory"`） | そのままキーになる |
| 省略パス（`.name`・`.`） | 囲む `for` で展開する。入れ子の相対 `for`（`for: .cards`）は `getResolvedForListPath` で解決する（`wcs-validate` はこれを飛ばしていた） |
| volume のパス | volume のブロックで検査する |
| `on*:` のハンドラ | メソッド名をキーとして検査し、関数かを確かめる |
| `$1` などの添字・`$command.x`・リテラル・`**` | 検査しない（`wcs-validate` が持つ） |
| `eventToken.*:`・`command.*:` | 検査しない（右辺はトークンの名前） |
| `src` の state | 相対パスの `.js` / `.mjs` / `.ts` / `.mts` だけ。`/app.js` のような位置はサーバーの配置次第なので型を届けられない |
| `json` / `state` 属性の state | 試作では扱っていない（例のページに無い） |

例の 58 ページの 1,301 件のうち 1,178 件（90.5%）を検査した。残りはトークン 98、`/app.js` の `src` 24、添字 1。

### 6.4 正しいページでの誤報と、打ち間違いの検出（Q5）

**正しいページ**（58 ページ）:

| | 結び付けの診断 |
|---|---|
| TypeScript 版（`strict: false`。例の CI の設定） | **0** |
| TypeScript 版（`strict: true`） | **0**（getter の型に `NonNullable` を掛けた後。ほかに `src` の 2 ページでカナリアが鳴く — §6.6） |
| `wcs-validate` | 76 件の warning |

`wcs-validate` の 76 件は 2 種類だった。

- **型が分かるのに誤報**（9 件）: state の値がモジュールの定数（`products: products`）や式（`Array.from(…)`）、getter から来ているもの。候補の解析は識別子を辿れないが、TypeScript の推論は辿れる。
- **形の分からない部分木**（67 件）: `[]` で始まるリストの行、`null` で始まる値の下。TypeScript 版はここで黙る（§6.6）。

**突然変異**（型を届けられる 57 ページの 1,172 か所）:

| | 件数 |
|---|---|
| 両方が捕まえた | 1,131 |
| TypeScript だけ | 9（入れ子の相対 `for` の中の省略パス） |
| `wcs-validate` だけ | 32（31 件は形の分からない部分木。`wcs-validate` はそこでは正しいパスにも同じ warning を出す） |
| どちらも捕まえない | 0 |
| **検出率** | TypeScript 97.3%（error）・`wcs-validate` 99.2%（すべて warning） |

### 6.5 型でしか言えない検査（Q6）

| 検査 | 正しいページでの誤報 | 備考 |
|---|---|---|
| `for:` の対象が配列（または `null` / `undefined`） | 0 | |
| `on*:` の先が関数 | 0 | |
| フィルタ（manifest の `acceptTypes` / `argTypes` / `resultType` から `interface WcsFilters` を合成） | 0 | 入力の型の誤りはパスの位置に、知らないフィルタは名前の位置に「Did you mean 'upper'?」付きで出る |
| 要素のプロパティの型（`HTMLElementTagNameMap[tag][prop]`） | **23** | すべて `number` を `string` のプロパティ（`textContent`・`value` など）へ。ランタイムが変換するので誤報 |
| 同、文字列のプロパティに `number` / `boolean` も許す | 0 | ただし例のページでは何も捕まえない |

### 6.6 型の限界と「黙って効かなくなる」危険（Q7）

試作で、検査が**エラーを出さずに全部黙る**ことが 4 回あった。どれも、検査の型がどこかで `any` 相当に崩れたためである。

| 原因 | 手当て |
|---|---|
| コールバックを通した推論（§6.2） | 検査をモジュールの末尾に置く |
| getter の本体の「誤りの型」: `this["query.sort"]` のように型の無いパスを読む getter の戻り値は、表示は `any` だが内部では誤りの型で、それを含む型の計算をすべて飲み込んだ（router-admin の 167 件が 0 件になった） | getter の写しの `this` を、形の分からない部分木を開いた型にする（読みが素の `any` になる）。詰め直しは getter ごとに別の型にし、その getter の下のパスにだけ使う |
| JavaScript のオブジェクトリテラルが開いている（§6.2） | mapped type で閉じる |
| `strict: true` で `src` の `state.js` 自身に型の誤りがあると、その state の型が崩れる | 直していない — 下のカナリアが捕まえる |

**カナリア**: 上流の `diagnosticDirectives` の `expect` を使い、各 state の検査の先頭で、どの state にも無いキー（`"__wcsCanary"`）を検査する。検査が生きていればその誤りは期待どおりで消え、型が崩れて誤りが出なければ、TypeScript が mapper の用意した文言を `<wcs-state>` の開始タグの位置に出す（`error wcs2001: The data-wcs checks of this <wcs-state> stopped working: …`）。わざと型を `any` にすると鳴き、例のページ（`strict: false`）では 1 度も鳴かず、`strict: true` では上の `src` の 2 ページで鳴いた。

ほかの限界:

- **形の分からない部分木**: 型が `any` / `unknown` / `null` / `undefined` / 中身の無い `{}`、または要素が `any` / `never` の配列の行の下は、どのパスも受ける（`wcs-validate` が素の `{}` の下で黙るのと同じ）。外から来るデータ（`<wcs-fetch>` の結果・ルーターの `routeParams`・WebSocket で届く行）はここに入り、突然変異の 31 件を見逃した理由である。インラインのスクリプトは JavaScript で、仮想コードは TypeScript として読まれるので、**JSDoc の型注釈は効かない**（`/** @type {Item[]} */` を書いても `[]` は `never[]` / `any[]`）。
- **getter の型**: 4.6.2 で、`this` を読む getter の型を循環を断つために `any` にした。結び付けの検査は state の型が決まった後で行うので、getter の本体の写しを型の決まった `this` で評価し、その戻り値の型（`NonNullable`）で詰め直せる。写しの中の誤りは ignore の directive で隠す。これで変異の検出が 6 件増えた。`strict: true` では path getter が `Map.get` の結果（`T | undefined`）を返すので、`NonNullable` が要った。
- **配列の `.length`**: `users.length` は正しいパスだが、プリアンブルのパスの型には無い。配列と文字列のパスに `.length` を足す。
- **パスの深さ**: プリアンブルの展開は深さ 4 で止まる。例のページでは当たらなかった。
- **`src` を import する副作用**: `src` のファイルが program に入り、`checkJs` ならそのファイル自身も検査される。例の設定（`strict: false`）では何も出ず、`strict: true` では例の `state.js` の型の誤りが多数出た。

### 6.7 速さ（Q8）

58 ページ、5 回の中央値（起動込み）: 結び付けの検査なし 330 ms、すべての検査あり 535 ms。

### 6.8 エディタ（Q10）

`tsc --lsp --stdio`（`runExternalCode` 付き）に、フィクスチャのページで聞いた。

- **診断**: CLI と同じ 10 件。
- **hover**: 識別子のパス（`count` → `(property) count: number`）は分割代入のキーで効く。引用符の要るパスは、分割代入のキーの文字列では返らない。そこで編集のためだけの要素アクセス `void (__s as … & { readonly [key: string]: unknown })["users.*.name"]` を足し、対応の `features` を hover・定義に絞ると、`(property) "users.*.name": string` が返る。キーを受ける index signature を付けるので、無いパスの誤りは二重に出ない。省略パスもこれで返る（volume の中のキーとして表示される）。
- **定義ジャンプ**: 最上位のキー（`count` → state の `count: 0`）は飛べる。`users.*.name` のような導出したパスは mapped type が作るキーなので宣言が無く、飛べない。

## 7. 設計

### 7.1 どこに入れるか

content mapper の変換（`packages/vscode-wcs/src/contentMapper/transform.ts`）に入れる。state のブロック（と相対パスの `src`）の出力の末尾に結び付けの検査を足す。言語プラグインの仮想コード（Volar の Language Server モードと `wcs-tsc` の tsc モード）に同じ合成を入れるかは §8 で決める。

### 7.2 出力の形

```ts
// [プリアンブル][検査の補助の型と宣言]          ← ignore（プリアンブルと同じ）
// …ユーザーコード…
const __wcsState = defineState({ … }); export default __wcsState;   // `export default X` を書き換える
// …ユーザーコードの残り…
// --- binding checks ---
type __T0 = { [K in keyof typeof __wcsState]: (typeof __wcsState)[K] };   // 閉じる（§6.2）
const __s = null as unknown as __WcsBindView<__T0>;
{ const { "__wcsCanary": __c } = __s; }                              // expect（§6.6）
const __g0 = function (this: __WcsBindView<__T0>) { …getter の本体の写し… };   // ignore
const __s0g = null as unknown as __WcsBindView<Omit<__T0, "cards"> & { readonly "cards": NonNullable<ReturnType<typeof __g0>> }>;
{ const { count: __v } = __s; }                                       // 存在
{ const { "users": __v } = __s; __wcsList(__v); }                     // for:
{ const { inc: __v } = __s; __wcsHandler(__v); }                      // on*:
{ const { "price": __v } = __s; void __wcsF.toFixed(__v, 2); }        // フィルタ
{ const { "cards.*.title": __v } = __s0g; }                           // getter の下
```

- `__WcsBindView<T>` = `_WcsThis<T>` ＋ 配列と文字列のパスの `.length` ＋ 形の分からない部分木の下のすべてのパス（`any`）。
- 検査は結び付けごとに 1 つのブロック文にし、同じ名前（`__v`）を使い回す。
- 識別子として書けるパスは引用符なし。そうでないパスは §6.1 のとおり 3 つの段で結び、hover のための要素アクセスを添える。

### 7.3 検査する・しない

| 検査 | 入れるか |
|---|---|
| パスの存在（属性・`{{ }}`・`<!--@@: -->`・省略パス・入れ子の相対 `for`・volume・`src`） | 入れる |
| `for:` の対象は配列 | 入れる |
| `on*:` の先は関数 | 入れる |
| フィルタの入力・引数（manifest から合成） | 入れる |
| 要素のプロパティの型 | 入れない（§6.5） |
| `$1`・`$command`・トークン・`**` | 入れない（`wcs-validate` が持つ） |

### 7.4 形の分からない部分木

`wcs-validate` と同じく黙らせる（§6.6）。外から来るデータの形を書けるようにする道（下の Q-c）は別の作業。

### 7.5 黙って効かなくなる危険への備え

- **カナリア**: 各 state、各 getter の詰め直しの型に 1 つずつ置く（`wcs2001`）。
- **テスト**: 突然変異のテストを恒久のテストにする。例のページの結び付けを 1 つずつ壊し、検出の率が下がらないこと、正しいページで 0 件であることを、TypeScript 7.1 の e2e で確かめる。

### 7.6 `wcs-validate` との役割分担

`wcs-validate` は TypeScript 無しで動き、拡張・CLI・`wcs-schema` の sidecar の検査を担う。TypeScript の結び付けの検査は **TypeScript 7.1 の content mapper を使うプロジェクトでの追加の層**で、型が分かる場所では error を、分からない場所では沈黙を返す。

両方を動かすプロジェクトでは、同じ打ち間違いが `wcs-validate` の warning と TypeScript の error の 2 つで出る。

- CLI（`wcs-validate` と `tsc`）は別の道具なので、重複は許す。
- エディタでの重なりは、content mapper の拡張側の案 A / 案 B（[typescript-content-mapper.ja.md](./typescript-content-mapper.ja.md) §6）と一緒に決める。

### 7.7 文言

型の名前は `__WcsBindView<__T0>` と出る（例: `Property 'coutn' does not exist on type '__WcsBindView<__T0>'`）。利用者に読める名前（`WcsState` など）を別名にするかは §8 で決める。分割代入には「Did you mean」が出ない。

## 8. 著者の決定

1. **入れるか・いつ**: content mapper（TypeScript 7.1 の stable の後の最初の minor で experimental の予定）と同じ版で、オプション `bindings`（既定 on）として入れるか、content mapper が stable になってから入れるか。推奨: 同じ版で入れる。正しいページで誤報 0・検出 97.3% と測れており、カナリアで止まったことも見える。
2. **言語プラグイン（5 / 6 の `wcs-tsc`・Volar のエディタ）にも入れるか**: 入れれば 5 / 6 の `wcs-tsc` と拡張でも同じ判定と hover になる。ただし拡張では `wcs-validate` の warning と重なる。推奨: まず content mapper だけ。プラグインへは、エディタの重なりの方針（案 A）と一緒に。
3. **要素のプロパティの型**: 入れないか、緩めた形で入れるか。推奨: 入れない（誤報か、何も捕まえないかのどちらか）。
4. **`src` の state を import するか**: 検査の範囲は広がるが、`src` のファイルが program に入る副作用がある。推奨: import する。副作用は文書に書き、型が崩れた場合はカナリアが知らせる。
5. **型の名前の別名**（§7.7）: `WcsState` などにするか。推奨: `WcsState`（ユーザーコードの名前と衝突しうるので、衝突したら今の名前に戻す）。

残る問い（この文書の外）:

- **Q-a** 定義ジャンプを導出したパスにも効かせるか（キーの宣言の位置を合成で用意する必要がある）。
- **Q-b** `wcs-validate` の `wcs/binding-path-missing` を、TypeScript の検査が働く state では出さないようにするか。
- **Q-c** インラインの JavaScript で、外から来るデータ（空の配列・`null`）の形をどう書かせるか。JSDoc の型注釈は TypeScript として読む仮想コードでは効かない。検証器の `jsdocType.ts` を使い、JSDoc から TypeScript の型注釈を合成する道がある。

## 9. 参照

- [typescript-content-mapper.ja.md](./typescript-content-mapper.ja.md) — content mapper（プロトコル、範囲の対応、directive）
- microsoft/TypeScript `tsc/internal/contentmapper/hostimpl.go`（directive の `expect` と `unusedExpectDirectiveDiagnostics`）、`tsc/internal/spanmap/spanmap.go`（Verbatim / Atom、features）
- `packages/vscode-wcs/src/service/bindingValidator.ts` — いまの結び付けの検査（`wcs/binding-path-missing`）
