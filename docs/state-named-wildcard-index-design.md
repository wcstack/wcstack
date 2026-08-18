# 名前付きワイルドカード添字（軸名テーブル + インデックスオブジェクト）検討記録

/ 対象: `@wcstack/state` / 状態: **検討記録・未決**（2026-08-17）

導入するかは未決である。§2 は有力案であって決定ではない。判断に必要な材料は
§1.1（実際の需要）、§4.4（導入しない）、§4.5（より小さい案）、§8（未決事項と
再検討トリガー）に置いた。着手する場合は §8 のトリガーを満たしてから。

## 1. 問題

ワイルドカード添字は `$1` / `$2` … の位置番号でしか参照できない
（`proxy/traps/get.ts` の `INDEX_BY_INDEX_NAME` 経路、`define.ts` で
`MAX_WILDCARD_DEPTH` 個が生成される）。段が 2 つ以上あり、かつワイルドカードの
間に非ワイルドカードのセグメントが挟まると、番号と軸の対応が読めなくなる。

```js
get "users.*.profiles.licenses.*.registDate"() {
  return fmt(this.$1, this.$2);   // $1 = users 段、$2 = licenses 段。パスを数えないと分からない
}
```

同じ問題が `$getAll` / `$resolve` の `indexes` 位置引数にも出る。

```js
this.$getAll("users.*.profiles.licenses.*.amount", [2])   // [2] はどちらの段の 2 なのか
```

さらに `$1` の番号は**末尾起点**で数えられる（`list/wildcardLevel.ts` の
`listIndexAtWildcard`）。これは bind-component の子スコープで base 深さ Δ を持っても
番号がずれないための正しい規則だが、「1 段目」が何を指すかを読者が二重に
（宣言パスと、スコープの深さから）解く必要があるという意味では可読性の負債である。

これは**可読性のみの問題**である。値の取得・依存追跡は現行のままで正しく動く。

### 1.1 実際の需要（2026-08-17 時点の実測）

上の例は説明用に作ったものなので、リポジトリ内の実コードを数えた。**深いパス自体は
実在するが、そこで `$1` を使っている箇所は 1 つしかない**。

| 実例 | 段数 | `$1` 利用 |
|---|---|---|
| `regions.*.states.*.*`（`__e2e__/states-population`、`examples/state-population`） | 2 | **あり**（下記） |
| `weeks.*.days.*.*` 6 本（`examples/calendar`） | 2 | なし（全てパス参照のみ） |
| `regions.*.prefectures.*.cities.*.density`（`packages/state/docs/path-getters.md`） | 3 | なし |

唯一の利用箇所は getter 内の `$1` ではなく **`$getAll` の位置引数**である。

```js
// packages/state/examples/state-population/index.html
get "regions.*.summaryPopulation"() {
  return this.$getAll("regions.*.states.*.population", [ this.$1 ]).reduce(summaryPopulation, 0);
}
```

したがって §1 の問題提起は実例で裏付けられる一方、**深いパスでも `$1` を使わない
書き方が主流**という反対の観測も同時に成り立つ。この頻度が、導入の可否
（§4.4）と範囲（§4.5）を決める一次資料になる。

## 2. 有力案（決定ではない）

**軸名テーブル（案 A）で軸に名前を付け、名前でインデックスオブジェクトを引けるようにする。**
`$1` は number のまま据え置き、パス文字列の文法は一切変更しない。

主目的は可読性であり、性能・正しさの改善は目的に含めない（§7 参照）。
この案を採るかどうかは §4.4 / §4.5 / §8 と併せて判断する。

### 2.1 軸名の宣言

名前は**ワイルドカード親パス（＝リストのパス）に 1:1 で紐づけて**、状態定義に一度だけ宣言する。

```js
export default {
  $indexNames: {
    "users": "u",
    "users.*.profiles.licenses": "l",
  },
  get "users.*.profiles.licenses.*.registDate"() {
    return fmt(this.$u, this.$l);
  }
};
```

軸（どのリストか）に名前が紐づくため、**どの getter から見ても同じ名前が同じ軸を意味する**。
宣言側に `*` が出るのは不格好だが、軸は「どのリストか」で識別されるべきなので正しい形である。
宣言サイトごとに名前が変わる余地を残さないことが、この案の安さの根拠でもある（§4.1）。

### 2.2 名前の解決

