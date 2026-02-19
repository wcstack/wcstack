
export type LoaderFunction = (path: string) => Promise<CustomElementConstructor | null>;

export interface ILoader {
  readonly postfix: string;
  readonly loader: LoaderFunction;
}

export interface ITagNames {
  readonly autoloader: string;
}

export interface IWritableTagNames {
  autoloader?: string;
}

export interface IConfig {
  readonly scanImportmap: boolean;
  readonly loaders: Record<string, ILoader | string>;
  readonly observable: boolean;
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  scanImportmap?: boolean;
  loaders?: Record<string, ILoader | string>;
  observable?: boolean;
  tagNames?: IWritableTagNames;
}

export interface IImportMap { 
  imports: Record<string, string>
};

export interface IPrefixMap {
  [key: string]: INameSpaceInfo;
}

export interface ILoadMap {
  [key: string]: IEagerLoadInfo;
}

export interface INameSpaceInfo {
  key: string;
  prefix: string;
  loaderKey: string | null;
}

export interface IEagerLoadInfo {
  key: string;
  tagName: string;
  loaderKey: string | null;
  extends: string | null;
}

export type IKeyInfo =
  | (INameSpaceInfo & { isNameSpaced: true })
  | (IEagerLoadInfo & { isNameSpaced: false });

export interface ITagInfo {
  name: string;
  extends: string | null;
}
