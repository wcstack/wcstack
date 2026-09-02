import { getLoopContextByNode } from "../list/loopContextByNode";
import { setLoopContextSymbol } from "../proxy/symbols";
import { getPrimaryMappingRules, IMappingRule } from "./MappingRule";
import { getInjectedKeys } from "./preCompletionWrites";

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

function ownDataKeys(state: Record<string, any>, injected: ReadonlySet<string> | undefined): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(state)) {
    if (key.startsWith('$')) {
      continue;
    }
    // 完了前の親の初期適用（`state.theme: theme` の積み）が作ったキーは作者のものではない
    if (typeof injected !== 'undefined' && injected.has(key)) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(state, key)!;
    if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      continue;
    }
    if (typeof descriptor.value === 'function') {
      continue;
    }
    keys.push(key);
  }
  return keys;
}

/**
 * ルート規則のマウント先の現在値を読む。ワイルドカードを含むマウント先（`users.*`）は
 * ホスト要素のループ文脈で解決する。文脈が無ければ判定できないので undefined。
 */
function readMountTarget(component: Element, rule: IMappingRule): unknown {
  const outer = rule.outerAbsPathInfo;
  const loopContext = getLoopContextByNode(component);
  if (outer.pathInfo.wildcardCount > 0 && loopContext === null) {
    return undefined;
  }
  let value: unknown = undefined;
  outer.stateElement.createState("readonly", (state) => {
    state[setLoopContextSymbol](loopContext, () => {
      value = state[outer.pathInfo.path];
    });
  });
  return value;
}

function report(key: string, message: string): void {
  if (reported.has(key)) {
    return;
  }
  reported.add(key);
  console.warn(`[@wcstack/state] [wcs/mount-own-key-shadow] ${message} See docs/state-mount-design.md §4-3.`);
}

export function warnOwnKeyShadows(component: Element, stateProp: string, state: Record<string, any>): void {
  const rules = getPrimaryMappingRules(component);
  if (rules === null) {
    return;
  }
  const keys = ownDataKeys(state, getInjectedKeys(component, stateProp));
  if (keys.length === 0) {
    return;
  }
  const tag = component.tagName.toLowerCase();
  let rootRule: IMappingRule | null = null;
  const partialRuleByKey = new Map<string, IMappingRule>();
  for (const rule of rules) {
    if (rule.isRoot) {
      rootRule = rule;
    } else if (rule.innerAbsPathInfo.pathInfo.segments.length === 1) {
      partialRuleByKey.set(rule.innerAbsPathInfo.pathInfo.path, rule);
    }
  }
  let mountTarget: unknown = undefined;
  let mountTargetRead = false;
  for (const key of keys) {
    const partial = partialRuleByKey.get(key);
    if (typeof partial !== 'undefined') {
      const outerPath = partial.outerAbsPathInfo.pathInfo.path;
      report(
        `${tag}|${stateProp}|${key}|partial`,
        `<${tag}>.${stateProp}.${key} is an own key of the component and is also mapped from the host ("${stateProp}.${key}: ${outerPath}"). ` +
        `Today the host value wins; in v2 the own key becomes private and hides the host value. Remove the default, or drop the mapping.`,
      );
      continue;
    }
    if (rootRule === null) {
      continue;
    }
    if (!mountTargetRead) {
      mountTarget = readMountTarget(component, rootRule);
      mountTargetRead = true;
    }
    if (typeof mountTarget !== 'object' || mountTarget === null || !(key in (mountTarget as object))) {
      continue;
    }
    const outerPath = rootRule.outerAbsPathInfo.pathInfo.path;
    report(
      `${tag}|${stateProp}|${key}|root`,
      `<${tag}>.${stateProp}.${key} is private and hides the mounted tree key "${outerPath}.${key}" (${stateProp}: ${outerPath}). ` +
      `Remove the default to read the tree, or rename it to keep it private.`,
    );
  }
}
