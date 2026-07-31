# framework adapter のバインド成立制約

- **作成日**: 2026-08-01
- **状態**: 設計判断記録（調査結果と推奨方針。実装は未着手。実機再現は未実施）
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

### Phase A1: Shell の property upgrade（wcstack 単独）

`connectedCallback` で own プロパティを取り込み直す共通ヘルパを入れる。`static wcBindable.inputs` に
入力名が既に宣言されているため、宣言を舐めるだけで機械適用できる。

```ts
protected _upgradeProperties(): void {
  for (const { name } of (this.constructor as typeof HTMLElement & { wcBindable: IWcBindable }).wcBindable.inputs ?? []) {
    if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
    const value = (this as any)[name];
    delete (this as any)[name];
    (this as any)[name] = value;
  }
}
```

挙動変更は「今まで捨てていた値が届くようになる」方向のみで、既存の属性経路には影響しない。ノードごとに
回帰テストを 1 本足す。

### Phase A2: 遅延定義構成の利用手順を明文化

adapter を使う場合は `customElements.whenDefined()` か `<wcs-defined>` でゲートしてから mount する、を
README と wcstack-app スキルに書く。既存の `connectedCallbackPromise` / `hasConnectedCallbackPromise` は
接続後の初期スナップショット取得用で、定義前の待機には使えないことも併記する。

### Phase A3: 上流への提案

`bind()` に定義待ちの選択肢（`syncOn: "define"` 相当、または `whenDefined` 後の再試行）を提案する。
core が「まだ upgrade していない」と「wc-bindable ではない」を区別できれば、18 個の adapter を個別に直さずに済む。
[棚卸し §5.6](12-wc-bindable-observable-inventory.md) の semantics metadata 提案とは独立に出せる。

### Phase A4: イベント名の代替経路

命名は変更しない（破壊変更のため）。代わりに、コロンを束縛できない framework 向けの受け方
（Angular は `Renderer2.listen` / 手動 `addEventListener`、React は ref + `addEventListener`）を
ドキュメント化する。親設計の決定ゲート 6 で event / handle surface を追加する場合、その surface は
テンプレート構文に依存しない形にする。

## 5. 検証条件

### Shell

- upgrade 前に property 代入した値が、upgrade 後に属性へ反映され、要素の動作に効く。
- 上記が `wcBindable.inputs` の全入力について成立する。
- 既に属性で与えられている場合、property upgrade が値を上書きしない（優先順位を固定する）。
- object を受け取る入力について、属性フォールバック時に沈黙して壊れないことを README で明示する。

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

Phase A1 は本書で挙げた中で唯一、上流も metadata も待たずに直せる実欠陥である。着手するならここから。

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
