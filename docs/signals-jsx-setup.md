# @wcstack/signals で JSX を導入する手順書

`@wcstack/signals` の DOM レイヤ(`@wcstack/signals/dom`)が公開する `h` / `Fragment` は、古典的(classic)な JSX ファクトリの形をしています。そのため **JSX を「乗せられる」が、パッケージとしては「乗せない」**(`.tsx` も `jsx-runtime` 型も同梱しない)という設計です。背景は [`signals-state-design.md` §4-1](./signals-state-design.md) を参照してください。

この文書は、それでも JSX を使いたい利用者が **実際に動かすまでの手順** をまとめたものです。

> **大前提:** JSX はトランスパイル必須です。JSX を導入した時点で、`@wcstack/signals` が掲げる **buildless(無ビルド)経路からは外れます**。これは利用者の選択です。無ビルドのまま使いたい場合は JSX を使わず `h(...)` を直接呼んでください(README のクイックスタート参照)。

---

## 0. 全体像 — 何を設定するのか

JSX を有効化するために設定するのは次の 3 つだけです。

1. **JSX を関数呼び出しへ変換するトランスパイラ**(tsc / esbuild / Vite など)を、**classic runtime** + ファクトリ `h` / `Fragment` に向ける。
2. 各 `.tsx` ファイルで **`h` と `Fragment` を import する**(変換後のコードがこの 2 つを参照するため、スコープに無いと実行時エラーになる)。
3. リアクティブにしたい箇所は **thunk(`() => sig.get()`)か signal を渡す**(JSX は構文を変えるだけで、リアクティビティの仕組みは `h` を直接呼ぶときと同じ)。

**automatic runtime 用の `./jsx-runtime` export は存在しません**(`package.json` の `exports` に未定義で、将来用に構想された未出荷の seam)。したがって現状は **classic runtime 一択** です。

---

## 1. 変換ターゲット別の設定

### A. TypeScript(`tsc` 単体)で変換する場合

`tsconfig.json` の `compilerOptions` に次を設定します。

```jsonc
{
  "compilerOptions": {
    // ...既存の設定...
    "jsx": "react",            // classic runtime（"react-jsx" にしない）
    "jsxFactory": "h",         // <div/> → h("div", ...)
    "jsxFragmentFactory": "Fragment" // <>...</> → h(Fragment, ...)
  }
}
```

- `"jsx": "preserve"` だと JSX が変換されず、`.js` に `<div>` が残って実行できません。必ず `"react"` にします。
- `"jsx": "react-jsx"`(automatic runtime)は **使えません**。`jsxImportSource` で `@wcstack/signals` を指しても `./jsx-runtime` export が存在しないため解決に失敗します。

### B. esbuild で変換する場合

CLI:

```bash
esbuild app.tsx --bundle --outfile=app.js \
  --jsx=transform --jsx-factory=h --jsx-fragment=Fragment
```

設定オブジェクト(`build.mjs` など):

```js
import { build } from "esbuild";

await build({
  entryPoints: ["app.tsx"],
  bundle: true,
  outfile: "app.js",
  jsx: "transform",          // classic
  jsxFactory: "h",
  jsxFragment: "Fragment",
});
```

### C. Vite で変換する場合

`vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    jsx: "transform",
    jsxFactory: "h",
    jsxFragment: "Fragment",
  },
});
```

> Vite は内部で esbuild を使うため、設定キーは esbuild と同じです。React 用プラグイン(`@vitejs/plugin-react`)は **入れないでください**(automatic runtime を強制し、競合します)。

### D. Babel で変換する場合

`@babel/plugin-transform-react-jsx` を classic pragma で設定します。

```jsonc
// babel.config.json
{
  "plugins": [
    ["@babel/plugin-transform-react-jsx", {
      "runtime": "classic",
      "pragma": "h",
      "pragmaFrag": "Fragment"
    }]
  ]
}
```

ファイル単位で上書きしたい場合はファイル先頭にコメントプラグマも使えます:

```tsx
/** @jsx h */
/** @jsxFrag Fragment */
```

---

## 2. 各 `.tsx` ファイルで import する

classic runtime は **変換後のコードが `h` / `Fragment` という名前をそのまま参照** します。よって **JSX を書く全ファイルでこの 2 つを import** してください(自動注入はされません)。

```tsx
import { h, Fragment } from "@wcstack/signals/dom";
```

`h` や `Fragment` を直接書いていなくても(JSX 構文しか書いていなくても)import は必須です。未使用に見えるため linter が消そうとすることがあります — その場合は次のいずれかで回避します。

- tsconfig に `"jsxFactory"`/`"jsxFragmentFactory"` を設定していれば、TypeScript の `noUnusedLocals` は JSX が使う import を「使用済み」とみなします(消えません)。
- ESLint で消える場合は `eslint-plugin-react` の `react/jsx-uses-vars`(または `h`/`Fragment` を used とみなすルール)を有効化するか、当該 import を除外設定にします。

> **buildless 単一エントリ規則との整合:** import は **必ず `@wcstack/signals/dom` から** 行ってください。`h`/`Fragment` と他のコア API(`signal` 等)を `@wcstack/signals` と `@wcstack/signals/dom` に分けて import すると、バンドラ次第でリアクティブコアが二重化し反応が静かに壊れます(README「buildless 単一エントリ規則」参照)。`/dom` がコアも再エクスポートするので、UI 系は `/dom` に集約します。

