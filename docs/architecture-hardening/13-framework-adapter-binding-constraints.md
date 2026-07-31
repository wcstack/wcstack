# framework adapter のバインド成立制約

- **作成日**: 2026-08-01
- **状態**: 設計判断記録。**Phase A1-A4 まで実施済み**（A1 = Shell の property upgrade 実装、
  A2 / A4 = [組み込み手順](../framework-adapter-integration.md)、
  A3 = [`bind()` 定義待ちの提案文書](../spec-proposal-bind-definition-timing.md)）。
  A0 の再現テストは合成オブジェクトによる適合テストで代替し、実ブラウザでの再現は未実施。
  残るのは upstream への提案提出と wcstack-app スキルの追随
- **対象**: `static wcBindable` を宣言する全 Shell、`@wc-bindable` の framework adapter、
  `@wcstack/autoloader` を前提とする配布経路
- **外部仕様スナップショット**:
  - `@wc-bindable/core@0.8.0`、`@wc-bindable/react@0.8.0`、`@wc-bindable/vue@0.8.0`（npm 配布物）
  - svelte / solid / angular / qwik / signals / rxjs は upstream `main` の実装（版ズレの可能性あり）

## 結論

[React の不変スナップショット](11-react-immutable-snapshot-boundary.md) と
[observable 棚卸し](12-wc-bindable-observable-inventory.md) は「配送された値の意味」を扱う。本書はその手前、
**そもそもバインドが成立するか**を扱う。両者は独立しており、値の分類がいくら正確でも、bind が張られなければ
何も届かない。

調査した8個の adapter はいずれも mount 時に `isWcBindable(el)` で判定し、偽なら**再試行せずに諦める**。
custom element の upgrade がその時点より後に起きる構成では、エラーもログもなく永久に無反応になる。
同じ「定義が遅れる」原因は入力側にも別の失敗を生む。framework が upgrade 前に DOM プロパティを代入すると、
own データプロパティが prototype accessor を恒久的に隠し、wcstack の Shell は値を受け取れない。
後者は wcstack 単独で修正できる producer 側の欠陥であり、`_upgradeProperty` 相当の実装が現在どのパッケージにも無い。

いずれも「adapter を使えば framework 相互運用が成立する」という公開上の主張の前提であり、
値の意味分類（Phase 0-4）とは別トラックで進めてよい。

## 1. 問題を 2 軸に分ける

### 1.1 観測側 — bind が張られない

adapter が `bind()` を呼ぶ時点で要素が未 upgrade だと、`getWcBindableDeclaration()` は `undefined` を返し、
`isWcBindable()` は偽になる。adapter はそこで早期 return する。要素参照は upgrade 後も同一なので、
React の依存配列も Qwik の `track()` も再発火せず、二度目の機会が来ない。

### 1.2 入力側 — property 代入が accessor を隠す

未 upgrade の要素は素の `HTMLElement` であり、`el.url = "x"` は own データプロパティを作る。upgrade 後に
class の accessor が prototype へ入っても、own プロパティが優先されるため setter は永久に呼ばれない。
custom elements で古くから知られた問題で、対策（`_upgradeProperty`）は producer 側の責務である。

この 2 つは同じ根（定義タイミング）から出るが、責務も修正箇所も異なる。1.1 は adapter / core、
1.2 は wcstack の Shell が直す。

## 2. 現状評価

### 2.1 adapter は「まだ」と「そもそも違う」を区別しない

読んだ実装はすべて同じ形をしている。

| adapter | bind を試みる時点 | 未 upgrade 時の挙動 |
| --- | --- | --- |
| react | `useEffect([el, onUpdate])` | 早期 return。`el` は不変なので再実行されない |
| vue | `onMounted` | 早期 return。再試行なし |
| svelte | action の初回 setup | 早期 return。`update` は params 変更時のみ |
| solid | directive 実行時 | 早期 return。再試行なし |
| qwik | `useVisibleTask$` | 早期 return。`track(() => ref.value)` は upgrade で再発火しない |
| angular | `ngOnInit` | 早期 return。再試行なし |
| signals / rxjs | 明示 `bind(el)` 呼び出し | 早期 return。呼び直しは利用者責務 |

