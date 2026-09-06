# 設計: `$setAll` — ワイルドカードパスへの一括書き込み

- **状態**: 論点整理完了・決定済み（2026-08-24）。§0 の決定レコードが正本。
- **対象**: `@wcstack/state` の core 拡張（proxy API 1 個）。updater / 依存グラフの機構自体には触らない。
- **一言で**: `$getAll`（読み）の対称形。「**リスト全置換を回避して in-place に一括更新する**」ための唯一の手段。
- **双対**: [`$getAll`](../packages/state/src/proxy/apis/getAll.ts)。走査（添字タプルの列挙）を共有し、順序が一致することを規範とする。

---

## 0. 決定レコード

| ゲート | 論点 | 決定 |
|---|---|---|
| **D1** | 何を作るのか | **ワイルドカードパスにマッチする全アドレスへの一括書き込み**。存在理由は「配列を作り直さずに一括更新する」こと（§1）。 |
| **D2** | シグネチャ | **関数形（mapper）を第一級**とする。`$setAll(path, indexes, valueOrFn, options?)`（§2）。 |
| **D3** | 値の多義性 | `typeof === "function"` なら **mapper**。**配列は既定でブロードキャスト**、要素別に配るのは `{ spread: true }` を明示したときだけ（§3）。 |
| **D4** | `indexes` | **必須**。意味は `$getAll` と同じ**前方一致の接頭辞**。超過は `wcs/index-arity` で throw（§4）。 |
| **D5** | `undefined` | **常に書き込みスキップ（no-op）**。クリアは `null`。mapper の `return` 忘れ事故を防ぎ、「この行は変えない」の表現力を得る（§5）。 |
| **D6** | 走査と書き込み | **2 相**（全アドレスを確定 → まとめて書く）。走査は `$getAll` と共有するが、**読みの差分基準（`lastValueByListAddress`）は書きからは更新しない**（§6）。 |
| **D7** | 依存グラフ | **動的依存を登録しない**。`$resolve` は書き込み時も登録している（既存のとげ）が、これは継承しない（§7）。 |
| **D8** | 末尾ワイルドカード | **許す**。`$setAll("users.*", …)` は各要素の in-place 置換（§8）。 |
| **D9** | 戻り値 | **実際に書き込んだ件数**（`undefined` スキップ分を含まない）。 |
| **D10** | `spread` の長さ不一致 | **throw**。黙って切り詰めない・余りを捨てない（§3-3）。 |

---

## 1. 出発点 — 書き側の対称形が無い

読み側はワイルドカード階層をフラット化できるのに、書き側にそれが無い。

```js
this.$getAll("users.*.selected", []);        // ✅ 読める
this["users.*.selected"] = true;             // ❌ throw
```

後者が throw するのは、生の `*` が [`ResolvedAddress`](../packages/state/src/address/ResolvedAddress.ts) で `wildcardType: "context"` に分類され、[`getListIndex`](../packages/state/src/proxy/methods/getListIndex.ts) がループ文脈を要求するため。メソッド内（文脈なし）では `ListIndex not found` になる。

現状の回避策は自前ループしかない。

```js
for (let i = 0; i < this.users.length; i++) {
  this.$resolve("users.*.selected", [i], true);
}
```

ネスト（`regions.*.prefectures.*.enabled`）では各段の長さを自分で取りながらの多重ループになり、実質書けない。読み側が `$getAll(path, [])` 一発なのと釣り合っていない。

### 1-1. 存在理由は「リスト全置換の回避」

一括更新の代替として書かれがちなのはこれ。

```js
this.users = this.users.map(u => ({ ...u, selected: true }));   // ← これを避けたい
```

配列を作り直すと ListIndex・行 getter キャッシュ・差分描画が全部作り直しになる（in-place 変異規範）。`$setAll` は「**意味は一括更新、実体は in-place な個別書き込み**」を提供する。これが単なる糖衣ではない理由。

なお [`setByAddress`](../packages/state/src/proxy/methods/setByAddress.ts) の same-value guard（既定 ON）が効くので、既に同値の行は書き込み自体がスキップされる。全選択の 2 回目がほぼ無コストになるのはこの API にとって嬉しい性質。

---

## 2. シグネチャ

```ts
/** ブロードキャスト — マッチした全アドレスに同じ値を書く */
$setAll(path: string, indexes: number[], value: any): number;

/** mapper — アドレスごとに現在値と添字から新しい値を算出する（第一級・D2） */
$setAll(path: string, indexes: number[], fn: (current: any, ...indexes: number[]) => any): number;

/** spread — 配列を要素別に配る。`$getAll` の戻りをそのまま戻すための形 */
$setAll(path: string, indexes: number[], values: any[], options: { spread: true }): number;
```

```js
this.$setAll("users.*.selected", [], true);                    // 全選択
this.$setAll("users.*.selected", [], cur => !cur);             // 全反転
this.$setAll("cart.items.*.price", [], (p, i) => p * rate[i]); // 添字つき
this.$setAll("matrix.*.*", [0], 0);                            // 0 行目だけ全列
this.$setAll("users.*.selected", [], flags, { spread: true }); // 配列を配る
```