`get` トラップの `INDEX_BY_INDEX_NAME[prop]` 判定の隣に、名前 → 軸パス → 評価中
`pathInfo.wildcardParentPaths` 内の段位置、という解決を足す。段位置が決まれば
以降は `$1` と完全に同じ経路（`listIndexAtWildcard`）に合流する。

宣言表に無い `$` プロパティは**従来どおり `undefined` を返す**（`get.ts` の
未知 `$` プロパティのフォールスルー）。この選択の代償は §5.2 に記す。

### 2.3 インデックスオブジェクト

名前で引いた `$u` / `$l` は number ではなく、そのスコープのインデックスオブジェクトを返す。
実体は既存の `IListIndex` を read-only proxy でラップしたもので、ラッパーは
WeakMap でキャッシュする（**行ごとの新規生成は禁止** — 行数 × getter 数の割り当てになる）。

```js
get "users.*.profiles.licenses.*.amountDelta"() {
  const prev = this.$l.prev;   // 境界（l 軸の先頭）では null
  return this["users.*.profiles.licenses.*.amount"]
       - (prev?.["users.*.profiles.licenses.*.amount"] ?? 0);
}
```

（`$u.prev` のように**親軸**へ遡る場合はこの形では解決できない。§8-3）

- 数値が要る場所では `Symbol.toPrimitive` / `valueOf` / `toString` で number 互換を保つ
- `.prev` / `.next` / `.offset(n)` はスコープ差し替えのパス読み取り器を返す。読み取りは
  通常の `getByAddress` 経路を通るので、`proxy/methods/checkDependency.ts` の既存機構
  （動的依存の登録、他行読み取りの検出）がそのまま効く
- `uuid` / `version` / `dirty` / `parentListIndex` といった `IListIndex` の内部は露出させない

これにより、現行の他行参照イディオム
（`__tests__/integration.diffExpansion.test.ts` の「隣接項目参照」テスト）

```js
const i = this.$1;
if (i === 0) return this["items.*.v"];
return this["items.*.v"] - this.$resolve("items.*.v", [i - 1]);
```

が、パス文字列と添字配列の二重指定を挟まない形に書き換えられる。

### 2.4 名前付き引数

`$getAll` / `$resolve` の `indexes` は `number[]` を維持したまま、名前をキーにした
オブジェクトも受け付ける。

```js
this.$getAll("users.*.profiles.licenses.*.amount", { u: 2 })
```

段の順序ミスが構文で防げる。部分縮約（`u` を固定して `l` だけ集計）は現行の
位置引数でも表現できており、ここで増えるのは可読性だけである。

## 3. 変更しないもの

| | 理由 |
|---|---|
| `$1` / `$2` … の number 契約 | README の「0-based value」は公開契約。テンプレートの `{{ $1\|inc(1) }}` とイベントハンドラ引数も number |
| パス文字列の文法 | §4.1 |
| DOM バインド経路 | `apply/getValue.ts` などが `INDEX_BY_INDEX_NAME` を見て number を直接返しており、proxy の `get` を通らない。名前は getter / イベントハンドラ内の JS からのみ見える |
| `listIndexAtWildcard` の末尾起点 | 子スコープのスコープ相対契約の根拠。名前解決も同じ経路に合流させる |

## 4. 採らなかった案

### 4.1 パス内添字（案 B）: `users.$u.profiles.licenses.$l.registDate`

einsum の見た目には近く、かつ**オフセットをパス文字列に書けるという決定的な利点**がある。

```js
this["users.$u.profiles.licenses.$(l-1).amount"]   // (level, offset) がパース時点で静的に取れる
```

しかしパス文字列はシステム全体の正規化キーであり、コストが桁違いに大きい。

- `address/PathInfo.ts` はパスを `split(".")` して `segments[i] === WILDCARD` で軸を数える。
  さらに `getPathInfo` の結果は `Map` キャッシュと `Set<IPathInfo>` による**インスタンス同一性**
  判定に使われる
- パス文字列は `staticDependency` / `dynamicDependency`、`getterPaths`、`listPathSet`、
  `indexDependentGetterPaths`、`crossRowListPaths`、SSR コメント、`data-wcs` 右辺すべての
  キーである。`users.$u.name` と `users.*.name` が別キーになった時点で依存グラフが分裂する
