import { IStateAddress } from "../address/types";

export interface IUpdater {
  readonly version: number;
  readonly revision: number;
  enqueueUpdateAddress(address: IStateAddress): void;
}
