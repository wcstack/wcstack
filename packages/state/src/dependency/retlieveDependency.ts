import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { IPathInfo, IStateAddress } from "../address/types";
import { WILDCARD } from "../define";
import { createListDiff } from "../list/createListDiff";
import { getListIndexesByList } from "../list/listIndexesByList";
import { IListIndex } from "../list/types";
import { getListIndex } from "../proxy/methods/getListIndex";
import { IStateProxy } from "../proxy/types";
import { raiseError } from "../raiseError";
import { IState } from "../types";

const lastValueByListAddress = new WeakMap<IStateAddress, any>();

type Context = {
  readonly staticMap: Map<string, string[]>,
  readonly dynamicMap: Map<string, string[]>, 
  readonly result: Set<IStateAddress>,
  readonly listPathSet: Set<string>,
  readonly visited: Set<string>,
  readonly stateProxy: IStateProxy,
  readonly newValueByAddress: Map<IStateAddress, any>
}

type ExpandContext2 = {
  wildcardPaths: string[],
  wildcardParentPaths: string[],
  currentWildcardIndex: number,
  listIndexes: IListIndex[]
}

function _walkDependency(
  context: Context,
  address: IStateAddress, 
): void {
  const sourcePath = address.pathInfo.path;
  if (context.visited.has(sourcePath)) {
    return;
  }
  context.visited.add(sourcePath);
  const staticDeps = context.staticMap.get(sourcePath);
  if (staticDeps) {
    for(const dep of staticDeps) {
      const depPathInfo = getPathInfo(dep);
      if (context.listPathSet.has(sourcePath) && depPathInfo.lastSegment === WILDCARD) {
        //expand indexes
        const newValue = context.stateProxy.$$getByAddress(address);
        const lastValue = lastValueByListAddress.get(address);
        const lastIndexes = getListIndexesByList(lastValue) || [];
        const listDiff = createListDiff(address.listIndex, lastValue, newValue, lastIndexes);
        for(const listIndex of listDiff.newIndexes) {
          const depAddress = createStateAddress(depPathInfo, listIndex);
          context.result.add(depAddress);
          _walkDependency(context, depAddress);
        }
        context.newValueByAddress.set(address, newValue);
      } else {
        const depAddress = createStateAddress(depPathInfo, address.listIndex);
        context.result.add(depAddress);
        _walkDependency(context, depAddress);
      }
    }
  }
  const dynamicDeps = context.dynamicMap.get(sourcePath);
  if (dynamicDeps) {
    for(const dep of dynamicDeps) {
      const depPathInfo = getPathInfo(dep);
      const listIndexes = [];
      if (depPathInfo.wildcardCount > 0) {
        const wildCardPathSet = address.pathInfo.wildcardPathSet;
        const depWidcardPathSet = depPathInfo.wildcardPathSet;
        const matchingWildcards = wildCardPathSet.intersection(depWidcardPathSet);
        const wildcardLen = matchingWildcards.size;
        const expandable = (depPathInfo.wildcardCount - wildcardLen) >= 1;
        const carryover = wildcardLen > 0;
        if (expandable) {
          const listIndex = address.listIndex!.at(wildcardLen - 1);
        } else if (carryover) {
          const listIndex = address.listIndex!.at(wildcardLen - 1);
          listIndexes.push(listIndex);
        } else {
          listIndexes.push(null);
        }
      } else {
        listIndexes.push(null);
      }
      for(const listIndex of listIndexes) {
        const depAddress = createStateAddress(depPathInfo, listIndex);
        context.result.add(depAddress);
        _walkDependency(context, depAddress);
      }
    }
  }
}

type ExpandContext = {
  targetPathInfo: IPathInfo,
  targetListIndexes: IListIndex[],
  wildcardPaths: string[],
  wildcardParentPaths: string[],
  stateProxy: IStateProxy,
}


function _walkExpandWildcard(
  context: ExpandContext, 
  currentWildcardIndex: number,
  parentListIndex: IListIndex | null
): void {
  if (currentWildcardIndex >= context.wildcardPaths.length) {
    return;
  }
  const parentPath = context.wildcardParentPaths[currentWildcardIndex];
  const parentPathInfo = getPathInfo(parentPath);
  const parentAddress = createStateAddress(parentPathInfo, parentListIndex);
  const lastValue = lastValueByListAddress.get(parentAddress);
  const lastIndexes = getListIndexesByList(lastValue) || [];
  const newValue = context.stateProxy.$$getByAddress(parentAddress);
  const listDiff = createListDiff(parentAddress.listIndex, lastValue, newValue, lastIndexes);
  if (currentWildcardIndex === context.wildcardPaths.length - 1) {
    context.targetListIndexes.push(...listDiff.newIndexes);
  } else {
    for(const listIndex of listDiff.newIndexes) {
      _walkExpandWildcard(
        context,
        currentWildcardIndex + 1,
        listIndex
      );
    }
  }
}

export function retrieveDependency(
  startAddress: IStateAddress,
  staticDependency: Map<string, string[]>,
  dynamicDependency: Map<string, string[]>,
  listPathSet: Set<string>,
  stateProxy: IStateProxy
): IStateAddress[] {
  const context: Context = {
    staticMap: staticDependency,
    dynamicMap: dynamicDependency,
    result: new Set<IStateAddress>(),
    listPathSet: listPathSet,
    visited: new Set<string>(),
    stateProxy: stateProxy,
    newValueByAddress: new Map<IStateAddress, any>()
  };
  _walkDependency(context, startAddress);
  for(const [address, newValue] of context.newValueByAddress.entries()) {
    lastValueByListAddress.set(address, newValue);
  }
  return Array.from(context.result);
}
