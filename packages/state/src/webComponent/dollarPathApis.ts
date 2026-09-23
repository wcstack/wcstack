/**
 * webComponent/dollarPathApis.ts — スコープの chroot が接頭辞翻訳する `$` API の表
 * （設計書 docs/state-mount-design.md §4-6）。
 *
 * ボリューム（`mount=` — volumeShared.createVolumeChroot）とマウントされたコンポーネント
 * （`bind-component` — overlay.ts の 2 つの chroot）は、どちらも「作者が書いた相対パスを
 * 親ツリーの絶対パスへ翻訳してから親 proxy の `$` API を呼ぶ」。**表を 1 つにしてあるのは、
 * 片方だけに API を足して静かな非対称を作らないため** — 実際、3.0 の鍵付き選択（`$eq` /
 * `$eqPath` / `$eqIndex`）と `$dependOn` はどの chroot にも載っておらず、スコープの中で
 * ルートのパスを読んでいた（診断も出ないまま `false` を返すか、作者が書いていないパスを
 * 名指しして throw していた）。番人は `__tests__/webComponent.dollarPathApis.test.ts`。
 *
 * ここに載るのは「**パスだけを取る**読みの API」。`$getAll` / `$setAll` / `$resolve` /
 * `$postUpdate` は各 chroot が個別に包む — スコープ相対の indexes を接頭辞ぶん合成する
 * （composeMountIndexes）必要があり、`$setAll` と 3 引数の `$resolve` は**書き込み**として
 * `#ro` のマウント（要件 B14 ①）を検査するため。
 *
 * `$untracked` / `$untrackDependency` は**コールバックを取る**（パスではない）ので対象外。
 * `$stateElement` / `$command` / `$1`…`$n` / `$streamStatus.*` も同様にパスを取らない。
 *
 * **計測（R2・2026-09-23）**: 包みは `$` API のアクセスごとに 3 つのクロージャ（wrapper と
 * `translate` / `invoke` の 2 アロー）を作る。`create-10k` と同規模（10,000 アクセス × 41 サンプル、
 * 中央値）で単離すると、素通し（修正前）に対して **+43〜57 ns/アクセス ＝ 10,000 行で +0.43〜0.57 ms**。
 * `(record, api)` のメモ化も測ったが、Map 参照のほうが短命クロージャより高くつき
 * **一貫して 4〜13 ns/アクセス遅かった**（4 回とも同じ向き）ので**採らなかった**。
 * 費用が乗るのは「マウントスコープの中で鍵付き選択を使うページ」だけで、行あたり 1 回程度。
 */

/**
 * API 名 → パスとして翻訳する引数の位置。
 * どれも読みなので、翻訳は `write = false`（`#ro` の検査は掛からない）。
 */
export const PATH_ARGS_BY_DOLLAR_API: ReadonlyMap<string, readonly number[]> = new Map<string, readonly number[]>([
  // 鍵付き購読（proxy/traps/get.ts）。第 2 引数は鍵の**値**なので翻訳しない
  ["$eq", [0]],
  // `$eqPath(path, keyPath)` — **両方**がパス
  ["$eqPath", [0, 1]],
  // `$eqIndex(path, level?)` — 第 2 引数は段（数値）
  ["$eqIndex", [0]],
  // 動的依存の明示登録。`$trackDependency` は 3.x の間のエイリアス（要件 B12・4.0 で外す）
  ["$dependOn", [0]],
  ["$trackDependency", [0]],
]);

/**
 * chroot ごとの翻訳関数を受け取り、表のとおり引数を書き換えて親の API を呼ぶ包みを返す。
 * 表に無い API は `null`（呼び手が従来どおり親の意味論のまま返す）。
 */
export function createDollarPathApiWrapper(
  api: string,
  translate: (path: string) => string,
  invoke: (args: unknown[]) => unknown,
): ((...args: unknown[]) => unknown) | null {
  const pathArgs = PATH_ARGS_BY_DOLLAR_API.get(api);
  if (typeof pathArgs === "undefined") {
    return null;
  }
  return (...args: unknown[]): unknown => {
    const translated = args.slice();
    for (let i = 0; i < pathArgs.length; i++) {
      const at = pathArgs[i];
      // 省略された引数（`$eqIndex(path)` の level）はそのまま — 翻訳するのは文字列のパスだけ
      if (typeof translated[at] === "string") {
        translated[at] = translate(translated[at] as string);
      }
    }
    return invoke(translated);
  };
}
