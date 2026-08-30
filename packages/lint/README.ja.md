# @wcstack/lint

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

[wcstack](https://github.com/wcstack/wcstack) の静的契約検査 CLI。HTML の `data-wcs` バインディングと `wcstack.manifest.json`（sidecar）を headless に検査します。WcStack IntelliSense（VS Code 拡張）と**同一の validator core** を使うため、IDE と CLI の diagnostic code / range は完全に一致します。

[English README is here](./README.md)

## 使い方

インストール不要で一行:

```bash
npx @wcstack/lint --errors-only index.html wcstack.manifest.json
```

またはインストールして `wcs-validate` コマンドとして:

```bash
npm i -D @wcstack/lint
npx wcs-validate --errors-only src/**/*.html
```

`.manifest.json` で終わるファイルは sidecar manifest として、それ以外は `data-wcs` バインディングを含む HTML として検査されます。

`<wcs-state src="...">` で参照される外部 state（`.json` / `.js` / `.ts`）は HTML ファイルからの相対パスで解決され、パス検証の対象になります。URL・絶対パスは読み込まず、読めないファイルはスキップされ、解決できないパスは warning のままです。なお外部 state が**解決できた**ページには通常の検証面が全て適用されるため、error severity の検出（例: 配列でない値への `for:`）が「これまでパス未解決で沈黙していたビルド」を新たに落とすことがあります。

```
wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--errors-only] [--strict] <file> [<file> ...]
```

| オプション | 説明 |
|---|---|
| `--attr=<name>` | バインド属性名（既定 `data-wcs`） |
| `--state-tag=<name>` | state カスタム要素のタグ名（既定 `wcs-state`） |
| `--lang=ja\|en` | 診断メッセージの言語。未指定時は環境ロケール（`LC_ALL` / `LC_MESSAGES` / `LANG` → OS ロケール）に従う。code / range は言語に依らず不変 |
| `--errors-only`（別名 `--quiet`） | error severity の行だけ表示。warning / info の件数と exit code は不変 |
| `--strict` | warning severity の診断でも exit `1` にする。severity 自体は不変（IDE の表示と同じ）で、exit code の閾値だけを error → warning に下げる。summary 行の末尾に `(strict)` が付く。パスの typo（`wcs/binding-path-missing` は warning）で CI を落としたいときに使う — ただし先に `<wcs-state src>` を全て解決可能にしておくこと（解決できない外部 state が残す warning でも落ちるようになる）。`--errors-only` と併用可: 表示は error のみのまま、exit code は warning を反映する |

## 出力と exit code

診断は安定した順序で 1 行ずつ出力されます:

```
index.html:12:8 warning wcs/path-nonexistent Path "user.nam" does not exist ...
app.manifest.json:1:3 error wcs/manifest-broken Broken manifest JSON: ...

1 error(s), 1 warning(s), 0 info
```

| exit code | 意味 |
|---|---|
| `0` | error severity の診断なし（warning / info はあってもよい）。`--strict` 時は error も warning もなし |
| `1` | error severity の診断が 1 件以上。`--strict` 時は error または warning が 1 件以上 |
| `2` | usage エラー、またはファイル読み取り失敗 |

## 生成 → 検証 → 修正ループでの利用

安定した diagnostic code・`source:line:col` range・exit code 契約により、CI のゲートにも AI コード生成フローにもそのまま組み込めます: HTML を生成 → `npx @wcstack/lint --errors-only` → 診断を読んで修正 → exit code `0` になるまで再実行。

## VS Code 拡張との関係

このパッケージは薄い配布ラッパーです。[`wcstack-intellisense`](https://github.com/wcstack/wcstack/tree/main/packages/vscode-wcs) の validator core からビルドされた自己完結の CLI バンドルを同梱します（runtime dependencies ゼロ）。sidecar manifest は tooling 専用で、ランタイム挙動を変えることはありません。規範スキーマは [`docs/wcstack-manifest-schema.md`](https://github.com/wcstack/wcstack/blob/main/docs/wcstack-manifest-schema.md) を参照してください。

## License

MIT
