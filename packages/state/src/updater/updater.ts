import { IStateAddress } from "../address/types";

class Updater {
  private _version: number;
  private _revision: number;
  private _updateAddresses: IStateAddress[] = [];
  constructor(version: number) {
    this._version = version;
    this._revision = 0;
  }

  get version(): number {
    return this._version;
  }

  get revision(): number {
    return this._revision;
  }

  enqueueUpdateAddress(address: IStateAddress): void {
    this._updateAddresses.push(address);
    this._revision++;
  }
}

export function createUpdater(version: number): Updater {
  return new Updater(version);
}
