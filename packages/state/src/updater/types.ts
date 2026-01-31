import { IStateAddress } from "../address/types";
import { IVersionInfo } from "../version/types";

export interface IUpdater {
  readonly versionInfo: IVersionInfo;
  enqueueUpdateAddress(address: IStateAddress): void;
}
