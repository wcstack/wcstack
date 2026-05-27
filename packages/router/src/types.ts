
export interface ITagNames {
  readonly route: string;
  readonly router: string;
  readonly outlet: string;
  readonly layout: string;
  readonly layoutOutlet: string;
  readonly link: string;
  readonly head: string;
  readonly guardHandler: string;
}

export interface IWritableTagNames {
  route?: string;
  router?: string;
  outlet?: string;
  layout?: string;
  layoutOutlet?: string;
  link?: string;
  head?: string;
  guardHandler?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
  readonly enableShadowRoot: boolean;
  readonly basenameFileExtensions: ReadonlyArray<string>;
}

export interface IWritableConfig {
  tagNames?: IWritableTagNames;
  enableShadowRoot?: boolean;
  basenameFileExtensions?: string[];
}

export interface IGuardCancel {
  fallbackPath: string;
}

export type BuiltinParamTypes = "int" | "float" | "bool" | "uuid" | "slug" | "isoDate" | "any";

// wc-bindable protocol (@wc-bindable/core v1) for custom element binding.
// properties:  bidirectional — element dispatches events on change, framework subscribes
// inputs:      one-way framework→element — optional `attribute` mirrors the property to that attribute
// commands:    framework invokes the element's method by name (subscribe via pub/sub token)
export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
}

export interface IWcBindableInput {
  readonly name: string;
  readonly attribute?: string;
}

export interface IWcBindableCommand {
  readonly name: string;
  readonly async?: boolean;
}

export interface IWcBindable {
  readonly protocol: "wc-bindable";
  readonly version: 1;
  readonly properties: IWcBindableProperty[];
  readonly inputs?: readonly IWcBindableInput[];
  readonly commands?: readonly IWcBindableCommand[];
}

export interface IParamTypeInfo<T> {
  readonly typeName: string;
  readonly pattern: RegExp;
  parse(value: string): T | undefined;
}