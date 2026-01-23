
export interface ITagNames {
  readonly route: string;
  readonly router: string;
  readonly outlet: string;
  readonly layout: string;
  readonly layoutOutlet: string;
  readonly link: string;
  readonly head: string;
}

export interface IWritableTagNames {
  route?: string;
  router?: string;
  outlet?: string;
  layout?: string;
  layoutOutlet?: string;
  link?: string;
  head?: string;
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

export interface IParamTypeInfo<T> {
  readonly typeName: string;
  readonly pattern: RegExp;
  parse(value: string): T | undefined;
}