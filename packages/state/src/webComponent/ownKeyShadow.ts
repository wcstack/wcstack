import { DELIMITER } from "../define";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
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
 * - **隠された部分エントリ**（`warnShadowedMountEntries`）: B14 ② が勝つのは「1 段のエントリ ×
 *   同名の own data key」だけ。アクセサ・メソッド・深いエントリの先頭キーはコンポーネント側が
 *   勝ち続けるので、ホストが書いたエントリが**届かないまま**になる。その形を名指しで報告する。
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
  warnShadowedMountEntries(record);
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

/**
 * ホストが明示した部分エントリが、コンポーネント自身の面に隠されて**死んでいる**形を報告する。
 *
 * - `state.display: x` ＋ `get display()` — 規則 1（アクセサ）が先に当たり、エントリは届かない
 * - `state.save: x` ＋ `save()` — メソッドは常に作者のもの（isPrivateAnchor）なのでエントリは届かない
 * - `state.a.b: x` ＋ own data key `a` — 深いエントリは先頭キーの私有性を奪わない（B14 ② は
 *   1 段のエントリの話）ので、`a.b` は私有アンカーに落ちてエントリは届かない
 *
 * ボリュームは同じ衝突を接ぎ木より前に raise する（D30・validateVolumeDeclarations）。
 * コンポーネント側は、いま成立しているページを落とさないために warn に留める。
 */
function warnShadowedMountEntries(record: IMountRecord): void {
  const tag = record.component.tagName.toLowerCase();
  const stateProp = record.stateProp;
  let descriptors: Record<string, PropertyDescriptor> | null = null;
  for (const entry of record.entries) {
    if (entry.innerSegments.length === 0) {
      continue; // ルートエントリは何も覆わない（own key 側の報告が受け持つ）
    }
    const key = entry.innerSegments[0];
    // getter は評価せずに種別を判定する（プロトタイプ宣言のアクセサも拾う）
    descriptors ??= getAllPropertyDescriptors(record.stateObject as object);
    const descriptor = descriptors[key];
    let owner: string;
    if (record.getterKeys.has(key) || record.setterKeys.has(key)
      || typeof descriptor?.get === "function" || typeof descriptor?.set === "function") {
      owner = "an accessor";
    } else if (typeof descriptor?.value === "function") {
      owner = "a method";
    } else if (!record.mappedKeys.has(key) && !record.injectedKeys.has(key)
      && Object.prototype.hasOwnProperty.call(record.stateObject, key)) {
      owner = "an own data key";
    } else {
      continue;
    }
    const inner = entry.innerSegments.join(DELIMITER);
    report(
      `${tag}|${stateProp}|${inner}|entry`,
      `<${tag}>.${stateProp} declares "${key}" as ${owner}, which hides the mounted entry ` +
      `"${stateProp}.${inner}: ${entry.outerPathInfo.path}" (the host value never reaches it). ` +
      `Rename one of them.`,
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
