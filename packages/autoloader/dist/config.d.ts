import { IConfig, IWritableConfig } from "./types.js";
import { load } from "./vanilla.js";
export declare const DEFAULT_KEY = "*";
export declare const VANILLA_KEY = "vanilla";
export declare const VANILLA_LOADER: {
    postfix: string;
    loader: typeof load;
};
export declare const config: IConfig;
export declare function getConfig(): IConfig;
export declare function setConfig(partialConfig: IWritableConfig): void;
//# sourceMappingURL=config.d.ts.map