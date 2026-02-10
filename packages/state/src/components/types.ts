import { ILoopContextStack } from "../list/types";
import { IStateProxy, Mutability } from "../proxy/types";
import { BindingType } from "../types";

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
  setPathInfo(path: string, bindingType: BindingType): void;
  addStaticDependency(parentPath: string, childPath: string): boolean;
  addDynamicDependency(fromPath: string, toPath: string): boolean;
  createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void>;
  createState(mutability: Mutability, callback: (state: IStateProxy) => void): void;
  nextVersion(): number;
  bindWebComponent(component: Element): Promise<void>;
  bindProperty(prop: string, desc: PropertyDescriptor): void;
  setInitialState(state: Record<string, any>): void;
}

