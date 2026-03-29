type LoaderFunction = (path: string) => Promise<CustomElementConstructor | null>;
interface ILoader {
    readonly postfix: string;
    readonly loader: LoaderFunction;
}
interface ITagNames {
    readonly autoloader: string;
}
interface IWritableTagNames {
    autoloader?: string;
}
interface IConfig {
    readonly scanImportmap: boolean;
    readonly loaders: Record<string, ILoader | string>;
    readonly observable: boolean;
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    scanImportmap?: boolean;
    loaders?: Record<string, ILoader | string>;
    observable?: boolean;
    tagNames?: IWritableTagNames;
}

declare function bootstrapAutoloader(config?: IWritableConfig): void;

declare function getConfig(): IConfig;

export { bootstrapAutoloader, getConfig };
export type { ILoader, IWritableConfig, IWritableTagNames, LoaderFunction };
