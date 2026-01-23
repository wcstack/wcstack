interface IWritableTagNames {
    route?: string;
    router?: string;
    outlet?: string;
    layout?: string;
    layoutOutlet?: string;
    link?: string;
    head?: string;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
    enableShadowRoot?: boolean;
    basenameFileExtensions?: string[];
}

/**
 * Initialize the router with optional configuration.
 * This is the main entry point for setting up the router.
 * @param config - Optional partial configuration to override defaults
 */
declare function bootstrapRouter(config?: Partial<IWritableConfig>): void;

export { bootstrapRouter };
export type { IWritableConfig, IWritableTagNames };
