import { IAbsoluteStateAddress } from "../address/types";
import { ICacheEntry } from "./types";

const cacheEntryByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, ICacheEntry> = new WeakMap();

export function getCacheEntryByAbsoluteStateAddress(
  address: IAbsoluteStateAddress
): ICacheEntry | null {
  return cacheEntryByAbsoluteStateAddress.get(address) ?? null;
}

export function setCacheEntryByAbsoluteStateAddress(
  address: IAbsoluteStateAddress,
  cacheEntry: ICacheEntry | null
): void {
  if (cacheEntry === null) {
    cacheEntryByAbsoluteStateAddress.delete(address);
  } else {
    cacheEntryByAbsoluteStateAddress.set(address, cacheEntry);
  }
}