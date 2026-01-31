import { IStateAddress } from "../address/types";
import { applyChange } from "../apply/applyChange";
import { IStateElement } from "../components/types";
import { get } from "../proxy/traps/get";
import { IStateProxy } from "../proxy/types";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo } from "../types";
import { IVersionInfo } from "../version/types";

interface IApplyInfo {
  bindingInfo: IBindingInfo;
  value: any;
}

class Updater {
  private _stateName: string;
  private _versionInfo: IVersionInfo;
  private _updateAddresses: IStateAddress[] = [];
  private _state: IStateProxy;
  private _applyPromise: Promise<void> | null = null;
  private _applyResolve: (() => void) | null = null;
  private _stateElement: IStateElement;
  constructor(stateName: string, state:IStateProxy, version: number) {
    this._versionInfo = {
      version: version,
      revision: 0,
    };
    this._stateName = stateName;
    this._state = state;
    this._stateElement = getStateElementByName(this._stateName) ?? raiseError(`Updater: State element with name "${this._stateName}" not found.`);
  }

  get versionInfo(): IVersionInfo {
    return this._versionInfo;
  }

  enqueueUpdateAddress(address: IStateAddress): void {
    const stateElement = this._stateElement;
    this._updateAddresses.push(address);
    this._versionInfo.revision++;
    stateElement.mightChangeByPath.set(address.pathInfo.path, {
      version: this._versionInfo.version,
      revision: this._versionInfo.revision,
    });

    if (this._applyPromise !== null) {
      return;
    }
    this._applyPromise = new Promise<void>((resolve) => {
      this._applyResolve = resolve;
    });
    queueMicrotask(() => {
      this._processUpdates();
    });
  }
  private _processUpdates(): void {
    const stateElement = this._stateElement;
    const addressSet = new Set(this._updateAddresses);
    this._updateAddresses.length = 0;
    const applyList: IApplyInfo[] = [];
    for(const address of addressSet) {
      const value = this._state.$$getByAddress(address);
      const bindingInfos = stateElement.bindingInfosByAddress.get(address);
      if (typeof bindingInfos === "undefined") {
        continue;
      }
      for(const bindingInfo of bindingInfos) {
        applyList.push({
          bindingInfo,
          value,
        });
      }
    }

    for(const applyInfo of applyList) {
      const { bindingInfo, value } = applyInfo;
      applyChange(bindingInfo, value);
    }
    if (this._applyResolve !== null) {
      this._applyResolve();
      this._applyResolve = null;
      this._applyPromise = null;
    }
  }

}

export function createUpdater(stateName: string, state: IStateProxy, version: number): Updater {
  return new Updater(stateName, state, version);
}
