import { IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { IStateProxy } from "../proxy/types";
import { SearchType } from "./types";
export declare function walkDependency(stateName: string, stateElement: IStateElement, startAddress: IStateAddress, staticDependency: Map<string, string[]>, dynamicDependency: Map<string, string[]>, listPathSet: Set<string>, stateProxy: IStateProxy, searchType: SearchType, callback: (address: IStateAddress) => void): IStateAddress[];
//# sourceMappingURL=walkDependency.d.ts.map