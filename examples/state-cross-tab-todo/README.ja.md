# state + storage + broadcast デモ(クロスタブ Todo)

Todo リストを 2 つのレイヤーで同時に扱うデモです。

- **永続(Durable)** — `@wcstack/storage`(`<wcs-storage>`)がリストを `localStorage` に保存し、ついでに他のすべてのタブへ自動で反映します。
- **一過性(Ephemeral)** — `@wcstack/broadcast`(`<wcs-broadcast>`)が「誰が今なにをしたか」というライブ信号を運びます。これは**あえて永続させません**。

**バックエンドはありません**。データは `localStorage`、タブ間転送は `BroadcastChannel`、どちらも純粋なブラウザ API です。サーバーは `index.html` を返すだけです。

## Getting Started

パッケージは CDN([esm.run](https://esm.run))から読み込むため、ローカルビルドは不要で Node.js だけで動きます。

```bash
node examples/state-cross-tab-todo/server.js
```

**http://localhost:3000 を 2 つのタブで並べて開き**、Todo を追加したりチェックしたりしてみてください。リロードすると「リストは残り、アクティビティバナーは消える」ことを確認できます。

## 正直な前提:なぜ 2 パッケージなのか

`type="local"` の `<wcs-storage>` は**それ単体でタブ間同期します**。`startSync()` がブラウザネイティブの `storage` イベントを購読しており、このイベントは `localStorage` が変化したとき**他の**タブで発火するためです。つまり Todo リストは storage だけで全タブに再描画され、**データを動かしているのは broadcast ではありません**。

それこそが役割分担の要点です。

| | `<wcs-storage>`(永続) | `<wcs-broadcast>`(一過性) |
|---|---|---|
| 保持するもの | Todo リスト | 「Octopus が *Buy milk* を完了」、タブの識別名 |
| リロードで残る? | **残る**(それが仕事) | **残らない**(残すべきでない) |
| タブ間? | はい(`storage` イベント) | はい(`BroadcastChannel`) |
| 相手のデータを入れると | 誰も望まない「保存された操作ログ」 | リロードで消える Todo リスト |

1 回のクリックが**両方**を生みます。永続的な変更(リストの保存+同期)と、一過性の通知(他タブでバナーを点滅)。永続性のセマンティクスが正反対なので、別々のノードに載せます。

## Features

- **永続リスト**: `<wcs-storage data-wcs="value#init=element: todos">` — 双方向 `value` バインド 1 本が統合のすべて。接続時に自動ロード、変更ごとに自動保存、他タブから自動同期。`manual` もトリガーもコマンドも不要。
- **一過性アクティビティバナー**: 各変更は `{who, kind, text}` を `<wcs-broadcast>` に `post` し、他タブが一時的なバナーとして表示。リロードで消える。
- **セッション識別名**: 各タブが読み込み時にランダムな動物(🦊 Fox, 🐙 Octopus…)を選ぶ。保存しないのでリロードで振り直し。まさに「storage ではなく broadcast に載せる」典型データ。
- **自己除外こそが機能**: `BroadcastChannel` は自分の post を自分には配送しないため、タブは**自分の操作**ではバナーを出さず、他タブだけが反応します。
- **グレースフルデグラデーション**: storage の容量エラーや `BroadcastChannel` 不在は各ノードの `error` プロパティ経由で通知表示。broadcast が無効でも永続リストは動き続けます。

## Data Flow

```
  ── このタブ ─────────────────────────────────────────────────
  click / Enter ──▶ addTodo() / toggleTodo() / removeTodo() / clearDone()
        │
        ├─▶ this.todos = [...]            (配列を「置換」。in-place 変更しない)
        │        │  value: todos  (双方向)
        │        ▼
        │   <wcs-storage>  ──▶ localStorage.setItem   (永続)
        │
        └─▶ this.$command.announce.emit({who, kind, text})
                 │  command.post
                 ▼
            <wcs-broadcast>  ──▶ BroadcastChannel.postMessage   (一過性)

  ── 他のタブ ─────────────────────────────────────────────────
  localStorage 変化 ──▶ ネイティブ `storage` イベント
        ▼  <wcs-storage> startSync → value-changed
   state.todos = <新リスト>   ──▶  リスト再描画     (永続パス)

  BroadcastChannel message ──▶ wcs-broadcast:message
        ▼  eventToken.message: liveSignal
   $on.liveSignal → state.lastActivity = {…}; liveCount++   (一過性パス)
```

2 つの受信パスは独立しています。リストは常に storage からのみ、バナーは常に broadcast からのみ。二重適用は起きません。

## Key Points

- **配列は置換する。in-place 変更しない。** `@wcstack/state` の依存解決は親 → 子の一方向なので、`todos.push(...)` では `value: todos` バインドが発火せず何も保存されません。各変更は新しい配列(`[...]` / `.map` / `.filter`)を作って `this.todos` に代入 → バインド発火 → `<wcs-storage>` が保存 → `storage` イベントで他タブへ拡散、という流れです。
- **チェックボックスの反映は `checked` ではなく `checked#ro`。** `<input type="checkbox">` への素の `checked: .done` は**暗黙的に双方向**で、ブラウザの `input` イベントが `.done` を state へ書き戻します。これを `onchange: toggleTodo`(同じく `.done` を反転)と併用すると、実クリックでは両方が発火し、双方向が `done = true`、続いてハンドラが `false` に反転 → トグルが実質無反応になります。`#ro` で反映を読み取り専用(state → DOM)にし、`onchange: toggleTodo` を唯一の書き手にします(`.done` を反転しつつ broadcast の announce も発火)。(双方向の `checked: .done` 単体でもトグル自体は正しく動きますが、その場合は一過性信号を post するフックがありません。)
- **`todos` ではなく `list` を読む。** 空の `localStorage` キーは `null`(`[]` ではない)としてロードされるため、初回は `<wcs-storage>` が `todos` に `null` を書き込みます。テンプレートと変更処理は `get list()` ゲッターを読み、`null` → `[]` に正規化します。`for:` が非配列を見ることはありません。
- **load-before-bind は `#init=element` で解決する。** `<wcs-storage>` は自身の `connectedCallback` で永続リストをロードして通知しますが、これはバインディング確立*前*に起こりえます。`value` は双方向メンバなので既定の authority は `state` で、放置すると初期 apply が `todos` のシード値を storage に書き戻し、リロードのたびに保存済みリストを消します。`#init=element` は**初期同期に限って**要素を authority にし、初期書き込みを行わずロード済みの値を `todos` へ pull します。以後の代入は通常どおり state→element に流れるので自動保存は生きたままです(タブ間同期テストがこの両面を担保しています)。
- **リストの書き手は storage だけ。broadcast は触れない。** `$on.liveSignal` は `lastActivity` / `liveCount` のみ更新します。もしここで `todos` も編集すると、タブ間の各変更が二重適用(`storage` イベントで 1 回、broadcast で 1 回)されます。リストを単一ソース(storage)に保つことが、broadcast レイヤーを安全に足せる理由です。
- **エコーループは起きない。** 理屈上ループしうる箇所が 2 つありますが、どちらも起きません。(1) *同一タブ。* `todos` を置換すると `value: todos` バインド経由で `<wcs-storage>` に書き込まれ、`setItem` 後に `value-changed` が再発火します。そのイベントは `todos` に戻ってバインドを再走させますが、適用(DOM 反映)側が「要素の現在の `value` と書き込もうとする値」を比較し(`<wcs-storage>` はすでにその同一の配列参照を保持済み)、変化なしと判断して書き込みをスキップするため、`save()` が再度呼ばれることはありません。これを止めているのは state プロキシ側の値ガードではなく、バインドの適用側の等価チェックです。また `storage` イベント自体、発火元のタブには配送されません(他タブ専用)。(2) *他タブ。* broadcast は自己除外なので post が送信元に戻りません。どちらのレイヤーもループしません。
- **`command.post` / `eventToken.message` は spread ではなく明示配線。** `...:` spread はノードの `properties` + `inputs` を対象とし、`commands` とイベントトークンは意図的に除外します。pub/sub 境界(state → element アクション、element → state 通知)は常に書き下すので、往復がマークアップ上で見えます。
- **カウンタが証明するのはチャネルであってデータではない。** `liveCount` は**他タブ**からの信号だけを数える(自己除外)ため、broadcast が配送できていることのクリーンな指標になります。リスト自体は broadcast の発火に関係なく storage が同期し続けます。

## See also

- [`@wcstack/storage`](../../packages/storage/README.ja.md) — 永続化 + ネイティブ `storage` クロスタブ同期
- [`@wcstack/broadcast`](../../packages/broadcast/README.ja.md) — `BroadcastChannel` ラッパー、structured-clone ペイロード、自己除外
- [`state-fetch`](../state-fetch) — このデモが土台にする spread / command-token / event-token 配線
