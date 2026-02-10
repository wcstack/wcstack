import { IBindingInfo } from "../binding/types";
import { IStateElement } from "../components/types";

export interface IInnerState extends Record<string, any> {
  $$bind(binding: IBindingInfo): void;
}

export interface IOuterState extends Record<string, any> {
  $$bind(innerStateElement: IStateElement, binding: IBindingInfo): void;
}

export interface IMappingRule {
  innerName: string;
  outerName: string;
}