---

## 3. 検証用の最小 `.tsx`

ここまでの設定が効いているか確認するための、そのままビルド・実行できる最小例です。

```tsx
// app.tsx
import { h, Fragment, signal, render } from "@wcstack/signals/dom";

function Counter() {
  const count = signal(0);
  return (
    <button onClick={() => count.set(count.peek() + 1)}>
      {/* リアクティブ: thunk を渡すと count 変化で再描画される */}
      count: {() => count.get()}
    </button>
  );
}

render(<Counter />, document.getElementById("app")!);
```

期待する動作:

- ボタンに `count: 0` と表示される。
- クリックするたび数字が増える(`{() => count.get()}` の effect が更新される)。

もし数字が増えない場合は **§4 のリアクティビティの落とし穴** を確認してください。

---

## 4. リアクティビティの落とし穴(JSX 特有の誤解)

JSX は **構文だけ** を変えます。リアクティビティの規則は `h(...)` を直接呼ぶときとまったく同じです。

```tsx
// ❌ 一度だけ読んで終わり。count が変わっても更新されない
<span>{count.get()}</span>

// ✅ thunk を渡す → 対象を絞った effect が配線され、変化で更新される
<span>{() => count.get()}</span>

// ✅ signal を直接渡す（DOM レイヤが get() を購読する）
<span>{count}</span>
```

prop も同じです。

```tsx
// ❌ 評価時の値で固定される
<input value={name.get()} />

// ✅ リアクティブ
<input value={() => name.get()} />
<input value={name} />
```

イベントは `onXxx`(キャメルケース)で、**関数はリスナとして扱われ追跡されません**(thunk と区別されます)。

```tsx
<button onClick={(e) => handle(e)}>go</button>
```

---

## 5. contract に入っていない JSX セマンティクス

JSX を有効化しても、`@wcstack/signals` の DOM レイヤが解釈する範囲は `h` の contract と同一です。React 等で当たり前に使う次の機能は **実装されていません**(設計 §4-1 の「手前でとどめる」規律)。

| JSX 機能 | 状態 | 代替 / 注意 |
|---|---|---|
| `key`(リスト差分) | **無し** | リスト(`{items.map(...)}`)は変化のたび丸ごと再生成され、focus/入力状態が失われる。keyed `For` / `Index` は実装済み(`@wcstack/signals/dom` から export) |
| `ref` | **無し** | `h` が返す `Node` を変数で受けるか、`render`/`createRoot` 内で DOM を直接掴む |
| `context` | **無し** | signal をモジュールスコープ or props で明示的に受け渡す |
| controlled input(React 流) | **無し** | `value={() => ...}` + `onInput` で素の DOM として書く(自動の双方向束縛は無い) |
| `dangerouslySetInnerHTML` | **無し** | 必要なら `h` の外で `el.innerHTML` を扱う |
| Fragment 短縮記法 `<>...</>` | **有り** | `jsxFragmentFactory: "Fragment"` を設定していれば動く |

特に **keyed list が無い** 点は、規模のあるリストやインライン編集 UI で効いてきます。JSX にしたからといって解決はしません。

---

## 6. トラブルシュート

| 症状 | 原因 / 対処 |
|---|---|
| 実行時に `h is not defined` / `Fragment is not defined` | そのファイルで `import { h, Fragment } from "@wcstack/signals/dom"` を忘れている。classic runtime は import 自動注入をしない |
| ビルド後の `.js` に `<div>` が残る | `"jsx": "preserve"` のまま。`"react"`(tsc)/`"transform"`(esbuild)にする |
| `jsx-runtime` が解決できない / モジュールが見つからない | automatic runtime(`"jsx": "react-jsx"` や `jsxImportSource`)を使っている。classic に切り替える |
| リアクティブにしたのに更新されない | `{value.get()}` を `{() => value.get()}`(または signal を直接渡す)にする(§4) |
| クリックしても増えない・二重発火 | `onClick` に thunk ではなくリスナ関数を渡しているか確認。`onclick`(小文字)はイベントリスナ扱いにならないので `onClick` を使う |
| import が linter に消される | `react/jsx-uses-vars` を有効化、または当該 import を除外(§2) |
| リアクティビティが静かに切れる | `h`/`Fragment` を `@wcstack/signals` と `/dom` に分けて import しコアが二重化。`/dom` に集約する(§2) |

---

## 7. 推奨スタンス

- **小さく試すなら tsc 単体(§1-A)**、**バンドルするなら esbuild / Vite(§1-B, C)** が最短です。
- 迷ったら **JSX を入れずに `h(...)` 直書き** が、このパッケージの第一級の使い方(buildless・zero-config)です。JSX は「React 風の書き味が欲しい」「既存の JSX 資産がある」場合のオプトインと捉えてください。
- automatic runtime / `jsx-runtime` エントリは将来の seam として空席です。対応した場合はこの文書を更新します。

関連: [`signals-state-design.md` §4-1](./signals-state-design.md) / パッケージ README([ja](../packages/signals/README.ja.md) / [en](../packages/signals/README.md))
