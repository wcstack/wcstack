type LoaderFunction = (path: string) => Promise<CustomElementConstructor | null>;
interface ILoader {
    readonly postfix: string;
    readonly loader: LoaderFunction;
}
interface IWritableConfig {
    scanImportmap?: boolean;
    loaders?: Record<string, ILoader | string>;
    observable?: boolean;
}

declare function bootstrapAutoloader(config?: Partial<IWritableConfig>): Promise<void>;

export { bootstrapAutoloader };
export type { ILoader, IWritableConfig, LoaderFunction };
