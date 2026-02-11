import { IAbsoluteStateAddress } from "../address/types";
import { ICacheEntry } from "./types";
export declare function getCacheEntryByAbsoluteStateAddress(address: IAbsoluteStateAddress): ICacheEntry | null;
export declare function setCacheEntryByAbsoluteStateAddress(address: IAbsoluteStateAddress, cacheEntry: ICacheEntry | null): void;
export declare function dirtyCacheEntryByAbsoluteStateAddress(address: IAbsoluteStateAddress): void;
//# sourceMappingURL=cacheEntryByAbsoluteStateAddress.d.ts.map