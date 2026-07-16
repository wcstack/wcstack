/**
 * core/sidecar/types.ts
 *
 * `wcstack.manifest.json` の型(docs/wcstack-manifest-schema.md / 09 §7)。
 * package = 再利用可能なコンポーネント契約、application = 具体アプリの state schema。
 * 別 artifact として扱い、同一 file に merge しない。
 */

/** JSON-Schema subset の 1 ノード(§4)。許可 keyword: type/properties/required/items/enum/const/anyOf/$defs/$ref(local)。 */
export interface JsonSchemaNode {
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchemaNode;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly $defs?: Readonly<Record<string, JsonSchemaNode>>;
  readonly $ref?: string;
  /** 未知 keyword を保持して unsupported diagnostic に回すため index 許可。 */
  readonly [keyword: string]: unknown;
}

export type ManifestKind = "package" | "application";

export interface BindingProtocolRef {
  readonly protocol: string;
  readonly minimumVersion: number;
}

export interface BehavioralRequirements {
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

// --- wcstack.types (package) ---
export interface TypesObservable {
  readonly event: string;
  readonly schema?: JsonSchemaNode;
}
export interface TypesInput {
  readonly schema?: JsonSchemaNode;
  /** input が readonly member を指す場合の宣言(readonly 検査用)。 */
  readonly readonly?: boolean;
}
export interface TypesCommand {
  readonly args?: JsonSchemaNode;
  readonly result?: JsonSchemaNode;
}
export interface TypesComponent {
  readonly observables?: Readonly<Record<string, TypesObservable>>;
  readonly inputs?: Readonly<Record<string, TypesInput>>;
  readonly commands?: Readonly<Record<string, TypesCommand>>;
  /** 明示的な override 宣言(既定 false = override 禁止)。 */
  readonly override?: boolean;
}
export interface TypesExtension {
  readonly version: number;
  readonly components: Readonly<Record<string, TypesComponent>>;
}

// --- wcstack.async (package, tooling-only) ---
export interface AsyncOperation {
  readonly lane: string;
  readonly policy: string;
}
export interface AsyncComponent {
  readonly operations?: Readonly<Record<string, AsyncOperation>>;
}
export interface AsyncExtension {
  readonly version: number;
  readonly components: Readonly<Record<string, AsyncComponent>>;
}

// --- wcstack.platformCapabilities (package) ---
export interface CapabilitiesComponent {
  readonly required?: readonly string[];
  readonly optional?: readonly string[];
}
export interface PlatformCapabilitiesExtension {
  readonly version: number;
  readonly components: Readonly<Record<string, CapabilitiesComponent>>;
}

// --- wcstack.application (application) ---
export interface ApplicationState {
  readonly stateSchema: JsonSchemaNode;
}
export interface ApplicationFilter {
  readonly input?: JsonSchemaNode;
  readonly output?: JsonSchemaNode;
}
export interface ApplicationExtension {
  readonly version: number;
  readonly states?: Readonly<Record<string, ApplicationState>>;
  readonly filters?: Readonly<Record<string, ApplicationFilter>>;
  readonly listContexts?: readonly string[];
}

export interface ManifestExtensions {
  readonly "wcstack.types"?: TypesExtension;
  readonly "wcstack.async"?: AsyncExtension;
  readonly "wcstack.platformCapabilities"?: PlatformCapabilitiesExtension;
  readonly "wcstack.application"?: ApplicationExtension;
  readonly [namespace: string]: unknown;
}

export interface WcstackManifest {
  readonly schemaVersion: number;
  readonly kind: ManifestKind;
  readonly bindingProtocol?: BindingProtocolRef;
  readonly behavioralRequirements?: BehavioralRequirements;
  readonly manifestExtensions?: ManifestExtensions;
}

/** reader が対応する envelope major。 */
export const SUPPORTED_SCHEMA_VERSION = 1;
/** 各 wcstack.* namespace が対応する version。 */
export const SUPPORTED_NAMESPACE_VERSION = 1;

/** live wcBindable 宣言(drift 照合用の最小形)。runtime が正本。 */
export interface LiveBindableDeclaration {
  readonly tag: string;
  readonly properties: ReadonlyArray<{ readonly name: string; readonly event: string }>;
  readonly inputs?: ReadonlyArray<{ readonly name: string }>;
  readonly commands?: ReadonlyArray<{ readonly name: string }>;
}
