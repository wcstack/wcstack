/**
 * core/parser/quoteAware.ts — 引用符を見る走査のヘルパー（拡張内で 1 つだけ）。
 *
 * `data-wcs` の区切り文字はどれも**引用符の外**にあるものだけが区切り（要件 B1）:
 * バインディングの `;`・フィルタの `|`・左右を分ける `:`・フィルタ引数の `,`。
 * 引用符を見ずに切ると、`value|defaults(':'): name` は左辺が `value|defaults('` で切れ、
 * `items|join(', ')` は引数が 2 個に数えられて、どちらも **error 重大度の
 * `wcs/filter-arity` を誤報**する（`join(', ')` は要件 B1 の代表例そのもの）。
 *
 * 式の区切り（`;`）は正本の `splitBindTexts` に委譲できるが、`:` / `|` / `,` の分割は
 * 正本が内部で使うだけで公開 API になっていない版があるため、規則をここに 1 つだけ持つ。
 *
 * 正本: `@wcstack/state` の `bindTextParser/utils.ts` の `indexOfOutsideQuotes` /
 * `splitOutsideQuotes`。実装は 1:1 で写す（閉じていない引用符はそのまま末尾まで続く扱い —
 * 不正な引用符はフィルタ引数の段で名指しで落ちる）。
 *
 * TODO（**次のリリースビルドで dist に両方が載ったら**）: `@wcstack/state/parser` から
 * `indexOfOutsideQuotes` と `splitOutsideQuotes` の両方を import できるようになったら、
 * このモジュールを消して正本へ委譲する（`splitBindTexts` と同じ形）。
 *
 * 現況（このコミット時点）:
 *   - `packages/state/src/parser.ts` には**両方 export 済み**。
 *   - しかし**コミット済みの dist（3.2.0）にはどちらも無い** — 載っているのは
 *     `clearParserCaches / getPathInfo / parseBindTextForEmbeddedNode /
 *     parseBindTextsForElement / splitBindTexts` の 5 つだけ。
 *   委譲は ESM の名前付き import なので、export を持たない dist に戻すと読み込み時に
 *   即死する。dist が追いつくまでは写しのままにしておくこと。
 *   `lastIndexOfOutsideQuotes` は正本に対応物が無いので、委譲後もここに残る。
 *
 * ---
 *
 * **`data-wcs` 構文で区切りになる文字はこれで全部**（`@wcstack/state` の `define.ts` の定数と
 * manifest の `syntax` を突き合わせた全数。次の「区切り軸」を探す必要は無い）:
 *
 *   引用符の影響を受ける（＝このモジュール経由にする）:
 *     - `;` バインディングの区切り（`BINDING_SEPARATOR`）
 *     - `:` 左辺 / 右辺の区切り（`PROP_VALUE_SEPARATOR`）
 *     - `#` 修飾子の区切り（`MODIFIER_SEPARATOR`）
 *     - `|` フィルタの区切り（`FILTER_SEPARATOR`）
 *     - `,` フィルタ引数の区切り（`filter(a, b)` の中）
 *     - `(` / `)` フィルタ引数の囲み — ランタイム（`parseFilters`）自身が
 *       `indexOf('(')` / **`lastIndexOf(')')`** で切るので、拡張もそれに 1:1 で合わせる
 *       （`service/bindingValidator.ts` の `parseFilterSegments`）。引用符は見ない側が正本。
 *
 *   引用符の影響を受けない（素の走査のままでよい。理由付き）:
 *     - `.` パス / プロパティ名前空間の区切り（`DELIMITER`）— 区切る対象はパスや
 *       プロパティ名で、そこに引用符は現れない（引用符が出るのはフィルタ引数だけ）。
 *     - `,` **修飾子リスト**の区切り（`#ro,wo`）— ランタイムも `propModifiersText.split(',')`
 *       と素で切る。修飾子は入力フィルタより前なので、その区間に引用符は来ない。
 *     - `*` / `**` ワイルドカード（`WILDCARD` / `RECURSION_WILDCARD`）・`$` 添字と API の
 *       接頭辞（`INDEX_PARAM_PREFIX`）・`...` spread・`else` / `on` / 先頭 `.`（明示の
 *       プロパティ形）— いずれも**トークンの一部**であって区切り文字ではない。
 *     - `@` — v2 で撤去された名前次元。検出して報告するだけで、区切りには使わない。
 *       走査対象は常に「最初の `|`（引用符の外）より前」に切り出したパス部分。
 *
 * ---
 *
 * **拡張内の「区切り走査」の全数リスト**（次に同じ調査をする人が再調査しないで済むように。
 * `data-wcs` / mustache の区切りを見るものは**すべてこのモジュール経由**にしてある）:
 *
 * 対象外と判定したもの（引用符を見ないが、見る必要がない）:
 *   - `service/ariaValidator.ts` / `service/ioNodeValidator.ts` / `service/bindingValidator.ts`
 *     の `#` 走査 — どれも `parseBindingExpression` が**フィルタを分離したあとの
 *     `property`** に対して掛かるので、走査する文字列に引用符が残っていない。
 *   - `service/recursionPaths.ts` / `service/mountAttrValidator.ts` の `#` / `$` / `@` 検査 —
 *     マウントパス・state パスの**予約文字**の検出であって区切りではない（パスに引用符は無い）。
 *   - パスを `.` で切る走査（`core/index/referenceIndex.ts` / `service/forContext.ts` /
 *     `service/recursionPaths.ts` / `service/scanDeclarationValidator.ts` /
 *     `service/mountAttrValidator.ts` ほか）— 上記のとおりパスに引用符は現れない。
 *   - `@` の検出（`service/bindingContext.ts` / `service/bindingValidator.ts` /
 *     `service/forContext.ts`）— 引用符の外の `|` で切ったパス部分だけを見る。
 *   - `service/templateSyntax.ts` の mustache 終端の正規表現（`:39` / `:101`）— 引用符
 *     非対応だが、ランタイムの `mustache/convertMustacheToComments.ts` と**文字単位で同一**
 *     なので 1:1（ここだけ厳しくすると拡張とランタイムが割れる）。同ファイルのコメント
 *     バインディングの `:`（`:76` / `:124`）は `@@` 直後の最初の `:` で、手前に引用符が来ない。
 *   - `service/forContext.ts:91` の `([^"']+?)` — 属性値の切り出しであって区切り走査ではない。
 *
 * **JS ソース側**（`<wcs-state>` スクリプト）は別モジュールの担当:
 * `service/scriptPatterns.ts` の `execAllMasked`（コメント・文字列リテラルの中身を潰した
 * 鏡像に対して走査し、キャプチャは原文から切り出す）。`stateAnalyzer` の
 * `maskCommentsAndStrings` が鏡像の正本。
 *   - `service/scriptCallArgs.ts` の `splitCallArgs` — **JS ソース**の実引数分割。走査ループが
 *     自前で引用符（`'` / `"` / `` ` `` とエスケープ）を飛ばしているので既に引用符対応。
 *   - `service/stateAnalyzer.ts` のオブジェクト / 配列走査 — すべて `maskCommentsAndStrings` の
 *     鏡像（文字列の中身が空白に潰れたもの）に対して走るので、区切りが文字列の中に現れない。
 *   - `core/sidecar/jsonSource.ts` — `wcstack.manifest.json` の JSON 字句解析。自前の文字列
 *     トークナイザを持つ別ドメイン。
 *   - 型ユニオンの `|` 分割（`service/bindingValidator.ts` の `resolveResultType` /
 *     `service/stateAnalyzer.ts` / `service/stateTypeValidator.ts`）— JSDoc の `@type` であって
 *     バインディング構文ではない。
 *   - `service/wcsCompletionPlugin.ts` の補完トリガ文字リスト — 走査ではない。
 *
 * pure（DOM / vscode 非依存）。依存を持たない（どの層からも import してよい）。
 */

