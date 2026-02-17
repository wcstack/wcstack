export { IFilterInfo, IBindingInfo, BindingType } from './binding/types.js';

export interface IState {
  [key: string]: any;
} 

export interface ITagNames {
  readonly state: string;
}

export interface IWritableTagNames {
  state?: string;
}

export interface IConfig {
  readonly bindAttributeName: string;
  readonly commentTextPrefix: string;
  readonly commentForPrefix: string;
  readonly commentIfPrefix: string;
  readonly commentElseIfPrefix: string;
  readonly commentElsePrefix: string;
  readonly tagNames: ITagNames;
  readonly locale: string;
  readonly debug: boolean;
  readonly enableMustache: boolean;
}

export interface IWritableConfig {
  bindAttributeName?: string;
  commentTextPrefix?: string;
  commentForPrefix?: string;
  commentIfPrefix?: string;
  commentElseIfPrefix?: string;
  commentElsePrefix?: string;
  tagNames?: IWritableTagNames;
  locale?: string;
  debug?: boolean;
  enableMustache?: boolean;
}
