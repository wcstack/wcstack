/**
 * The public types of @wcstack/state (the same names as 3.x). The engine's own classes stay
 * internal: a page reaches `<wcs-state>` through `IStateElement`.
 */
import type { Feature } from "../hooks";
import type { BindingType } from "../parser/types";

export type { BindingType };

/** An add-on entry (`@wcstack/state/features/*`), installed with `installFeatures([...])`. */
export type IStateFeature = Feature;

export interface IWritableTagNames {
  state?: string;
  ssr?: string;
}

/** `bootstrapState(config)`: every option is optional (README "Configuration"). */
export interface IWritableConfig {
  bindAttributeName?: string;
  commentForPrefix?: string;
  commentIfPrefix?: string;
  commentElseIfPrefix?: string;
  commentElsePrefix?: string;
  tagNames?: IWritableTagNames;
  locale?: string;
  enableContractAnalyzer?: boolean;
}

/** What `$errorCallback(error, info)` receives about the binding that failed. */
export interface IBindingErrorInfo {
  /** The bound state path as written in `data-wcs` (wildcards intact). */
  readonly path: string;
  /** The binding's type as the parser classifies it. */
  readonly bindingType: BindingType;
  /**
   * The node the binding is on (the Text node for a text binding); null for a list no `for:`
   * renders (one only `$getAll` or `$watch` keeps) that failed to read.
   */
  readonly node: Node | null;
}

/** `<wcs-state>` (README "IStateElement"). */
export interface IStateElement extends HTMLElement {
  /** Resolves when the state is loaded and the page bound — also when initialization fails. */
  readonly initializePromise: Promise<void>;
  /**
   * Resolves once `connectedCallback` completed (`$connectedCallback` run); a root that fails to
   * initialize rejects it, and so does one whose `$connectedCallback` rejects (its page is bound).
   */
  readonly connectedCallbackPromise: Promise<void>;
  /** Runs `callback` with a state proxy; its writes are applied in the next drain. */
  createState(mutability: "readonly" | "writable", callback: (state: Record<string, any>) => void): void;
  /** `createState` whose callback may await; a readonly proxy stays readonly across its awaits. */
  createStateAsync(mutability: "readonly" | "writable", callback: (state: Record<string, any>) => Promise<void>): Promise<void>;
  /**
   * Before initialization: the initial state. After: replaces the whole state and re-applies every
   * binding — also on a root whose `$connectedCallback` rejected. Throws on a root that failed to
   * initialize (#14), and on a loaded volume, component (`bind-component`) or DCC definition.
   */
  setInitialState(state: Record<string, any>): void;
}