const isQuote = (c: string): boolean => c === "'" || c === '"';

/**
 * `text` の中で、引用符（`'` / `"`）の外にある最初の `char` の位置。無ければ -1。
 */
export function indexOfOutsideQuotes(text: string, char: string): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (isQuote(c)) {
      quote = c;
    } else if (c === char) {
      return i;
    }
  }
  return -1;
}

/**
 * `text` の中で、引用符（`'` / `"`）の外にある**最後の** `char` の位置。無ければ -1。
 *
 * 正本に対応物は無い（ランタイムは後ろから探す必要がない）。補完の文脈判定が
 * 「カーソル直前の最後のフィルタ区切り」を要るために持つ。走査は前から 1 回で、
 * 引用符の状態機械は `indexOfOutsideQuotes` と同じ — 後ろから探すと、閉じていない
 * 引用符（入力途中の `join('`）で内外の判定が反転する。
 */
export function lastIndexOfOutsideQuotes(text: string, char: string): number {
  let quote: string | null = null;
  let found = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (isQuote(c)) {
      quote = c;
    } else if (c === char) {
      found = i;
    }
  }
  return found;
}

/**
 * `separator` で区切る。ただし引用符の中は区切らない（要件 B1）:
 * `join(';')` / `join('|')` / `join(', ')` の区切り文字は引数であって、
 * バインディング・フィルタ・引数の区切りではない。
 * 前後の空白は残す（tooling が位置を数えられるように — 正本と同じ）。
 */
export function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (isQuote(c)) {
      quote = c;
    } else if (c === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