### 2-1. なぜ mapper が第一級なのか（D2）

`$getAll` → `map` → `$setAll` の往復には、**読みと書きの間に state が変わると黙って別の行に書く**という危険がある。`$getAll` の戻り値は値の配列だけで、どのアドレス由来かの情報を持たない。長さが一致していれば検出もできない。

mapper 形は読みと書きが同一の走査に乗るので、この危険が原理的に消える。往復（`spread`）は「どうしても外で加工したい」場合の補助であり、既定の書き方ではない。

### 2-2. `spread` を使うときの規範

**`$getAll` と `$setAll` の間で state を変更してはならない（MUST NOT）。** 変更した場合の対応は未定義。長さが変わっていれば §3-3 の検査で落ちるが、長さが同じまま並びだけが変わった場合は検出できない。

加えて `$getAll` は純粋な読みではない（差分基準の更新と ListIndex の生成という副作用を持つ）ので、往復の間に別の `$getAll` を挟むことも避ける。

---

## 3. 値の多義性をどう切るか（D3）

第 3 引数の型で「ブロードキャスト」と「要素別配分」を切り替える設計は**採らない**。対象プロパティ自体が配列型のとき区別できないため。

```js
$setAll("users.*.tags", [], ["admin"]);
// 全員に ["admin"] を入れたいのか、1 人目に "admin" を配りたいのか判別不能
```

しかもこの失敗は静かで、行数と配列長がたまたま一致すると誤った解釈のまま通る。曖昧なら throw するという `wcs/index-arity` 導入時の判断と逆方向になる。

### 3-1. 判定順

1. `options.spread === true` → **spread**（`values` は配列であること。違えば throw）
2. `typeof value === "function"` → **mapper**
3. それ以外 → **ブロードキャスト**（配列も含む）

`spread` と mapper の同時指定は throw（意味が定義できない）。

### 3-2. 関数そのものを値として書きたいとき

mapper から返す。

```js
this.$setAll("handlers.*.fn", [], () => myFunction);
```

state に関数を保持するケースは実質無いため、配列と違って多義性の実害はほぼ無い。

### 3-3. `spread` の長さ検査（D10）

`values.length !== マッチ件数` は **throw**。切り詰めも余りの黙殺もしない。これは `$getAll` / `$resolve` の添字本数検査で「超過が黙って捨てられていた」欠陥を潰したときと同じ思想。

---

## 4. `indexes` の意味（D4）

`$getAll` と同じ**前方一致の接頭辞**。不足はその階層を全展開、超過は throw。

| API | 添字の本数 | 不足したとき |
|---|---|---|
| `$resolve` | 厳密一致 | throw |
| `$getAll` | 上限 | 残りの階層を全展開 |
| `$setAll` | 上限 | 残りの階層を全展開 |

診断メッセージは `indexArityMessage` を `"$setAll"` に拡張して共有する（コンソール → lint → IDE の三面共有という `errorGuidance.ts` の規約）。

### 4-1. 省略を許さない

`$getAll` は添字省略時にループ文脈から導出する分岐を持つが、`$setAll` はこれを持たない。書き込み API に暗黙の文脈依存を入れると「どこに書いたか分からない」事故になるため。`[]` の明示を必須とする。

したがって `for` の中で `$setAll("users.*.selected", [], true)` と書けば、それは**現在行ではなく全行**を意味する。

---

## 5. `undefined` の扱い（D5）

**常に書き込みをスキップする。** 3 つの形すべてで同じ規則。

理由は 3 つ。

1. mapper の `return` 忘れ（`(cur) => { cur.selected = true; }`）が全行を `undefined` で潰す事故を防ぐ。
2. 「この行は変えない」という表現力が手に入る。これは mapper を第一級にした価値を素直に高める。

   ```js
   this.$setAll("users.*.rank", [], (cur, i) => i < 3 ? i + 1 : undefined);  // 上位 3 件だけ
   ```
3. クリアは `null` という語彙が既に spread の prop 配送側にあり、揃う。

`$resolve` は `typeof value !== "undefined"` を get/set の判別に使っているため、そもそも `undefined` を書けない。`$setAll` は引数の個数で判別するのでこの制約は無いが、上記の理由で意図的にスキップ側へ倒す。

---

## 6. 走査と書き込みは 2 相に分ける（D6）

```
第 1 相: path + indexes → 解決済み添字タプルの集合 → 各タプルの IStateAddress を確定
第 2 相: 確定したアドレスに対してのみ書く
```

走査しながら書くと、書き込みが ListIndex 集合を動かしうる。`$getAll` が `resultIndexes` を先に materialize している形をそのまま使う。

### 6-1. 走査は共有し、順序を規範とする

添字タプルの列挙は `wildcardIndexes.ts` に切り出して `$getAll` と `$setAll` で共有する。順序は**深さ優先・添字昇順**（ネストは添字タプルの辞書順）で決定的。

