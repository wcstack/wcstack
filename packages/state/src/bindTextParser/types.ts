import { IBindingInfo } from "../types";

export type ParseBindTextResult = Pick<IBindingInfo,
  | 'propName'
  | 'propSegments'
  | 'propModifiers'
  | 'statePathName'
  | 'statePathInfo'
  | 'stateName'
  | 'filterTexts'
  | 'bindingType'
  | 'uuid'
>;