`@wc-bindable/core` の `bind()` 自体も、宣言が読めないときは no-op cleanup を返して静かに終わる。これは
SPEC の「discovery == bindability」契約として一貫しているが、`syncOn: "connect"` が扱うのは
**接続**の遅延であって**定義**の遅延ではない。signals / rxjs は `syncOn: "connect"` を渡している最も慎重な
実装だが、その手前の `isWcBindable()` で落ちるため救われない。

顕在化の条件は「要素の定義が adapter の mount より後」である。Vite などで `@wcstack/<pkg>/auto` を静的 import
する構成では定義が先に済むため発生しない。発生するのは `@wcstack/autoloader` の動的 import、CDN の
`<script type="module">`、code-split で読み込みが遅れる経路である。**buildless / CDN 一発は wcstack の看板機能**
であり、この経路を「相互運用できる」と称している以上、無視できる条件ではない。

同型の問題は signals 側で既に決着させている（[定義タイミング規範](../signals-definition-timing.md)、
[初期化順序](01-binding-initialization-order.md)）。外部 adapter だけが未対応のまま残っている。

### 2.2 Shell に upgrade 対策が無い

wcstack の入力プロパティは prototype accessor で、setter は属性へ書く形に統一されている。

```ts
get url(): string { return this.getAttribute("url") || ""; }
set url(value: string) { this.setAttribute("url", value); }
```

`packages/**/src` を走査した範囲で、`connectedCallback` において own プロパティを取り込み直す実装
（`_upgradeProperty` 相当）は**1件も無い**。したがって upgrade 前に property 代入を行う framework では、
値が own プロパティに滞留して要素へ届かない。

framework 側の挙動は 2 系統に分かれる。

| 系統 | framework | 未 upgrade 時 | wcstack への影響 |
| --- | --- | --- | --- |
| 常にプロパティ代入 | Angular（`[prop]`）、Lit（`.prop=`）、Solid（`prop:`）、Vue（`.prop` 明示時） | own プロパティが accessor を恒久シャドウ | **値が届かない**。エラーなし |
| `key in el` で属性フォールバック | React 19、Vue（既定）、Svelte、Preact | 属性として設定される | scalar は属性バックなので無害。**object 入力は文字列化して壊れる** |

後者は wcstack の設計（属性バック accessor）のおかげで大半が無害という、意図せぬ幸運がある。壊れるのは
object を受け取る入力（`post`、`options`、`files` など）に限られる。

### 2.3 イベント名がテンプレートで束縛できない framework がある

wcstack のイベント名は `wcs-camera:stream-ready` のようにコロンを含む。Angular のテンプレートはコロンを
`target:event` の区切りとして解釈するため、`(wcs-camera:stream-ready)` は `Unsupported event target` になる
（angular/angular#28491 として未解決）。React の JSX でもコロンは名前空間名として扱われ、既定の Babel 設定では
そのまま書けない。

adapter 経由なら `bind()` が `addEventListener` を使うため影響しない。効いてくるのは、
adapter を使わず直接束縛する経路と、[棚卸し §5.6](12-wc-bindable-observable-inventory.md) が指摘した
「`event` / `handle` を values から外して別 surface で受ける」設計である。逃げ道として想定していた
「利用者が要素のイベントを直接聴く」が、これらの framework では素直に書けない。

## 3. 責務分界

| 問題 | 主責務 | 理由 |
| --- | --- | --- |
| upgrade 完了までの bind 保留 | wc-bindable core / adapter | 判定は discovery の一部で、adapter 単独では「まだ」を表現できない |
| 遅延定義構成での利用手順 | wcstack ドキュメント | 定義が遅れるのは wcstack 側の配布形態に起因する |
| upgrade 前 property の再取り込み | **wcstack Shell** | custom elements 標準の producer 責務。外部からは修正不能 |
| object 入力の属性フォールバック | wcstack ドキュメント + framework の明示構文 | 型を保つ手段は framework 側にあり、必要性を知らせるのは producer 側 |
| イベント名の表現可能性 | wcstack 命名 + adapter surface | 名前は producer が決めた。ただし改名は破壊変更なので surface で解く |
| framework の変更検知統合 | 各 adapter | zoneless / OnPush などは framework 固有。wcstack が肩代わりしない |

## 4. 推奨する段階導入

### Phase A0: 影響範囲の確定

