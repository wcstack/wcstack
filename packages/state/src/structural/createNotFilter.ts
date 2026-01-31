import { builtinFilterFn, outputBuiltinFilters } from "../filters/builtinFilters";
import { IFilterInfo } from "../types";

let _notFilterInfo: IFilterInfo | undefined = undefined;

export function createNotFilter(): IFilterInfo {
  if (_notFilterInfo) {
    return _notFilterInfo;
  }
  const filterName = "not"
  const args: string[] = [];
  const filterFn = builtinFilterFn(filterName, args)(outputBuiltinFilters);
  _notFilterInfo = {
    filterName,
    args,
    filterFn,
  }
  return _notFilterInfo;
}
