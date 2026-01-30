import { IStateAddress } from "../../address/types";
import { ISwapInfo } from "./types";

const swapInfoByStateAddress: WeakMap<IStateAddress, ISwapInfo> = new WeakMap();

export function getSwapInfoByAddress(address: IStateAddress): ISwapInfo | null {
  return swapInfoByStateAddress.get(address) ?? null;
}

export function setSwapInfoByAddress(address: IStateAddress, swapInfo: ISwapInfo | null): void {
  if (swapInfo === null) {
    swapInfoByStateAddress.delete(address);
  } else {
    swapInfoByStateAddress.set(address, swapInfo);
  }
}
