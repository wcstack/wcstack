/**
 * contract/contractAnalyzer.ts
 *
 * Phase 5b(09-remediation-design.md §5b / §7.1 dev runtime / §6 contract trace)の
 * opt-in dev-time analyzer。実際に登録済みの custom element の `static wcBindable`
 * 宣言(= 実行時の正本)を、利用者が渡した sidecar manifest と突き合わせ、drift を
 * DevTools trace(`contract:*`)へ流す。
 *
 * 完了条件「無効時の runtime 挙動・cost が不変」: `analyzeContract` は
 * `config.enableContractAnalyzer` が false のとき即 return し、manifest を一切走査
 * しない(hot path には一切フックしない — 純粋な on-demand API)。
 *
 * pure な core(`analyzeManifestContract`)は宣言解決と emit を注入で受けるためテスト可能。
 */

import { config } from "../config.js";
import { devtoolsSink } from "../devtools/sink.js";
import { ContractEvent } from "../devtools/types.js";
import { getCustomElementRegistry } from "../platform/customElementRegistry.js";
import { IContractComponent, IContractManifest, ILiveDeclaration } from "./types.js";

/** runtime analyzer が解釈する manifest namespace。これ以外は unsupported-extension。 */
const KNOWN_NAMESPACES: ReadonlySet<string> = new Set([
  "wcstack.types",
  "wcstack.async",
  "wcstack.platformCapabilities",
  "wcstack.application",
]);

const EMPTY: readonly ContractEvent[] = Object.freeze([]);

/**
 * opt-in dev-time contract analysis。無効時はゼロコスト(即 return・manifest 非走査)。
 * 有効時は live 宣言と manifest を突き合わせ、`contract:*` trace を返しつつ、DevTools
 * sink が接続されていれば同時に流す。
 */
export function analyzeContract(manifest: IContractManifest): readonly ContractEvent[] {
  if (!config.enableContractAnalyzer) return EMPTY;
  const events: ContractEvent[] = [];
  const emit = (event: ContractEvent): void => {
    events.push(event);
    if (devtoolsSink !== null) devtoolsSink(event);
  };
  analyzeManifestContract(manifest, resolveLiveDeclaration, emit);
  return events;
}

/**
 * pure core。`resolveDeclaration(tag)` は該当タグの live 宣言(未登録なら null)を返す。
 * emit は生成した trace を受ける。config フラグは見ない(呼び出し側が guard 済み)。
 */
export function analyzeManifestContract(
  manifest: IContractManifest,
  resolveDeclaration: (tag: string) => ILiveDeclaration | null,
  emit: (event: ContractEvent) => void,
): void {
  const extensions = manifest.manifestExtensions;
  if (extensions === null || typeof extensions !== "object") return;

  // 未知 namespace は runtime が解釈しない → unsupported-extension。
  for (const namespace of Object.keys(extensions)) {
    if (!KNOWN_NAMESPACES.has(namespace)) {
      emit({ type: "contract:unsupported-extension", namespace });
    }
  }

  const components = extensions["wcstack.types"]?.components;
  if (components === undefined || components === null) return;

  for (const [tag, component] of Object.entries(components)) {
    const live = resolveDeclaration(tag);
    emit({ type: "contract:manifest-read", tag, loaded: live !== null });
    if (live === null) {
      // manifest が宣言するタグが実行時に登録されていない = component-not-loaded drift。
      emit({ type: "contract:drift", reason: "component-not-loaded", tag });
      continue;
    }
    checkComponentDrift(tag, component, live, emit);
  }
}

function checkComponentDrift(
  tag: string,
  rawComponent: unknown,
  live: ILiveDeclaration,
  emit: (event: ContractEvent) => void,
): void {
  // 壊れた manifest(component が null / primitive)でも analyzer 全体を落とさない。
  const component: IContractComponent =
    rawComponent !== null && typeof rawComponent === "object" ? (rawComponent as IContractComponent) : {};
  for (const [member, observable] of Object.entries(component.observables ?? {})) {
    if (!live.propertyEvents.has(member)) {
      emit({ type: "contract:drift", reason: "missing-member", tag, member });
      continue;
    }
    const liveEvent = live.propertyEvents.get(member)!;
    const sidecarEvent = observable?.event;
    if (typeof sidecarEvent === "string" && sidecarEvent !== liveEvent) {
      emit({ type: "contract:drift", reason: "event-mismatch", tag, member, sidecarEvent, liveEvent });
    }
  }
  for (const member of Object.keys(component.inputs ?? {})) {
    if (!live.inputs.has(member)) {
      emit({ type: "contract:drift", reason: "missing-member", tag, member });
    }
  }
  for (const member of Object.keys(component.commands ?? {})) {
    if (!live.commands.has(member)) {
      emit({ type: "contract:drift", reason: "missing-member", tag, member });
    }
  }
}

/**
 * 登録済み custom element の `static wcBindable` を drift 照合用に索引化する。
 * 未登録・非 wc-bindable は null(= component-not-loaded)。
 */
function resolveLiveDeclaration(tag: string): ILiveDeclaration | null {
  const registry = getCustomElementRegistry();
  const ctor = registry?.get(tag);
  if (ctor === undefined) return null;
  const declaration = (ctor as { readonly wcBindable?: unknown }).wcBindable;
  if (
    declaration === null
    || typeof declaration !== "object"
    || (declaration as { protocol?: unknown }).protocol !== "wc-bindable"
  ) {
    return null;
  }
  const decl = declaration as {
    readonly properties?: readonly { readonly name?: unknown; readonly event?: unknown }[];
    readonly inputs?: readonly { readonly name?: unknown }[];
    readonly commands?: readonly { readonly name?: unknown }[];
  };
  // 各配列は非配列(object 等)でも落ちないよう Array.isArray で container を守る。
  const propertyEvents = new Map<string, string>();
  for (const property of Array.isArray(decl.properties) ? decl.properties : []) {
    if (typeof property?.name === "string" && typeof property.event === "string") {
      propertyEvents.set(property.name, property.event);
    }
  }
  const inputs = new Set<string>();
  for (const input of Array.isArray(decl.inputs) ? decl.inputs : []) {
    if (typeof input?.name === "string") inputs.add(input.name);
  }
  const commands = new Set<string>();
  for (const command of Array.isArray(decl.commands) ? decl.commands : []) {
    if (typeof command?.name === "string") commands.add(command.name);
  }
  return { propertyEvents, inputs, commands };
}
