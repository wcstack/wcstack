declare function registerHandler(): Promise<void>;

type LoaderFunction = (path: string) => Promise<CustomElementConstructor | null>;
interface ILoader {
    postfix: string;
    loader: LoaderFunction;
}
interface IConfig {
    scanImportmap: boolean;
    loaders: Record<string, ILoader | string>;
    observable: boolean;
}
interface IImportMap {
    imports: Record<string, string>;
}
interface IPrefixMap {
    [key: string]: INameSpaceInfo;
}
interface ILoadMap {
    [key: string]: IEagerLoadInfo;
}
interface INameSpaceInfo {
    key: string;
    prefix: string;
    loaderKey: string | null;
}
interface IEagerLoadInfo {
    key: string;
    tagName: string;
    loaderKey: string | null;
    extends: string | null;
}
type IKeyInfo = (INameSpaceInfo & {
    isNameSpaced: true;
}) | (IEagerLoadInfo & {
    isNameSpaced: false;
});
interface ITagInfo {
    name: string;
    extends: string | null;
}

declare function addLoader(key: string, loader: ILoader): void;

declare function load(path: string): Promise<CustomElementConstructor>;

declare const DEFAULT_KEY = "*";
declare const VANILLA_KEY = "vanilla";
declare const VANILLA_LOADER: {
    postfix: string;
    loader: typeof load;
};
declare const config: IConfig;

export { DEFAULT_KEY, VANILLA_KEY, VANILLA_LOADER, addLoader, config, registerHandler };
export type { IConfig, IEagerLoadInfo, IImportMap, IKeyInfo, ILoadMap, ILoader, INameSpaceInfo, IPrefixMap, ITagInfo, LoaderFunction };
