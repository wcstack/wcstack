import { IBindingInfo } from "../binding/types";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { setLoopContextSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { bindSymbol } from "./symbols";
import { IInnerState } from "./types";

const getterFn = (
  binding: IBindingInfo,
) => {
  const rootNode = binding.replaceNode.getRootNode() as Node;
  const outerStateElement = getStateElementByName(rootNode, binding.stateName);
  if (outerStateElement === null) {
    raiseError(`State element with name "${binding.stateName}" not found for binding.`);
  }
  const outerName = binding.statePathName;
  return () => {
    let value = undefined;
    const loopContext = getLoopContextByNode(binding.node);
    outerStateElement.createState("readonly", (state) => {
      state[setLoopContextSymbol](loopContext, () => {
        value = state[outerName];
      });
    });
    return value;
  }
}

const setterFn = (
  binding: IBindingInfo,
) => {
  const rootNode = binding.replaceNode.getRootNode() as Node;
  const outerStateElement = getStateElementByName(rootNode, binding.stateName);
  if (outerStateElement === null) {
    raiseError(`State element with name "${binding.stateName}" not found for binding.`);
  }
  const outerName = binding.statePathName;
  return (v: any) => {
    const loopContext = getLoopContextByNode(binding.node);
    outerStateElement.createState("writable", (state) => {
      state[setLoopContextSymbol](loopContext, () => {
        state[outerName] = v;
      });
    });
  }
}

class InnerState implements IInnerState {
  constructor() {
  }

  [bindSymbol](binding: IBindingInfo): void {
    const innerName = binding.propSegments.slice(1).join('.');
    Object.defineProperty(this, innerName, {
      get: getterFn(binding),
      set: setterFn(binding),
      enumerable: true,
      configurable: true,
    });
  }
}

export function createInnerState(): IInnerState {
  return new InnerState();
}