**`$getAll(p, i)` の戻り順と `$setAll(p, i, …)` の適用順は一致する。** これが `spread` 形が成立する唯一の根拠であり、規範として固定する。

### 6-2. 読みの差分基準は書きからは更新しない

走査は各ワイルドカード階層で `createListDiff` を使い、その結果を `lastValueByListAddress` に記録する。これは**次の読みの差分基準**なので、所有権は `$getAll` 側に残す。`$setAll` は走査を借りるだけで、この記録は commit しない。

なお ListIndex の正本レジストリ（`listIndexesByList`）への登録は `createListDiff` の中で行われるため、`$setAll` の走査経由でも一貫する。実際の値アクセスは添字タプルから正本レジストリを引き直して行うので、走査中に生成された ListIndex がそのまま書き込み先になることはない。

---

## 7. 依存グラフには登録しない（D7）

`$getAll` / `$resolve` は冒頭で「いま評価中の getter が、このパスに依存する」という動的依存を登録する。これは**読みのための機構**。

`$resolve` はこのブロックを `value` の有無を判定する前に無条件で走らせているため、**書き込みでも動的依存が登録される**（既存のとげ）。getter が書き込んだパスに getter 自身が依存することになり、無効化が回り続けかねない。`$setAll` はこれを継承しない。

`$resolve` 側の修正はこの設計の対象外（挙動変更のリスクが別物なので分離する）。

---

## 8. 末尾ワイルドカード（D8）

`$setAll("users.*", [], value)` を許す。`$getAll("users.*", [])` の対称形として自然であり、実装上も追加コストが無い（[`setByAddress`](../packages/state/src/proxy/methods/setByAddress.ts) の leaf-`*` 分岐が既に `Reflect.set(parentArray, index, value)` を行う）。

意味論は**各要素の in-place 置換**。

```js
this.$setAll("users.*", [], rows, { spread: true });   // 配列 identity を保ったまま全行差し替え
```

配列の identity が変わらないため listDiff は走らず、**行ごとの更新として伝播する**。これは `this.users = rows` の全置換と対照的で、§1-1 の存在理由がそのまま末尾ワイルドカードにも当てはまる。

ワイルドカードを含まないパス（`$setAll("users", [], v)`）も同様に許す。マッチは 1 件で、`$getAll("users", [])` が 1 要素の配列を返すことと対称。

---

## 9. 性能

書き込み 1 件ごとに `enqueueAbsoluteAddress` + `walkDependency` が走る。N 件なら N 回。

- **再描画は 1 回**。updater が microtask でバッチに畳む。
- **依存 walk は N 回**。自前ループと同コストであり退行ではないが、「一括だから速い」わけではない。README にこれを明記する。
- same-value guard により、既に同値の行は walk ごとスキップされる（§1-1）。

同一 `pathInfo` に対する walk の 1 回化は将来の最適化余地として残す。

---

## 10. `data-wcs` からは呼ばない

`$setAll` は state のメソッド内専用。`data-wcs` は配線であって DSL ではないため、バインディング式から直接呼ぶ形は提供しない。

全選択チェックボックスの正規形はこれ。

```html
<input type="checkbox" data-wcs="onchange: toggleAll">
```

```js
toggleAll(e) {
  this.$setAll("users.*.selected", [], e.target.checked);
}
```

---

## 11. 追随先

`$` API を 1 個足すと実装以外に以下が要る。**4〜6 は vscode-wcs 側で、`@wcstack/*` ではないため CI マトリクスに載らない。state 側だけ直すと壊れるのは次の build 時になる。**

| # | 追随先 | 内容 |
|---|---|---|
| 1 | `packages/state/src/defineState.ts` | `WcsStateApi` の型宣言 |
| 2 | `packages/state/src/proxy/traps/get.ts` | get トラップの switch |
| 3 | `packages/state/src/pathDiagnostics.ts` | `indexArityMessage` の `api` に `"$setAll"` |
| 4 | `packages/vscode-wcs/src/language/preamble.ts` | `WcsStateApi` の複製 |
| 5 | `packages/vscode-wcs/src/service/semanticValidator.ts` | `API_CALL` 正規表現＋arity 検査（上限側に分類） |
| 6 | `packages/vscode-wcs/src/core/messages.ts` | 診断メッセージの文言 |
| 7 | `packages/state/README.md` | API 表と解説（`$getAll` の直後） |
| 8 | wcstack-skill リポジトリ | references の API 一覧（別リポジトリ） |

---

## 12. 非スコープ

- **`$resolve` の依存登録の修正**（§7）— 別案件として分離する。
- **`@stateName` 越境の `$setAll`** — 自 state のパスのみ。`$getAll` と同じ境界。（v2 で名前次元ごと消滅 — ツリーは 1 本）
- **walk の 1 回化による最適化**（§9）— 実測してから。
- **`data-wcs` からの直接呼び出し**（§10）— 提供しない。
