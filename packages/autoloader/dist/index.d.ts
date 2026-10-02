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
    /** @deprecated Read nowhere: it has no effect. Removed in 4.0, where passing it throws. */
    readonly scanImportmap: boolean;
    readonly loaders: Record<string, ILoader | string>;
    readonly observable: boolean;
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    /** @deprecated Read nowhere: it has no effect. Removed in 4.0, where passing it throws. */
    scanImportmap?: boolean;
    loaders?: Record<string, ILoader | string>;
    observable?: boolean;
    tagNames?: IWritableTagNames;
}

declare function bootstrapAutoloader(config?: IWritableConfig, registry?: CustomElementRegistry): void;

declare function getConfig(): IConfig;

export { bootstrapAutoloader, getConfig };
export type { ILoader, IWritableConfig, IWritableTagNames, LoaderFunction };
