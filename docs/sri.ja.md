# wcstack と Subresource Integrity (SRI 運用ガイド)

- **対象**: CDN から wcstack を読み込むページで、配信経路の改竄を検出したい利用者。および配布物のレイアウトを変える実装者
- **状態**: 規範ドキュメント（normative）。`dist/auto.min.js` が静的 import を持たないことは SRI 成立の前提条件であり、これを壊す変更をしてはならない（MUST NOT）
- **なぜ存在するか**: 通常、CDN から ESM を読むと `<script type="module" integrity>` は**エントリしか保護しない**。中で `import` される先は別フェッチで integrity の対象外になる。wcstack の `dist/auto.min.js` は外部 import ゼロの自己完結バンドルなので、**integrity 属性 1 個で実行される wcstack のコード全体をカバーできる**。ただしこれは「依存ゼロ + バンドル + 1 タグ」が揃って初めて成立する性質で、崩れやすい
- **関連**: [csp.ja.md](./csp.ja.md)（CSP との組み合わせ）
- **English**: [sri.md](./sri.md)

---

## 1. 使い方

```html
<script type="module"
        src="https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js"
        integrity="sha384-…"></script>
```

- **`crossorigin` は不要。** `type="module"` は常に CORS モードで取得されるため、クラシックスクリプトと違って `crossorigin="anonymous"` を足す必要がない。
- **バージョンは必ず固定する。** ダイジェストは特定バージョンのバイト列に対するもので、未固定 URL では次のリリースで必ず一致しなくなる。

## 2. ダイジェストの入手先 — CDN に聞いてはいけない

各リリースの **GitHub Release 本文**に全パッケージの表が載る。機械可読な `sri.json` も同じリリースの asset として添付される。

```json
{
  "version": "1.26.0",
  "algorithm": "sha384",
  "file": "dist/auto.min.js",
  "packages": {
    "@wcstack/state": {
      "integrity": "sha384-…",
      "url": "https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js"
    }
  }
}
```

jsDelivr の data API もファイルのハッシュを返すが、**それを使ってはいけない**。SRI の目的は CDN を信頼しないことであり、CDN が自分の配るファイルのハッシュを自己申告するのは循環論法になる。ダイジェストは公開する tree から算出され（[scripts/generate-sri.mjs](../scripts/generate-sri.mjs)）、CDN とは独立に GitHub から配られる。

自分で検算することもできる。リポジトリの該当タグと npm tarball はバイト等価なので:

```bash
# 手元の成果物から
openssl dgst -sha384 -binary packages/state/dist/auto.min.js | openssl base64 -A

# CDN が返したものから（一致すれば経路は無改竄）
curl -sL https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

**同じダイジェストは CSP の `script-src` ハッシュ式としてもそのまま使える。** CSP3 には `integrity` 属性のダイジェストが `script-src` のハッシュ式と一致する外部スクリプトを許可する経路があり、CSP 用に別の値を算出する必要はない。ただし実装は Chromium のみで、Firefox / Safari では一致せずブロックされる。詳細と制約は [csp.ja.md §3.2](./csp.ja.md#32-外部バンドルのハッシュ--値は-sri-と同一)。

## 3. `esm.run` では SRI は成立しない

```
https://esm.run/@wcstack/state/auto
  → 301 → https://cdn.jsdelivr.net/npm/@wcstack/state/auto/+esm
```

`+esm` は jsDelivr 側で **Rollup / esbuild による再バンドル**を行うエンドポイントで、返るファイルの先頭にはビルダのバージョンが焼き込まれている。公開されたバイト列ではないので、固定ダイジェストは原理的に一致しない。ビルダが更新されれば内容も変わる。

SRI を効かせるなら `cdn.jsdelivr.net` の**バージョン固定・直パス**を使う。なお jsDelivr の素パスは `package.json` の `exports` を解決しないので、`/auto` ではなく `dist/auto.min.js` を名指しする必要がある（`/npm/@wcstack/state/auto` は 404）。

副次的な利点として、直パスなら CSP の `script-src` に許可するホストが 1 つで済む（`esm.run` 経由だとリダイレクト先も照合されるので 2 ホスト必要）。詳しくは [csp.ja.md §1](./csp.ja.md#1-配信元--esmrun-は-2-ホストを要求する)。

### 3.1 jsDelivr `/combine/` も同様に不成立

wcstack の配信に `/combine/` を使ってはならない（MUST NOT）。`esm.run` より深刻で、検証できないどころか**パースすら通らない**。

このエンドポイントは列挙されたファイルを裸の `;` 区切りで連結するだけで、スコープのラップをしない。minifier はトップレベルの束縛を「モジュールスコープは自分の専有物」という前提でリネームするため、minify 済み ESM バンドル 2 つが 1 ファイルを共有した瞬間に識別子が衝突する。wcstack の `dist/auto.min.js` をどれでも 2 つ combine すると `SyntaxError: Identifier 't' has already been declared` になる（2026-08-29 実測: 公開済み 1.30.0 の `@wcstack/state` + `@wcstack/router` の combine 応答で確認。同じファイルのローカル連結でも同一エラーを再現）。これは構造的な性質であり、将来のリリースで直せる類のバグではない。

仮にパースが通る組み合わせであっても、SRI は jsDelivr 自身が禁じている。combine 応答の先頭には「Do NOT use SRI with dynamically generated files!」というコメントが埋め込まれ、公式ガイダンスも「Only use SRI with full single-file links, and static versions」— 再生成時のバイト同一性は保証されない。運用面でも all-or-nothing で、構成ファイルが 1 つでも 404 なら全体が 404 になり、その 404 は 1 日エッジキャッシュされる。

複数パッケージを読み込むときは、パッケージごとにバージョン固定の単一ファイルタグを並べる。各 `dist/auto.min.js` は自己完結なのでタグは並列にフェッチされ（潰すべき import のウォーターフォールはそもそも存在しない）、それぞれが全カバーのダイジェストを保つ:

```html
<script type="module"
        src="https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js"
        integrity="sha384-…"></script>
