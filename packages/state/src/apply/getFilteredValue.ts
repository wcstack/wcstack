import { IFilterInfo } from "../binding/types.js";

export function getFilteredValue(value: any, filters: IFilterInfo[]) {
  let filteredValue = value;
  for(const filter of filters) {
    filteredValue = filter.filterFn(filteredValue);
  }
  return filteredValue;
}
