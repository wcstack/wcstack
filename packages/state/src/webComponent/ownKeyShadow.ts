import { getLoopContextByNode } from "../list/loopContextByNode";
import { setLoopContextSymbol } from "../proxy/symbols";
import { IMountRecord } from "./mount";

/**
 * コンポーネントの own data key とマウントの衝突を、バインド確立時に 1 回だけ報告する
 * （docs/state-mount-design.md D4 / D19、impl-plan P1-10 / P1-11）。
 *
 * 2 つの形がある。
 *
 * - **ルートマウント**（`state: user`）: R1 では own data key は私有で、マウント先の
 *   同名キー（`user.name`）を**隠す**。書き手が「既定値」のつもりで置いたキーがツリーを
 *   読まなくなるので、マウント先の値がオブジェクトで同名キーを持つときに報告する。
 * - **部分マウント**（`state.message: x` ＋ `state = { message: "" }`）は 3.0 から衝突しない:
 *   ホストが明示したエントリが同名の own key に勝つ（要件 B14 ②）。v2 では own key が私有として
 *   勝っていたので、ここで報告していた。
 *
 * 「既定値を消す（ツリーを読む）か、名前を変える（私有のまま）」で直る。
 * 報告はタグ名 × プロパティ × キーで 1 回（リストの行ごとに並ばないように）。
 * ホットパス外（bindWebComponent の中・要素につき 1 回）。
 */
const reported = new Set<string>();

/** テスト用: 報告済み台帳を空にする。 */
export function clearOwnKeyShadowReportsForTesting(): void {
  reported.clear();
}



function report(key: string, message: string): void {
  if (reported.has(key)) {
    return;
  }
  reported.add(key);
  console.warn(`[@wcstack/state] [wcs/mount-own-key-shadow] ${message} See docs/state-mount-design.md §4-3.`);
}

/**
 * v2 マウント（Phase 2）の衝突報告。厳格 R1: 作者の own data key（privateSnapshot）は
 * 私有で、ルートマウントのマウント先の同名キーを**隠す**。積みで注入されたキーと、部分エントリが
 * 明示したキー（要件 B14 ②）は privateSnapshot に入らないので対象外。
 */
export function warnOwnKeyShadowsForMount(record: IMountRecord): void {
  const keys = Object.keys(record.privateSnapshot);
  if (keys.length === 0) {
    return;
  }
  const tag = record.component.tagName.toLowerCase();
  const stateProp = record.stateProp;
  let mountTarget: unknown = undefined;
  let mountTargetRead = false;
  for (const key of keys) {
    if (record.rootEntry === null) {
      continue;
    }
    if (!mountTargetRead) {
      mountTarget = readMountRootTarget(record);
      mountTargetRead = true;
    }
    if (typeof mountTarget !== "object" || mountTarget === null || !(key in (mountTarget as object))) {
      continue;
    }
    const outerPath = record.rootEntry.outerPathInfo.path;
    report(
      `${tag}|${stateProp}|${key}|root`,
      `<${tag}>.${stateProp}.${key} is private and hides the mounted tree key "${outerPath}.${key}" (${stateProp}: ${outerPath}). ` +
      `Remove the default to read the tree, or rename it to keep it private.`,
    );
  }
}

function readMountRootTarget(record: IMountRecord): unknown {
  const rootEntry = record.rootEntry!;
  const loopContext = getLoopContextByNode(record.component);
  if (rootEntry.outerPathInfo.wildcardCount > 0 && loopContext === null) {
    return undefined;
  }
  let value: unknown = undefined;
  record.parentStateElement.createState("readonly", (state) => {
    state[setLoopContextSymbol](loopContext, () => {
      value = (state as Record<string, unknown>)[rootEntry.outerPathInfo.path];
    });
  });
  return value;
}