<script type="module"
        src="https://cdn.jsdelivr.net/npm/@wcstack/router@1.26.0/dist/auto.min.js"
        integrity="sha384-…"></script>
```

単一リクエストにしたい場合は **`wcstack` エントリバンドル**を使う。SPA コアパッケージ（state / router / fetch / storage / autoloader）を Rollup が識別子安全に（連結が衝突させるものを Rollup がリネームして）束ねた 1 タグで、全カバーのダイジェスト 1 個を持ち、他のパッケージと同様に `sri.json` に載る。個別パッケージの `/auto` との併載も安全 — 全メンバーの define はガード済み・プロトコルのインストールは先勝ちなので、先に評価されたコピーがページを所有する。

```html
<script type="module"
        src="https://cdn.jsdelivr.net/npm/wcstack@2.0.0/dist/auto.min.js"
        integrity="sha384-…"></script>
```

## 4. カバー範囲 — 何が守られ、何が守られないか

| 対象 | integrity で守られるか |
|---|---|
| wcstack のランタイムコード全体（`dist/auto.min.js` の中身） | **守られる**（静的 import ゼロの自己完結バンドル） |
| `dist/index.esm.js` からの named import | 守られない（module 内の `import` は囲む script の integrity の対象外。§5 参照） |
| `<wcs-state>` の state 定義（インライン `<script>` / `src="./state.js"`） | 守られない（実行時にページ側のコードを動的 import する） |
| `<wcs-route>` のガードスクリプト | 守られない（同上） |
| `@wcstack/autoloader` が解決するコンポーネント | 守られない（同上） |

下 3 つは**設計上の境界**であり、欠陥ではない。これらはページ側が供給するコードで、wcstack の配布物には含まれない。ページ側で守りたい場合は、それぞれを独立したリソースとして自分で SRI / CSP の対象にする必要がある。

この境界は自動検査できる。`dist/auto.min.js` に静的 import が 1 つでも入れば §0 の前提が崩れるので、レイアウトを変える際は必ず確認すること:

```bash
node -e "const s=require('fs').readFileSync('packages/state/dist/auto.min.js','utf8');
  console.log([...s.matchAll(/(?:^|[;\n])import\s*[{*\"']/g)].length === 0 ? 'self-contained' : 'HAS STATIC IMPORTS')"
```

## 5. named import を守るには import map integrity

`dist/index.esm.js` から named import する使い方（`import { bootstrapState } from '…'`）は、`<script>` の integrity では守れない。module 内部の `import` は別リクエストだからである。これを守る仕組みは import map の `integrity` キーで、**Chrome 127 / Safari 18 で実装済み、Firefox は未対応**。

```html
<script type="importmap" nonce="{RANDOM}">
{
  "imports": {
    "@wcstack/state": "https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/index.esm.js"
  },
  "integrity": {
    "https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/index.esm.js": "sha384-…"
  }
}
</script>
```

全ブラウザで確実に守りたいなら、named import ではなく `dist/auto.min.js` の 1 タグ形式を使うのが最も確実。

## 6. 実装者向け — 壊してはいけない不変条件

1. `src/auto.ts` は `./exports` からのみ import する。兄弟の dist ファイルを相対 import してはならない（MUST NOT）。それをやると `auto.min.js` が再びスタブに戻り、integrity のカバー率がほぼゼロになる。**「integrity が付いているのに守られていない」は integrity が無いより悪い**
2. `dist/auto.min.js` は Rollup の実エントリであり、コピーされる手書きスタブではない（[config-templates/rollup.config.js](../config-templates/rollup.config.js)）
3. ダイジェストは公開する tree から算出する。CDN のレスポンスから採ってはならない（MUST NOT）
4. パッケージを増やしたら [scripts/generate-sri.mjs](../scripts/generate-sri.mjs) が自動で拾う。`dist/auto.min.js` を持たないパッケージは `withoutBootstrap` に明示的に列挙され、黙って落ちることはない
