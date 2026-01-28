import { IPathInfo } from "./address/types";
import { IStateElement } from "./components/types";

export interface IState {
  [key: string]: any;
} 

export interface ITagNames {
  state: string;
}

export interface IConfig {
  bindAttributeName: string;
  commentTextPrefix: string;
  commentForPrefix: string;
  commentIfPrefix: string;
  commentElseIfPrefix: string;
  commentElsePrefix: string;
  tagNames: ITagNames;
}

export type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else';

export interface IBindingInfo {
  readonly propName: string;
  readonly propSegments: string[];
  readonly propModifiers: string[];
  readonly statePathName: string;
  readonly statePathInfo: IPathInfo | null;
  readonly stateName: string;
  readonly filterTexts: string[];
  readonly node: Node; // raw node
  readonly placeHolderNode: Node; // replaced node or raw node
  readonly bindingType: BindingType;
  readonly uuid?: string | null; // for 'for', 'if', 'elseif', 'else' bindings
}

export interface ILoopContent {
  readonly firstNode: Node | null;
  readonly lastNode: Node | null;
  mountAfter(targetNode: Node): void;
  unmount(): void;
}