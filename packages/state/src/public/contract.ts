/**
 * The dev-time contract analyzer (@wcstack/state 3.x, opt-in with `enableContractAnalyzer`):
 * compares the `static wcBindable` of the registered custom elements with a sidecar manifest
 * (vscode-wcs's `wcstack.types`) and reports the drift as `contract:*` events, which also go to
 * DevTools when it is attached. Off (the default), it returns at once and reads nothing.
 * The events are built with quoted keys: the author and DevTools read them.
 */
import { config } from "../config";
import { devtoolsSink } from "../devtools/devtools";

export interface IContractObservable {
  readonly event?: string;
}

export interface IContractComponent {
  readonly observables?: Readonly<Record<string, IContractObservable>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly commands?: Readonly<Record<string, unknown>>;
}

export interface IContractManifest {
  readonly manifestExtensions?: {
    readonly "wcstack.types"?: {
      readonly components?: Readonly<Record<string, IContractComponent>>;
    };
    readonly [namespace: string]: unknown;
  };
}

export type ContractEvent =
  | {
      /** One component's contract was read from the manifest; `loaded`: its tag is registered. */
      readonly type: "contract:manifest-read";
      readonly tag: string;
      readonly loaded: boolean;
    }
  | {
      /** A manifest namespace the runtime does not interpret. */
      readonly type: "contract:unsupported-extension";
      readonly namespace: string;
    }
  | {
      /** The manifest and the live declaration disagree (the live one is authoritative). */
      readonly type: "contract:drift";
      readonly reason: "component-not-loaded" | "missing-member" | "event-mismatch";
      readonly tag: string;
      readonly member?: string;
      readonly sidecarEvent?: string;
      readonly liveEvent?: string;
    };

interface LiveDeclaration {
  readonly events: ReadonlyMap<string, string>;
  readonly inputs: ReadonlySet<string>;
  readonly commands: ReadonlySet<string>;
}

const KNOWN_NAMESPACES = new Set(["wcstack.types", "wcstack.async", "wcstack.platformCapabilities", "wcstack.application"]);
const NONE: readonly ContractEvent[] = Object.freeze([]);

export function analyzeContract(manifest: IContractManifest): readonly ContractEvent[] {
  if (!config.enableContractAnalyzer) return NONE;
  const events: ContractEvent[] = [];
  const sink = devtoolsSink();
  const emit = (event: ContractEvent): void => {
    events.push(event);
    sink?.(event);
  };
  const extensions = manifest["manifestExtensions"];
  if (extensions === null || typeof extensions !== "object") return events;
  for (const namespace of Object.keys(extensions)) {
    if (!KNOWN_NAMESPACES.has(namespace)) emit({ "type": "contract:unsupported-extension", "namespace": namespace });
  }
  const components = extensions["wcstack.types"]?.["components"];
  if (components === undefined || components === null) return events;
  for (const [tag, raw] of Object.entries(components)) {
    const live = liveDeclaration(tag);
    emit({ "type": "contract:manifest-read", "tag": tag, "loaded": live !== null });
    if (live === null) {
      emit({ "type": "contract:drift", "reason": "component-not-loaded", "tag": tag });
      continue;
    }
    // a broken entry (null, a primitive) does not stop the analysis
    const component: IContractComponent = raw !== null && typeof raw === "object" ? raw : {};
    for (const [member, observable] of Object.entries(component["observables"] ?? {})) {
      const liveEvent = live.events.get(member);
      if (liveEvent === undefined) {
        emit({ "type": "contract:drift", "reason": "missing-member", "tag": tag, "member": member });
        continue;
      }
      const sidecarEvent = observable?.["event"];
      if (typeof sidecarEvent === "string" && sidecarEvent !== liveEvent) {
        emit({ "type": "contract:drift", "reason": "event-mismatch", "tag": tag, "member": member, "sidecarEvent": sidecarEvent, "liveEvent": liveEvent });
      }
    }
    for (const member of Object.keys(component["inputs"] ?? {})) {
      if (!live.inputs.has(member)) emit({ "type": "contract:drift", "reason": "missing-member", "tag": tag, "member": member });
    }
    for (const member of Object.keys(component["commands"] ?? {})) {
      if (!live.commands.has(member)) emit({ "type": "contract:drift", "reason": "missing-member", "tag": tag, "member": member });
    }
  }
  return events;
}

/** A registered element's `static wcBindable`, indexed; null when it is not registered or not wc-bindable. */
function liveDeclaration(tag: string): LiveDeclaration | null {
  const d = (customElements.get(tag) as { wcBindable?: any } | undefined)?.wcBindable;
  if (d === null || typeof d !== "object" || d["protocol"] !== "wc-bindable") return null;
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const events = new Map<string, string>();
  for (const p of list(d["properties"])) if (typeof p?.["name"] === "string" && typeof p["event"] === "string") events.set(p["name"], p["event"]);
  const names = (v: unknown): Set<string> => new Set(list(v).map((x) => x?.["name"]).filter((n): n is string => typeof n === "string"));
  return { events, inputs: names(d["inputs"]), commands: names(d["commands"]) };
}
