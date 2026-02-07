export { IFilterInfo, IBindingInfo, BindingType } from './binding/types.js';

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
  locale: string;
  debug: boolean;
  enableMustache: boolean;
}
