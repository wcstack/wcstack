type LoaderFunction = (path: string) => Promise<CustomElementConstructor | null>;
interface ILoader {
    readonly postfix: string;
    readonly loader: LoaderFunction;
}
interface IWritableTagNames {
    autoloader?: string;
}
interface IWritableConfig {
    scanImportmap?: boolean;
    loaders?: Record<string, ILoader | string>;
    observable?: boolean;
    tagNames?: IWritableTagNames;
}

declare function bootstrapAutoloader(config?: IWritableConfig): void;

export { bootstrapAutoloader };
export type { ILoader, IWritableConfig, IWritableTagNames, LoaderFunction };
