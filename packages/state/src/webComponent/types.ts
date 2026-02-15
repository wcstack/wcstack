import { IBindingInfo } from "../binding/types";
import { IStateElement } from "../components/types";
import { bindSymbol } from "./symbols";

export interface IInnerState extends Record<string, any> {
  [bindSymbol](binding: IBindingInfo): void;
}

export interface IOuterState extends Record<string, any> {
  [bindSymbol](innerStateElement: IStateElement, binding: IBindingInfo): void;
}

