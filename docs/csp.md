# wcstack と Content-Security-Policy (CSP 互換性ガイド)

- **対象**: CSP を敷いたページで wcstack を使う利用者、および CSP に触れる変更を入れる実装者
- **状態**: 規範ドキュメント（normative）。表に載っているディレクティブ要求は実装の事実であり、変更する場合は本書も同時に更新すること（MUST）
- **なぜ存在するか**: wcstack はタグを置くだけで動くことを売りにしているが、**厳格な CSP 下では既定の書き方の一部が動かない**。特に `<wcs-state>` のインライン `<script>` は blob: URL 経由で評価されるため `script-src blob:` を要求する。この事実がどこにも書かれていないと、利用者は原因不明の初期化失敗に突き当たる
- **関連**: [sri.md](./sri.md)（配信経路の改竄検出。本書と同じく「直パスに寄せる」が答えになる） / [async-io-node-guidelines.md](./async-io-node-guidelines.md) / 各パッケージの README

---

## 0. TL;DR

**試用（クイックスタートの `esm.run` 一発を使う場合）**

```
Content-Security-Policy:
  script-src 'self' https://esm.run https://cdn.jsdelivr.net 'nonce-{RANDOM}' blob:;
  connect-src 'self';
```

**本番（配信元を 1 ホストに絞り、state を外部ファイルに逃がした場合）**

```
Content-Security-Policy:
  script-src 'self' https://cdn.jsdelivr.net 'nonce-{RANDOM}';
  connect-src 'self';
```

差は 2 点。**`esm.run` は 301 で `cdn.jsdelivr.net` に飛ぶので 2 ホスト要る**（§1）。**`blob:` は `<wcs-state>` のインライン `<script>` を使う場合にだけ要る**（§3）。`'nonce-{RANDOM}'` はインライン import map のために必須（§2）。

---

## 1. 配信元 — `esm.run` は 2 ホストを要求する

`esm.run` は独立したホストで、リクエストは 301 リダイレクトされる:

```
https://esm.run/@wcstack/state/auto
  → 301 → https://cdn.jsdelivr.net/npm/@wcstack/state/auto/+esm
```

CSP はリダイレクト**先も再照合する**（リダイレクト後は path の照合はスキップされるが、スキーム / ホスト / ポートは照合される）。したがって `script-src https://esm.run` だけでは飛び先で拒否される。両方を列挙すること。

`cdn.jsdelivr.net` の直パスに寄せれば 1 ホストで済む。ただし jsDelivr の素パスは `package.json` の `exports` を解決しないので、`/auto` ではなく実ファイルを名指しする必要がある:

```
https://cdn.jsdelivr.net/npm/@wcstack/state/auto            → 404
https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js → 200
```

直パスに寄せる利点は CSP のホスト数だけではない。`esm.run` は再バンドルを行う `+esm` エンドポイントに飛ぶため SRI が原理的に効かず、直パスなら `integrity` を付けられる。詳細は [sri.md](./sri.md)。

## 2. import map は nonce 必須（SRI は使えない）

`@wcstack/autoloader` の `@components/` 解決はページのインライン import map に依存する。インライン `<script type="importmap">` は `'unsafe-inline'` か **nonce / hash** がないと実行されない。インラインなので `integrity` 属性は使えない。

```html
<script type="importmap" nonce="{RANDOM}">
  { "imports": { "@components/": "/components/" } }
</script>
```

## 3. `<wcs-state>` の状態ロード — 経路によって要求が違う

これが本書で一番重要な点。**ロード経路ごとに CSP 要求が変わる。**

| 書き方 | 実装 | 必要な CSP |
|---|---|---|
| `<wcs-state state="<id>">`（`<script type="application/json">` を id 参照） | `JSON.parse(script.textContent)` | **追加不要**（データブロックは実行されないので `script-src` の対象外） |
| `<wcs-state json='{...}'>` | 属性値を `JSON.parse` | **追加不要** |
| `<wcs-state src="./state.js">` | 通常の `import(url)` | `script-src <オリジン>` |
| `<wcs-state src="./data.json">` | `fetch(url)` | `connect-src <オリジン>` |
| `setInitialState()` API | なし | **追加不要** |
| `<wcs-state><script type="module">…</script></wcs-state>` | **blob: URL 経由で `import()`** | **`script-src blob:`** |