定義が遅れる 3 経路（autoloader の動的 import、CDN の `<script type="module">`、code-split）で、
1.1 と 1.2 が実際に再現するかを確認する。最初の成果物は再現テストであり、この時点では修正しない。

### Phase A1: Shell の property upgrade（wcstack 単独）— 実装済み（2026-08-01）

`connectedCallback` の先頭で own プロパティを取り込み直す共通ヘルパを入れた。`static wcBindable.inputs` に
入力名が既に宣言されているため、宣言を舐めるだけで機械適用できる。

正本は `/protocol/upgrade-properties.ts` で、`scripts/sync-protocol-types.mjs` が
`packages/<pkg>/src/protocol/upgradeProperties.ts` として配る（protocol 型と同じ配布経路・CI の `--check` 対象）。

```ts
export function upgradeProperties(element: object): void {
  const inputs = (element as { constructor?: { wcBindable?: IWcBindable } }).constructor?.wcBindable?.inputs;
  if (inputs === undefined) return;
  for (const input of inputs) {
    const name = input.name;
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    if (!hasAccessorOnPrototype(element, name)) continue;   // public class field を壊さない
    const record = element as Record<string, unknown>;
    const value = record[name];
    delete record[name];
    record[name] = value;
  }
}
```

適用範囲は `static wcBindable` を宣言する 38 Shell（`<wcs-throttle>` は `<wcs-debounce>` を継承するため自動的に
covered、`<wcs-route>` は `inputs` を持たないため対象外）。`<wcs-router>` は `async connectedCallback` なので
最初の `await` より前に同期で呼ぶ。

挙動変更は「今まで捨てていた値が届くようになる」方向のみで、既存の属性経路には影響しない。

**副産物**: この作業で `raf` が `scripts/sync-protocol-types.mjs` の配布対象リストから漏れており、
`packages/raf/src/protocol/wcBindable.ts` が AUTO-GENERATED バナー付きのまま `--check` の対象外で
drift していたことが判明した（登録漏れ）。リストに追加して解消済み。

### Phase A2: 遅延定義構成の利用手順を明文化 — 実施済み（2026-08-01）

利用手順の正本を [framework アプリへの組み込み手順](../framework-adapter-integration.md) として置いた。
静的 import が最も確実であること、避けられない場合は `customElements.whenDefined()` で
**adapter を呼ぶコンポーネントがマウントされる前に**ゲートすること、
`connectedCallbackPromise` / `hasConnectedCallbackPromise` / `<wcs-defined>` / `setTimeout` が
代用にならない理由を明記した。object 入力の属性フォールバック（§2）と reactive proxy の raw 化（§3）も
同じ文書にまとめてある。

ルート README（en / ja）には 3 規則の要約と本文書へのリンクを追加した。
wcstack-app スキルは別リポジトリ（wcstack/wcstack-skill）なので、そちらの追随は別作業として残る。

### Phase A3: 上流への提案 — 提案文書作成済み（2026-08-01）

[`bind()` に「まだ定義されていない」を扱わせる提案](../spec-proposal-bind-definition-timing.md) を書いた。
案 A（`syncOn: "define"` の追加・推奨）/ 案 B（戻り値で `pending` を区別）/ 案 C（別関数）を比較し、
規範文言案・適合テスト条件・非目標まで含めてある。既定挙動を変えず core 1 箇所で済む案 A を推している。
[棚卸し §5.6](12-wc-bindable-observable-inventory.md) の semantics metadata 提案とは独立に出せる。

upstream リポジトリへの issue / PR 提出は未実施。

### Phase A4: イベント名の代替経路 — 実施済み（2026-08-01）

命名は変更しない（破壊変更のため）。代わりに、コロンを束縛できない framework 向けの受け方を
[組み込み手順 §4](../framework-adapter-integration.md) に書いた。adapter 経由なら影響しないこと、
Angular（`Unsupported event target`）と React（JSX の名前空間解釈）はテンプレートで書けないこと、
どの framework でも ref + `addEventListener`（Angular は `Renderer2.listen`）が可搬な経路であること、
この経路が必要になる代表例が `handle` 分類の `streamReady` であることを、実コード付きで示している。

Vue / Svelte / Solid のテンプレート構文でコロン付き名が書けるかは framework とバージョンに依存するため、
実測していない事実として断定せず、可搬な経路を推奨する形にした。

