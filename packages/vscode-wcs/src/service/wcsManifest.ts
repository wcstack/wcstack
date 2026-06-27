/**
 * wcsManifest.ts — @wcstack/state の機械可読マニフェスト（単一正本）への唯一の入口。
 *
 * これまで completionData.ts が手で複製していたフィルタ仕様・構造ディレクティブを、
 * @wcstack/state の正本から導出するための薄い再エクスポート層（route-a A2-1）。
 * 二重実装・手作業同期によるドリフトを排除する。
 *
 * 公開パッケージ `@wcstack/state/manifest`（devDependency: file:../state ＋ build 済 dist）を消費。
 * linkage はこの1ファイルに隔離してあるので、将来 npm 公開版へ切替える際もここだけ変えればよい。
 * 区切り文字など他のマニフェスト項目が必要になれば `getWcsManifest().syntax` から引ける。
 */
export { builtinFilterMeta, STRUCTURAL_BINDING_TYPE_SET, getWcsManifest } from '@wcstack/state/manifest';
export type { IFilterMeta } from '@wcstack/state/manifest';