インライン `<script>` の中身はブラウザからは実行されない（`<wcs-state>` の子なので）。state はテキストを取り出し、blob: URL を作って動的 `import()` する（[loadFromInnerScript.ts](../packages/state/src/stateLoader/loadFromInnerScript.ts)）。ここが CSP に当たる。

**nonce では救えない。** blob: URL からのモジュール読み込みはページの nonce を継承しない。`script-src blob:` を開けるか、外部ファイルに逃がすかの二択になる。

**厳格な CSP 下では `src=` を推奨する。** `script-src blob:` は「動的生成スクリプトを全面的に許可する」という意味になり、CSP を敷いた目的の多くを損なう。state 定義を `./state.js` に切り出せば追加ディレクティブは不要になる:

```html
<!-- CSP 安全 -->
<wcs-state name="app" src="./state.js"></wcs-state>
```

## 4. router のガードは blob: 必須（回避策なし）

`<wcs-route>` のガードスクリプトも同じく blob: URL 経由で評価される（[loadGuardHandler.ts](../packages/router/src/loadGuardHandler.ts)）。ただし **state と違ってインライン専用で、`src=` に逃がす経路が存在しない**。ガードを使うなら `script-src blob:` が必須になる。

これは既知の非対称性であり、外部ファイル対応は未実装。CSP を厳格に保ちたい場合は、ガードを使わずルート表示側で制御する。

## 5. I/O ノードの通信系

| パッケージ | 必要な CSP |
|---|---|
| `@wcstack/fetch` / `@wcstack/upload` | `connect-src <API オリジン>` |
| `@wcstack/websocket` | `connect-src wss://<host>`（`ws:`/`wss:` スキームを明示） |
| `@wcstack/sse` | `connect-src <オリジン>` |
| `@wcstack/worker` | `worker-src <スクリプトのオリジン>` |
| `@wcstack/autoloader` | `script-src` に `@components/` の解決先ホスト |

Blob をバインドする経路（`@wcstack/fetch` の Blob → object URL、`@wcstack/camera` の録画結果）は、代入先に応じて `img-src blob:` / `media-src blob:` が要る。

## 6. Trusted Types は未対応（既知の制約）

`require-trusted-types-for 'script'` 下では以下が例外を投げる。現時点で `trustedTypes.createPolicy` の導入予定はない。

- `@wcstack/fetch` の `html` バインディング（[Fetch.ts](../packages/fetch/src/components/Fetch.ts)）
- `@wcstack/router` の `<wcs-layout>` テンプレート展開（[Layout.ts](../packages/router/src/components/Layout.ts)）
- `@wcstack/state` の DCC 定義（[defineDCC.ts](../packages/state/src/dcc/defineDCC.ts)）

## 7. CSP に触れないもの（誤解しやすい点）

- **`style` バインディングは `style-src` を要求しない。** `class`/`style` バインディングは CSSOM のプロパティ代入（`element.style.color = …`）であって、`style` 属性の解析でも `<style>` 要素の挿入でもない。CSP の `style-src` は CSSOM 経由の変更を対象にしないため、`'unsafe-inline'` は不要。
- **`data-wcs` の式は評価されない。** `data-wcs` はパス指定とフィルタ名の宣言であり、`eval` / `new Function` は使わない。リポジトリ全体で `eval` / `new Function` の使用箇所はゼロ。

## 8. 診断 — エラーの読み方

CSP にブロックされた動的 `import()` の rejection は `Failed to fetch dynamically imported module` としか言わず、CSP には言及しない。そこで state / router は評価中の `securitypolicyviolation` を購読し、ブロックが観測できた場合だけ断定的なメッセージを出す。

| 出力 | 意味 |
|---|---|
| `... was blocked by Content-Security-Policy` | **CSP 確定**。`script-src blob:` を足すか `src=` に逃がす |
| `Failed to evaluate the inline <script> of state "…"` | CSP は観測されなかった。多くは state 定義側の構文エラー（元のエラーは `cause` に入っている） |

違反が観測できなかった場合に CSP を断定しないのは意図的で、構文エラーを CSP のせいだと誤誘導しないため。
