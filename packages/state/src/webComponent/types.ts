import { IStateElement } from "../components/types";

export interface IInnerState extends Record<string, any> {
  $$bindName(outerStateElement:IStateElement, innerName: string, outerName: string): void;
}

export interface IOuterState extends Record<string, any> {
  $$bindName(innerStateElement:IStateElement, innerName: string): void;
}

export interface IMappingRule {
  innerName: string;
  outerName: string;
}