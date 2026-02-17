interface IWritableTagNames {
    state?: string;
}
interface IWritableConfig {
    bindAttributeName?: string;
    commentTextPrefix?: string;
    commentForPrefix?: string;
    commentIfPrefix?: string;
    commentElseIfPrefix?: string;
    commentElsePrefix?: string;
    tagNames?: IWritableTagNames;
    locale?: string;
    debug?: boolean;
    enableMustache?: boolean;
}

declare function bootstrapState(config?: IWritableConfig): void;

export { bootstrapState };
export type { IWritableConfig, IWritableTagNames };
