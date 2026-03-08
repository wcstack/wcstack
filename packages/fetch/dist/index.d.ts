interface IWritableTagNames {
    fetch?: string;
    fetchHeader?: string;
    fetchBody?: string;
}
interface IWritableConfig {
    autoTrigger?: boolean;
    triggerAttribute?: string;
    tagNames?: IWritableTagNames;
}

declare function bootstrapFetch(userConfig?: IWritableConfig): void;

export { bootstrapFetch };
export type { IWritableConfig, IWritableTagNames };
