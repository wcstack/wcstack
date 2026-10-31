/**
 * wcsManifest.ts — @wcstack/state の機械可読マニフェスト（単一正本）への唯一の入口。
 *
 * これまで completionData.ts が手で複製していたフィルタ仕様・構造ディレクティブを、
 * @wcstack/state の正本から導出するための薄い再エクスポート層（route-a A2-1）。
 * 二重実装・手作業同期によるドリフトを排除する。
 *
 * 公開パッケージ `@wcstack/state/manifest`（devDependency: `"@wcstack/state": "file:../state"` — 4.0 のエンジン —
 * ＋ build 済 dist）を消費。4.0 の旧名の表（`filterAliases` など）は空なので、移行の案内は removedNames.ts が持つ。
 * linkage はこの1ファイルに隔離してあるので、将来 npm 公開版へ切替える際もここだけ変えればよい。
 * 区切り文字など他のマニフェスト項目が必要になれば `getWcsManifest().syntax` から引ける。
 */
import { getWcsManifest } from '@wcstack/state/manifest';
// The package.json of the same `@wcstack/state` (its `exports` does not name the file, so it is read by its path in
// node_modules — the `file:../state` link). Only `version` is used; the bundles inline it at build time.
import { version as stateVersion } from '../../node_modules/@wcstack/state/package.json';

export { builtinFilterMeta, STRUCTURAL_BINDING_TYPE_SET, getWcsManifest } from '@wcstack/state/manifest';

/**
 * The version of the `@wcstack/state` engine this validator is built from: the rules it carries are that release's.
 * `@wcstack/lint` is released with it in lockstep, so this is the lint's version too (the VS Code extension has a 2.x
 * version of its own). A page that pins a newer minor gets `wcs/lint-version-behind` (documentEnvValidator).
 */
export const ENGINE_VERSION: string = stateVersion;
export type { IFilterMeta } from '@wcstack/state/manifest';

type NativeCommandTable = Readonly<Record<string, readonly string[]>>;

/**
 * ネイティブ要素の `command.<method>:` が呼べるメソッドの表（manifest の `nativeCommands`。タグ → メソッド、
 * `*` は全要素。4.0 の native-commands 後付けが読む表）。コミット済みの state の dist はリリースまで src に
 * 遅れるので、表を持たない manifest では null（検査しない。CI の wcs-validate は state を src からビルドする）。
 */
export const NATIVE_COMMANDS: NativeCommandTable | null =
  (getWcsManifest() as { nativeCommands?: NativeCommandTable }).nativeCommands ?? null;

/** ネイティブの `tag` が呼べるメソッド（`*` の行と、タグ自身の行。表が無ければ null）。 */
export function nativeCommandsOf(tag: string): readonly string[] | null {
  if (NATIVE_COMMANDS === null) return null;
  return [...(NATIVE_COMMANDS['*'] ?? []), ...(Object.hasOwn(NATIVE_COMMANDS, tag) ? NATIVE_COMMANDS[tag] : [])];
}