- したがって「名前付き添字を `*` に正規化し、名前表を別に持つ」＝**名前をパスの
  アイデンティティに含めない**ことが必須条件になる。加えて名前表は frozen かつ
  グローバル共有な `PathInfo` には置けない（同じ正規パスを別名で宣言しうる）ため、
  宣言サイト単位の表が要る
- `data-wcs` パーサを共有しているため、HTML 側にも同じ文法が漏れる
- vscode-wcs の追随が必要になる

可読性が主目的である限りこのコストは正当化できない。**パス内オフセットの静的解析まで
狙う場合にのみ再検討する**（§7）。

### 4.2 `$1` そのものをインデックスオブジェクトに置き換える

`$1` を number からオブジェクトへ差し替える案。getter 内の既存コードが壊れる。

- `i === 0` — 上記の隣接参照テストのコードそのもの。厳密等価が黙って false になる
- `$resolve(path, [i - 1])` / `$getAll(path, [i])` — `proxy/apis/resolve.ts` が
  `listIndexes[index]` を引くため、オブジェクトを渡すと `raiseError` に落ちる
- README の 0-based value 契約

さらに、オブジェクト化そのものからは**トラッキング上の増分が得られない**。`i - 1` の
時点で `Symbol.toPrimitive` / `valueOf` が呼ばれて number に落ちるため、「-1 された」
というオフセットは原理的に取れない。「`$1` を読んだ」事実は既に `get.ts` の
`addIndexDependentGetterPath` が記録済みである。情報が増えるのは `.prev` /
`.offset(n)` のような明示 API を通った時だけであり、価値の源泉はオブジェクト化ではなく
明示 API 側にある。よって §2.3 のとおり**新サーフェス（名前）にだけオブジェクトを載せる**。

### 4.3 einsum の類推の限界

einsum の力は「同じ文字が同じ軸を意味する」ことと、**軸の自由な組み替え・縮約**
（`"ij,jk->ik"`）の 2 つである。この設計に持ち込めるのは前者だけで、後者は来ない。

- state のパスは木であり、`users.*.licenses.*` の 2 軸は親子関係で固定されている。
  `licenses` 軸だけを独立に走査する、`u` と `l` を転置する、といったことは構造上ありえない
- 軸の共有自体は既に位置ベースで成立している。`address/calcWildcardLen.ts` が共有
  ワイルドカード段を前方一致で算出し、`users` 段の `listIndex` を自動で引き継ぐ。
  名前を付けてもこの対応関係を変えられるわけではない（変えられたら木構造が壊れる）

したがって名前から得られるのは**軸のラベル付け**であり、軸の代数ではない。

### 4.4 導入しない

**現時点でこれが対抗馬として最も強い。**

得るものは可読性だけで、§1.1 のとおり実需要は 1 箇所である。対して支払うものは:

- 新しい予約キー `$indexNames`（`$` 名前空間はユーザーの状態オブジェクトと同居するため、
  一度公開したら削れない）
- 同じ概念に 2 つの綴り（`$1` と `$u`）が並存する（§8-1）
- 宣言漏れ・typo が例外にならず undefined が伝播する新しい失敗モード（§5.2）
- 追随先 5 箇所（§5.4）。うち vscode-wcs はビルド済み `dist` 経由なので破綻が遅れて出る

可読性のための機能がデバッグ困難な失敗モードを新設する、という形になっている点が
特に重い。**「読みにくいが正しく動き、失敗モードも増えない現状」を上回るという
根拠は、現時点では出ていない。** §8 の再検討トリガーは、この判断を将来やり直すための条件である。

### 4.5 §2.4 のみの最小案（名前付き引数だけ）

`$indexNames` の軸名テーブルとインデックスオブジェクトを入れず、**`$getAll` /
`$resolve` の位置引数を名前で書けるようにするだけ**の案。

§1.1 で見つかった唯一の実需要はまさに `$getAll` の位置引数なので、この最小案で
実需要は満たせる可能性がある。ただし名前をどこから引くかという問題は残る:

- **軸名テーブルを引く** → 結局 `$indexNames` が要る（最小案にならない）
- **パスから自動導出**（`regions.*.states.*` なら `{regions: 0, states: 1}`）→ 宣言不要で
  最も安いが、セグメント名が重複するパス（`items.*.items.*`）で破綻する。また
  「名前＝リストのセグメント名」という暗黙の規則を増やす
- **位置引数のまま、可読性は別の手段（コメント・ローカル変数）で解く** → コストゼロ

