# wcs-validate CLI の npm 公開提案: 薄いラッパーパッケージで `npx` 一行化する

- **状態**: **決裁済み・実装済み**（2026-07-24 起票、同日決裁・実装。npm 公開は次リリースで自動）。決定 = パッケージ名 **`@wcstack/lint`**・バージョンは**公開 npm 群と同一**（bin 名は `wcs-validate` 維持）。実装は `packages/lint/`（§7 実装記録）
- **提案の対象**: `packages/vscode-wcs` に同梱されている `wcs-validate` CLI の**配布経路**のみ。validator core・診断仕様・CLI インターフェースは一切変更しない。
- **関連**: `docs/architecture-hardening/10-defaulting-rollout-status.md` §B（CI 必須ゲート化・完了）、`docs/wcstack-manifest-schema.md`（sidecar 規範）、[wcstack/wcstack-skill](https://github.com/wcstack/wcstack-skill)（AI アプリ構築スキル）
- **TL;DR**: CLI を `@wcstack/lint` などの**薄い npm ラッパーパッケージ**として公開すれば、skill の実行手順が `npx` 一行になり、AI 生成フロー（生成 → 静的検証 → 修正ループ）への組み込みが格段に楽になる。`dist/cli.cjs` は既に自己完結の単一ファイルバンドルなので、ラッパーは**依存ゼロで成立**する。

---

## 1. 現状と問題

`wcs-validate` は VS Code 拡張（`wcstack-intellisense`）と**同一の validator core** を headless に実行する CI CLI である（IDE と診断 code / range が一致）。しかし配布経路は VS Code Marketplace のみで、**npm には公開されていない**。

その帰結:

- `npx wcs-validate` は動かない（README en/ja に明記済み）。利用者はこの monorepo を clone し、`cd packages/vscode-wcs && npm ci && npm run build` してから `node packages/vscode-wcs/dist/cli.cjs ...` と叩くしかない。
- リポジトリ内の CI（`.github/workflows/ci.yml` の `wcs-validate` job）はこの手順で動くが、**リポジトリの外**（利用者のアプリプロジェクト、利用者側 CI、AI エージェントの作業環境）からは事実上使えない。
- wcstack-skill（AI がwcstackアプリを構築するスキル）は「生成した HTML を静的検証し、診断を見て修正する」ループを組みたいが、現状は clone + build という重い前提を skill の手順に書くことになり、実行環境によっては成立しない。

**静的契約検査は AI 生成フローと最も相性が良い資産**（安定した診断 code・`source:line:col` range・exit code 契約）なのに、配布経路だけがボトルネックになっている。

## 2. 提案

CLI を薄い npm パッケージ（名称候補: **`@wcstack/lint`**）として公開する。

- 中身は **bundle 済み `cli.cjs` と bin 宣言だけ**。validator のソースコードは `packages/vscode-wcs` に単一ソースのまま置き、ラッパーはビルド成果物を再配布する。
- skill・利用者ドキュメントの実行手順は次の一行になる:

```bash
npx @wcstack/lint --errors-only index.html wcstack.manifest.json
```

- AI 生成フローでの想定ループ: AI が HTML を生成 → `npx @wcstack/lint` → 診断（安定 code + range）を読んで修正 → 再検証。exit code（0 = clean / 1 = error あり / 2 = usage・読取失敗）でループの終了判定ができる。

## 3. 実現性（検証済みの事実・2026-07-24）

- `dist/cli.cjs` は esbuild による**自己完結の単一ファイル CJS バンドル**（`#!/usr/bin/env node` banner 付き）。`@wcstack/state/manifest` も inline 済み。
- esbuild 設定は `typescript` / `vscode` を external にしているが、**CLI の実行経路（`cli.ts` → `core/cli/runValidation.ts` → `validateDocument` / `validateManifestSet`）はどちらも import しない**。`dist/cli.cjs` に `require("typescript")` は存在しない（`server.cjs` のみ）。→ ラッパーパッケージは **runtime dependencies ゼロ**で成立する。
- CLI インターフェースは確定済み: `--attr=` / `--state-tag=` / `--lang=ja|en` / `--errors-only`（別名 `--quiet`）、`*.manifest.json` は sidecar として・その他は HTML として検査。

## 4. 設計スケッチ

**案 A（推奨）: 新パッケージ `packages/lint/` を作り、vscode-wcs のビルド成果物をコピーして publish する。**

```jsonc
// packages/lint/package.json（骨子）
{
  "name": "@wcstack/lint",
  "bin": { "wcs-validate": "./dist/cli.cjs" },
  "files": ["dist"],
  // dependencies なし
}
```

- **コマンド名は `wcs-validate` を維持**する（既存 README / CI / ドキュメントの表記と一致。`npx @wcstack/lint` はパッケージ名解決で同 bin を起動する）。
- build script は「`packages/vscode-wcs` をビルドして `dist/cli.cjs` をコピー」（他パッケージの `copy-auto` プラグインと同系の発想）。または esbuild を lint パッケージ側から直接叩いてもよい — いずれにせよ**ソースの正本は vscode-wcs のまま動かさない**。

**案 B（不採用方向）: `wcstack-intellisense` パッケージ自体を npm にも publish する。**
VS Code 拡張のメタデータ（`engines.vscode` / `contributes` / activationEvents）と拡張用 dependencies（volar / languageclient / typescript）が混入し、「薄い CLI」にならない。npm 側利用者には無関係なペイロードが大きすぎるため採らない。

## 5. 決定ゲートの結果（2026-07-24 決裁）

1. **パッケージ名**: **`@wcstack/lint`** に決定。bin 名は `wcs-validate` 固定（既存 README / CI と一致）。bin が 1 本だけなので `npx @wcstack/lint` はパッケージ名でもその bin を起動する（npx の単一 bin 既定規則。tarball spec で実機確認済み）。
2. **バージョン方針**: **公開 npm 群と同一バージョン**に決定（初版は現行ラインの 1.22.0 で作成）。release workflow の unified-version bump が以後も自動で揃える。
3. **release workflow への組込み**: 当初「workflow 変更不要」と判断したが、**v1.22.1 初回発射（2026-07-24）で 1 箇所の修正が必要と判明**。Discover / build / publish は判断どおり自動で通るが、`Commit release artifacts` の `git add packages/*/dist` glob が、lint のビルドが runner 上に生成した **gitignore 対象の `packages/vscode-wcs/dist` を明示指定してしまい exit 1**（従来は release 中に vscode-wcs をビルドしないため glob 不一致で顕在化しなかった）。修正= git add を発見済みパッケージのみのループに変更。失敗 step は publish より前のため npm への部分公開は無く、再実行は安全。
4. **ドキュメント追随**（残タスク・公開後）: vscode-wcs README（en/ja）の「npx は動かない」節を `npx @wcstack/lint` の正式手順に書き換え。ルート README への掲載は「npm 未公開のものは掲載しない」運用ルール（`docs/project-strategy-2026-07.md` §P0）に従い**公開後**。
5. **skill 追随**（残タスク・公開後）: wcstack-skill の references に検証ループ（生成 → `npx @wcstack/lint --errors-only` → 修正）の手順を追記（CLAUDE.md の skill 同期規約の対象）。
6. **動作確認**: **Windows 実機確認済み**。tarball install → `.cmd` shim 経由の `npx wcs-validate` で exit 0/1/2 契約どおり、tarball spec 起動（公開後の `npx @wcstack/lint` と同じ解決規則）も exit 0。

## 6. やらないこと

- validator core の再配置・分割はしない（配布ラッパーに徹する。core の正本は `packages/vscode-wcs/src/core/` のまま）。
- CLI のオプション・出力形式・exit code の変更はしない（本提案は配布経路のみ）。
- VS Code 拡張の Marketplace 配布フローには手を入れない。

## 7. 実装記録（2026-07-24、案 A で実装）

- **`packages/lint/`** 新設。構成は 4 ファイル + scripts:
  - `package.json` — `@wcstack/lint@1.22.0`、`bin: { "wcs-validate": "./dist/cli.cjs" }`、`files: ["dist"]`、**dependencies / devDependencies ともゼロ**（lockfile は自明の 1 エントリ = Windows 生成 lock の既知事故クラスと無縁）。
  - `scripts/build.mjs` — vscode-wcs の `node_modules` 不在なら `npm ci` → `npm run build` → `dist/cli.cjs` をコピー。自己完結なので CI / release の workflow 変更不要。
  - `scripts/smoke-test.mjs` — 配布物の CLI 契約を 6 ケースで検査（usage=exit 2 / clean HTML=exit 0 / 壊れ manifest=exit 1 + `wcs/manifest-broken` + `source:line:col` 形式 / `--lang` 間で code 不変 / `--errors-only` で error 行は残る / 読取失敗=exit 2）。**fixture は一時ディレクトリ生成**（リポジトリに `*.html` / `*.manifest.json` として置くと CI の wcs-validate gate が意図的に壊した fixture で落ちるため、コミット禁止）。`npm test` / `npm run test:coverage` から実行。
  - `README.md` / `README.ja.md` — npx 一行・オプション・exit code 契約・生成→検証→修正ループを記載。
- **`scripts/sync-package-configs.mjs`** — lint を `rollup.config.js` / `eslint.config.js` 両方の DEVIATIONS に追加（自前 src を持たない配布ラッパーのため）。他の自動検出は影響なし（conformance-bindable-inputs は `dist/index.esm.js` 前提で lint を素通し、sync-protocol-types / sync-io-core は明示リスト）。
- **検証済み**: smoke 6/6 合格、`npm pack` = 4 ファイル 30.8 kB、tarball install 後の Windows `.cmd` shim 経由 `npx wcs-validate` で exit 契約どおり。
- CI 側は detect-changes が `@wcstack/lint` を自動検出し matrix（npm ci → lint → build → test:coverage）に入る。release.yml も Discover の自動検出で publish 対象になる。
- **追記（2026-07-24 v1.22.1 初回発射の失敗と修正）**: release.yml の `Commit release artifacts` が `git add packages/*/dist` glob だったため、lint ビルドの副産物である gitignore 対象 `packages/vscode-wcs/dist` を明示指定して exit 1。**git add を発見済み（`@wcstack/*`）パッケージのみのループに修正**（§5-3）。教訓=「新パッケージのビルドが他パッケージのビルド副産物を runner に残す」場合、パッケージ横断の glob を使う workflow step は再点検が要る。
