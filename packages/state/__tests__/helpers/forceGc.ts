import v8 from "node:v8";
import vm from "node:vm";

/**
 * V8 の完全 GC を走らせる。索引が行を弱く持つこと（要素オブジェクトの索引 — src/list/createListIndex.ts の rowsByElement）を、
 * ヒープの大きさではなく生きている行の数で確かめる番人が使う。WeakRef の先は作った・引いたジョブの間は生かされるので、
 * マクロタスクを 1 つ待ってから走らせる。
 */
export async function forceGc(): Promise<void> {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc") as () => void;
  await new Promise((resolve) => setTimeout(resolve, 0));
  gc();
}