安さの順では 3 番目が最も安く、§4.4 の「導入しない」に接続する。2 番目を採る場合は
重複セグメントの扱いを決める必要がある。**この 3 択は未決**（§8-4）。

## 5. 制約と罠

### 5.1 `$` 名前空間の衝突

`define.ts` の予約キー（`$connectedCallback`、`$updatedCallback`、`$bindables`、
`$commands`、`$commandTokens`、`$command`、`$eventTokens`、`$on`、`$streams`、
`$listKeys`、`$streamStatus`、`$streamError`）と `get` トラップ内の API 名
（`$stateElement`、`$getAll`、`$postUpdate`、`$resolve`、`$trackDependency`、
`$untrackDependency`）はすべて 2 文字以上であり、`$1`〜`$128` は数字なので、
1 文字名は現状すべて空いている。

将来の予約キー追加で衝突しうるため、**`$indexNames` 宣言時に予約語チェックを行い
`raiseError` する**。長い名前（`$stream` など）を許すとこのリスクが上がる。

### 5.2 宣言漏れ・typo が silent になる

`$1` は解決できないとき `raiseError` するが、未知の `$` プロパティは `undefined` を返す
（`get.ts` のフォールスルー）。`$u` の宣言漏れや打ち間違いは例外にならず undefined が
伝播する。宣言表にある名前だけを解決して他は従来どおり undefined にするのが互換上は
安全であり、その代償として typo の沈黙を受け入れる。

（将来 `config.debug` 時に「宣言表に無い 1 文字 `$` プロパティ」を警告する余地はある。）

### 5.3 子スコープでの軸パス

bind-component 配下では軸パスが親側で `outer.users` のようにマップされる
（`webComponent/crossBoundaryAddress.ts` / `MappingRule.ts`）。`$indexNames` は
**その状態定義自身のスコープのパスで書く**規約とする。親の名前は子に見えない。

これは `$1` の自スコープ相対契約（README: “A component's author never has to know how
deeply it is placed.”）と一貫している。

### 5.4 追随先

`$indexNames` は新しい予約キーであり、構文契約にあたる。

| 追随先 | 内容 |
|---|---|
| `manifest.syntax` の golden | 予約キーの追加 |
| vscode-wcs | `stateAnalyzer` の予約キー、preamble、`packages/lint/dist`（tracked） |
| `packages/state/README.md` / `README.ja.md` | `$1` / `$2` の節、状態 API 表 |
| `packages/state/docs/path-getters.md` / `.ja.md` | パス getter の利用者向け正本。3 段ワイルドカードの例を載せているが `$1` の記述は現在ゼロ。軸名を入れるならここが第一の説明場所になる（英語正本 + `.ja.md` の両方） |
| wcstack-skill の references | `$1` を説明している箇所 |

vscode-wcs は state の**ビルド済み `dist`** を消費するため、壊れるのは増減の瞬間ではなく
次の build 時になる（`state-filter-addition-followup` の前例）。

## 6. 実装範囲

| 箇所 | 変更 |
|---|---|
| `define.ts` | `STATE_INDEX_NAMES_NAME = "$indexNames"` |
| 宣言処理（`$streams` / `$listKeys` に倣う） | 表の検証（予約語・軸パスの存在・名前の重複）と登録 |
| `proxy/traps/get.ts` | `INDEX_BY_INDEX_NAME` 判定の隣に名前解決を追加。段が決まれば `listIndexAtWildcard` に合流 |
| インデックスオブジェクト | `IListIndex` の read-only proxy（WeakMap キャッシュ）と `.prev` / `.next` / `.offset(n)` |
| `proxy/apis/getAll.ts` / `resolve.ts` | `indexes` に名前キーのオブジェクトを受け付ける |

`address/`、`bindTextParser/`、依存グラフ、`data-wcs` パーサ、SSR は**無改造**。

## 7. 範囲外（この案では解かない）

