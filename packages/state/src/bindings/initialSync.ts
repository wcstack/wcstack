import { getStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { config } from "../config";
import { ATTR_NAMESPACE, CLASS_NAMESPACE, COMMAND_NAMESPACE, MODIFIER_KEY_INIT, MODIFIER_KEY_SYNC, STYLE_NAMESPACE } from "../define";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { hasByAddressSymbol, setLoopContextSymbol } from "../proxy/symbols";
import { readBindableDeclaration } from "../protocol/wcBindableReader";
import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { IBindingInfo } from "../types";

/**
 * 左辺の先頭セグメントが名前空間になる束縛 — `apply/applyChange.ts` の
 * `applyChangeByFirstSegment` と**同じ集合**。
 *
 * ここが 1 つでも欠けると、欠けた名前空間が下の wcBindable プロパティ検証に落ちて
 * `Property "class.on" is not declared by wcBindable.` が飛び、**そのルートの束縛が
 * 1 つも立たなくなる**（`class.` / `attr.` / `style.` が実際にそうなっていた。
 * `command.` だけが除外されていた）。
 *
 * 集合の一致は `__tests__/bindings.initialSync.namespaces.test.ts` が apply 層の
 * ディスパッチ表と突き合わせて固定する（`manifest.test.ts` の drift 検出と同じ手）。
 */
const LEFT_HAND_NAMESPACES: ReadonlySet<string> = new Set<string>([
  CLASS_NAMESPACE, ATTR_NAMESPACE, STYLE_NAMESPACE, COMMAND_NAMESPACE,
]);

export type InitialAuthority = "state" | "element" | "auto" | "none";
export type ResolvedInitialAuthority = Exclude<InitialAuthority, "auto">;
export type InitialSyncOn = "call" | "connect";

export interface IInitialSyncPolicy {
  readonly authority: InitialAuthority;
  readonly syncOn: InitialSyncOn;
  readonly observable: boolean;
  /**
   * wcBindable 宣言が properties のみ（output-only member）であること。
   * authority は初期同期のみを支配する（docs/architecture-hardening/09 §3.6）が、
   * output-only member への state→element 書き込みは初期に限らず契約として
   * 恒久ブロックする。その判定を authority と分離してここに持つ。
   */
  readonly outputOnly: boolean;
}

function readOption(
  binding: IBindingInfo,
  key: "init" | "sync",
): string | null {
  let result: string | null = null;
  for (const modifier of binding.propModifiers) {
    const separator = modifier.indexOf("=");
    if (separator < 0) continue;
    const modifierKey = modifier.slice(0, separator).trim();
    const value = modifier.slice(separator + 1).trim();
    if (modifierKey !== MODIFIER_KEY_INIT && modifierKey !== MODIFIER_KEY_SYNC) {
      raiseError(`Unknown binding modifier "${modifierKey}" in "${modifier}".`);
    }
    if (modifierKey !== key) continue;
    if (result !== null) {
      raiseError(`Binding modifier "${key}" may only be specified once.`);
    }
    result = value;
  }
  return result;
}

function parseAuthority(value: string | null): InitialAuthority | null {
  if (value === null) return null;
  if (value === "state" || value === "element" || value === "auto" || value === "none") {
    return value;
  }
  return raiseError(`Invalid init modifier value "${value}".`);
}

function parseSyncOn(value: string | null): InitialSyncOn {
  if (value === null || value === "call") return "call";
  if (value === "connect") return "connect";
  return raiseError(`Invalid sync modifier value "${value}".`);
}

export function hasInitialSyncModifier(binding: IBindingInfo): boolean {
  return binding.propModifiers.some((modifier) => modifier.includes("="));
}

// 頻出ポリシー（修飾子なしの通常バインディング）の凍結シングルトン。リスト行では
// binding ごとに resolveInitialSyncPolicy が走るため、毎回のオブジェクト割り当てを
// 避ける（record.initialPolicy は読み取り専用でしか使われない）。
const STATE_CALL_POLICY: IInitialSyncPolicy = Object.freeze({ authority: "state", syncOn: "call", observable: false, outputOnly: false });
const NONE_CALL_POLICY: IInitialSyncPolicy = Object.freeze({ authority: "none", syncOn: "call", observable: false, outputOnly: false });

function statePolicy(authority: InitialAuthority, syncOn: IInitialSyncPolicy["syncOn"]): IInitialSyncPolicy {
  if (authority === "state" && syncOn === "call") return STATE_CALL_POLICY;
  return { authority, syncOn, observable: false, outputOnly: false };
}

export function resolveInitialSyncPolicy(binding: IBindingInfo): IInitialSyncPolicy {
  if (!config.enableDirectionalInitialSync) {
    if (hasInitialSyncModifier(binding)) {
      raiseError("init=/sync= modifiers require enableDirectionalInitialSync.");
    }
    return STATE_CALL_POLICY;
  }

  const explicitAuthority = parseAuthority(readOption(binding, MODIFIER_KEY_INIT));
  const syncOn = parseSyncOn(readOption(binding, MODIFIER_KEY_SYNC));
  if (binding.bindingType === "event") {
    if (explicitAuthority !== null && explicitAuthority !== "none") {
      raiseError("Event bindings only allow init=none.");
    }
    return syncOn === "call" ? NONE_CALL_POLICY : { authority: "none", syncOn, observable: false, outputOnly: false };
  }
  // 左辺の名前空間（`class.` / `attr.` / `style.` / `command.`）は bindingType こそ "prop" だが、
  // `propName` は wcBindable の property **ではない**。下の property authority 検証
  // （未宣言なら raiseError）に掛けてはならず、掛けると wc-bindable 要素に `class.on: flag` と
  // 書いただけで `Property "class.on" is not declared by wcBindable.` が飛び、
  // **そのルートの束縛が 1 つも立たなくなる**（`getBindingsReady` ごと reject）。
  // 値の初期同期を持たない配線なので、現行互換の "state" authority を返す
  // （command token は従来どおり初期 apply で配線される）。
  if (LEFT_HAND_NAMESPACES.has(binding.propSegments[0])) {
    return statePolicy("state", syncOn);
  }
  if (binding.bindingType !== "prop") {
    if (explicitAuthority !== null && explicitAuthority !== "state" && explicitAuthority !== "none") {
      raiseError(`Binding type "${binding.bindingType}" does not support init=${explicitAuthority}.`);
    }
    return statePolicy(explicitAuthority ?? "state", syncOn);
  }

  const declaration = readBindableDeclaration(binding.node);
  if (declaration === null) {
    return statePolicy(explicitAuthority ?? "state", syncOn);
  }
  const hasOutput = declaration.knownProperties.has(binding.propName);
  const hasInput = declaration.declaredInputs.has(binding.propName);
  if (!hasOutput && !hasInput) {
    raiseError(`Property "${binding.propName}" is not declared by wcBindable.`);
  }

  const allowed = hasOutput && hasInput
    ? new Set<InitialAuthority>(["state", "element", "auto", "none"])
    : hasOutput
      ? new Set<InitialAuthority>(["element", "none"])
      : new Set<InitialAuthority>(["state", "none"]);
  const defaultAuthority: InitialAuthority = hasOutput && !hasInput ? "element" : "state";
  const authority = explicitAuthority ?? defaultAuthority;
  if (!allowed.has(authority)) {
    raiseError(`init=${authority} is incompatible with wcBindable member "${binding.propName}".`);
  }
  if (syncOn === "connect" && !hasOutput) {
    raiseError(`sync=connect requires observable property "${binding.propName}".`);
  }
  return { authority, syncOn, observable: hasOutput, outputOnly: hasOutput && !hasInput };
}

export function isBindingStateInitialized(binding: IBindingInfo): boolean {
  const rootNode = binding.replaceNode.getRootNode() as Node;
  const stateElement = getStateElement(rootNode);
  if (stateElement === null) {
    raiseError(`No state tree found on this root for binding.`);
  }
  const address = getStateAddressByBindingInfo(binding);
  let initialized = false;
  stateElement.createState("readonly", (state) => {
    initialized = state[hasByAddressSymbol](address);
  });
  return initialized;
}

export function resolveInitialAuthority(
  binding: IBindingInfo,
  authority: InitialAuthority,
): ResolvedInitialAuthority {
  if (authority !== "auto") return authority;
  return isBindingStateInitialized(binding) ? "state" : "element";
}

export function commitProducerValue(binding: IBindingInfo, value: unknown): void {
  let filteredValue = value;
  for (const filter of binding.inFilters) {
    filteredValue = filter.filterFn(filteredValue);
  }
  const rootNode = binding.node.getRootNode() as Node;
  const stateElement = getStateElement(rootNode);
  if (stateElement === null) {
    raiseError(`No state tree found on this root for initial binding sync.`);
  }
  const loopContext = getLoopContextByNode(binding.node);
  stateElement.createState("writable", (state) => {
    state[setLoopContextSymbol](loopContext, () => {
      state[binding.statePathName] = filteredValue;
    });
  });
}