親設計の決定ゲート 6 で event / handle surface を追加する場合、その surface はテンプレート構文に
依存しない形にする。

## 5. 検証条件

### Shell

- [x] upgrade 前に property 代入した値が、upgrade 後に setter を通って反映される。
- [x] own プロパティが無い通常経路では何もしない（冪等・再接続で副作用が出ない）。
- [x] prototype 側が accessor でない own プロパティは触らない（public class field を壊さない）。
- [x] `inputs` 宣言を持たない要素、`wcBindable` を持たない要素で例外を投げない。
- 上記は `__tests__/protocol.upgradeProperties.test.ts`（生成配布される共有適合テスト）が各パッケージで固定する。
- [x] object を受け取る入力について、属性フォールバック時に沈黙して壊れることを利用者向けに明示する
  （[組み込み手順 §2](../framework-adapter-integration.md)・ルート README）。

### 遅延定義

- autoloader 経由で要素が定義される前に adapter が mount しても、定義後に初期値と後続イベントが届く。
- 上記が成立しない場合、利用者に見える形（README のゲート手順）で回避策が示されている。
- 定義が先行する通常構成で、追加した待機処理が初期配送を遅らせない。

## 6. 非目標

- wcstack のイベント名からコロンを外すこと。
- `@wc-bindable` の adapter を wcstack 側で fork / patch すること。
- 全 framework の変更検知・SSR・hydration を wcstack が肩代わりすること。
- 定義が遅れる構成そのものを廃止すること（buildless / CDN は本プロジェクトの前提）。

## 7. 決定ゲート

1. **upgrade 対象**: `wcBindable.inputs` の宣言だけを舐めるか、Shell の全 setter を対象にするか。
2. **適用範囲**: 35 パッケージ一括で入れるか、新規ノードと実害が確認されたノードから入れるか。
3. **待機手順の提示**: README 追記に留めるか、`<wcs-defined>` の利用を推奨形とするか、`auto` エントリ側で
   定義完了を保証する形まで踏み込むか。
4. **上流提案の形**: core に `syncOn: "define"` を足す案か、adapter 側の再試行に寄せる案か。
5. **イベント名**: 現行維持＋代替経路の文書化で確定してよいか。

推奨は、ゲート 1 を `inputs` 宣言ベース、ゲート 2 を一括（挙動変更が単方向で低リスクなため）、
ゲート 3 を README 追記から開始、ゲート 4 を core への提案優先、ゲート 5 を現行維持、とする。

## 8. 実施価値と優先度

| 観点 | 評価 |
| --- | --- |
| 静的 import 構成での即時障害 | 低い |
| autoloader / CDN 構成での実障害 | 高い |
| wcstack 単独で完結するか | Phase A1 / A2 は完結する |
| 上流依存 | Phase A3 のみ |
| 「React / Vue / Svelte / Solid と相互運用できる」という公開主張の裏付け | 高い |
| 値の意味分類（doc 11 / 12）との結合度 | 低い（独立に進行できる） |

Phase A1 は本書で挙げた中で唯一、上流も metadata も待たずに直せる実欠陥だった。実装済み。
A2 / A3 / A4 も文書として着地した。残るのは本リポジトリ外の 2 件——
[提案文書](../spec-proposal-bind-definition-timing.md) の upstream への提出と、
wcstack-app スキル（別リポジトリ）への追随である。

## 参照

- [React の不変スナップショットと wc-bindable I/O 境界](11-react-immutable-snapshot-boundary.md)
- [wc-bindable observable 棚卸し](12-wc-bindable-observable-inventory.md)
- [タグ定義とバインディング確立の順序](01-binding-initialization-order.md)
- [signals の定義タイミング規範](../signals-definition-timing.md)
- [非同期 I/O ノード作成ガイドライン](../async-io-node-guidelines.md)
- [`WcsWebSocket`（属性バック accessor の実例）](../../packages/websocket/src/components/WebSocket.ts)
- [Vue and Web Components（`in` 判定と `.prop` 修飾子）](https://vuejs.org/guide/extras/web-components.html)
- [React DOM Components — Custom HTML Elements](https://react.dev/reference/react-dom/components#custom-html-elements)
- [angular/angular#28491 — Namespaced Custom Events](https://github.com/angular/angular/issues/28491)
