import { ILoopContextStack } from "../list/types";
import { IStateProxy, Mutability } from "../proxy/types";
import { IBindingInfo } from "../types";
export interface IStateElement {
    readonly name: string;
    readonly initializePromise: Promise<void>;
    readonly listPaths: Set<string>;
    readonly elementPaths: Set<string>;
    readonly getterPaths: Set<string>;
    readonly setterPaths: Set<string>;
    readonly loopContextStack: ILoopContextStack;
    readonly dynamicDependency: Map<string, string[]>;
    readonly staticDependency: Map<string, string[]>;
    readonly version: number;
    setBindingInfo(bindingInfo: IBindingInfo): void;
    addStaticDependency(parentPath: string, childPath: string): void;
    addDynamicDependency(fromPath: string, toPath: string): void;
    createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void>;
    createState(mutability: Mutability, callback: (state: IStateProxy) => void): void;
    nextVersion(): number;
}
//# sourceMappingURL=types.d.ts.map