1. **オフセット追跡の静的化** — `(getterPath, wildcardLevel, offset)` を記録して
   `dependency/walkDependency.ts` の `crossRowListPaths` による全行展開フォールバック
   （`selectExpansionIndexes`）を変化行 × オフセット種数に狭める話。§2.3 の `.prev` /
   `.offset(n)` は通過時点でオフセット量を記録できる**器**にはなるが、記録と展開の
   実装はここに含めない。着手するなら先に全行フォールバックの実コストを測ること。
   記録単位は行 ID ではなく**オフセット**でなければならない（行 ID 間のエッジは
   並び替えで全滅し、結果として全行展開と同じコストになる）。

   着手する場合に踏む罠が 1 つ判明している。`indexDependentGetterPaths` を
   **静的依存グラフ経由で引いてはならない**。静的依存は `State.setPathInfo` が
   「バインドされたパスから親方向へ」張るため、他の getter からしか読まれない
   getter（`.label` だけを描画し `.rank` は `.label` からしか読まない綴り）は
   そこに現れない。`getMovedRowExpansionPaths` がこれを踏んでおり、移動行の
   `$1` 依存 getter が古い値のまま残っていた（`fix/state-index-getter-expansion` で
   `indexDependentGetterPaths` のプレフィックス照合に変更して修正済み）。
   オフセット台帳も同じ場所で引かれるので、同じ罠が再現する。
2. **行方向の評価順序** — 他行の getter を読む再帰チェーンと循環。
   `dependency/topologicalRank.ts` の rank は**パス単位**なので、`items.*.diff` →
   `items.*.diff` のような同一パスの行間依存には順序を与えられない。現状は
   `MAX_LOOP_DEPTH` の打ち切りのみ。名前付き添字とは独立の課題
3. **パス内オフセット構文** — §4.1。1 を静的解析まで持っていく場合にのみ再検討

## 8. 未決事項と再検討トリガー

§2 を採る場合、着手前に次を決める必要がある。いずれも現時点では決めていない。

1. **`$1` と `$u` のどちらを推奨とするか** — §3 で `$1` を据え置くため、同じ概念に
   2 つの綴りが並存する。「新規は名前」「2 段以上なら名前」「`$1` は非推奨」の
   いずれも決めていない。**可読性が唯一の目的である以上、読み手が 2 種類の綴りを
   行き来するコストは、この設計が最適化しようとしている当のものを損なう。**
   指針を決められないなら導入しない方が一貫する（§4.4）
2. **インデックスオブジェクトの型** — §2.3 は `$u` を「`IListIndex` の read-only proxy」と
   定義しつつ、`.prev` / `.next` / `.offset(n)` は「スコープ差し替えのパス読み取り器」を
   返すと書いており、**両者が別の型になっている**。`$u.prev.prev` が書けるのか、
   `$u.prev` が number 互換かが決まっていない
3. **親軸の `.prev` が解決不能になるケース** — `$l.prev`（同じ user の 1 つ前の license）は
   自然だが、`$u.prev`（1 つ前の user 行）の配下は licenses の行数が違うため、
   `$u.prev["users.*.profiles.licenses.*.amount"]` は l 軸の listIndex が定まらない。
   raiseError にするか、l 軸の明示を要求するか
4. **`$getAll` / `$resolve` の引数の境界条件** — `number[]` と名前キーオブジェクトの
   両方を受ける（§2.4）にあたり、次が未定義: 宣言されていない名前／パスに含まれない
   軸の名前／**一部だけの指定**（現行の位置引数は部分指定できる。§2.4 自身が
   「部分縮約」に言及しているので綴りが要る）／両形式の混在。あわせて §4.5 の 3 択
5. **silent undefined を許容するか** — §5.2。可読性のための機能が、typo を例外に
   しない失敗モードを新設する形になっている。`config.debug` 時の警告で足りるか、
   宣言表にある名前の解決失敗は `raiseError` にすべきか

### 再検討トリガー

次のいずれかを満たしたら §4.4（導入しない）の判断をやり直す。満たさないうちは
この文書を「検討記録」のまま置く。

- **深いパス（2 段以上）で `$1` / `$2` を読む箇所が 5 箇所を超えたとき** — §1.1 の
  実測は 1 箇所。数え直しは `["'][a-zA-Z_$][a-zA-Z0-9_.]*\.\*\.[a-zA-Z0-9_.]*\.\*\.`
  の grep と、その周辺での `$1` 利用の目視で足りる
- **外部から可読性の要望が出たとき**（issue / skill 利用者からの報告）
- **§7-1 のオフセット追跡に着手するとき** — そのとき `.prev` / `.offset(n)` が
  オフセット量を記録する器として必要になるため、§2.3 が独立した価値を持つ。
  ただしその場合の主目的は可読性ではなく性能なので、優先順位から評価し直すこと
