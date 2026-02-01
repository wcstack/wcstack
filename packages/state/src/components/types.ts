import { IStateAddress } from "../address/types";
import { ICacheEntry } from "../cache/types";
import { IListIndex, IListManager, ILoopContextStack } from "../list/types";
import { IStateProxy, Mutability } from "../proxy/types";
import { IBindingInfo, IState } from "../types";
import { IVersionInfo } from "../version/types";

export interface IStateElement {
  readonly name: string;
  readonly bindingInfosByAddress: Map<IStateAddress, IBindingInfo[]>;
  readonly initializePromise: Promise<void>;
  readonly listPaths: Set<string>;
  readonly elementPaths: Set<string>;
  readonly getterPaths: Set<string>;
  readonly setterPaths: Set<string>;
  readonly loopContextStack: ILoopContextStack;
  readonly cache: Map<IStateAddress, ICacheEntry>;
  readonly mightChangeByPath: Map<string, IVersionInfo>
  readonly dynamicDependency: Map<string, string[]>;
  readonly staticDependency: Map<string, string[]>;
  readonly version: number;
  addBindingInfo(bindingInfo: IBindingInfo): void;
  deleteBindingInfo(bindingInfo: IBindingInfo): void;
  addStaticDependency(parentPath: string, childPath: string): void;
  addDynamicDependency(fromPath: string, toPath: string): void;
  createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void>;
  createState(mutability: Mutability, callback: (state: IStateProxy) => void): void;
  nextVersion(): number;
}

