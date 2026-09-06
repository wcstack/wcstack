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
 * - **部分マウント**（`state.message: x` ＋ `state = { message: "" }`）: 1.x では
 *   マッピングが勝つ（既存挙動・不変）が、v2 では R1 で own key が私有になり逆転する。
 *   反転を 1.x の時点で予告する。
 *
 * どちらも「既定値を消す（ツリーを読む）か、名前を変える（私有のまま）」で直る。
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
 * 私有で、マウント先の同名キー（ルート）／同名の部分エントリ（1 セグメント）を**隠す**。
 * 積みで注入されたキーは privateSnapshot に入らないので対象外。
 */
export function warnOwnKeyShadowsForMount(record: IMountRecord): void {
  const keys = Object.keys(record.privateSnapshot);
  if (keys.length === 0) {
    return;
  }
  const tag = record.component.tagName.toLowerCase();
  const stateProp = record.stateProp;
  const partialOuterByKey = new Map<string, string>();
  for (const entry of record.entries) {
    if (entry.innerSegments.length === 1) {
      partialOuterByKey.set(entry.innerSegments[0], entry.outerPathInfo.path);
    }
  }
  let mountTarget: unknown = undefined;
  let mountTargetRead = false;
  for (const key of keys) {
    const partialOuter = partialOuterByKey.get(key);
    if (typeof partialOuter !== "undefined") {
      report(
        `${tag}|${stateProp}|${key}|root`,
        `<${tag}>.${stateProp}.${key} is private and hides the mounted entry "${stateProp}.${key}: ${partialOuter}" (the host value no longer reaches it). ` +
        `Remove the default to read the tree, or rename it to keep it private.`,
      );
      continue;
    }
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
