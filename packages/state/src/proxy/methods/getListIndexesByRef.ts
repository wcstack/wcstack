import { IListIndex } from "../../ListIndex/types";
import { IStatePropertyRef } from "../../StatePropertyRef/types";
import { raiseError } from "../../utils";
import { get } from "../traps/get";
import { IStateHandler, IStateProxy } from "../_types";
import { getByRef } from "./getByAddress";

export function getListIndexesByRef(
  target   : Object, 
  ref      : IStatePropertyRef,
  receiver : IStateProxy,
  handler  : IStateHandler
 
): IListIndex[] {
  if (!handler.engine.pathManager.lists.has(ref.info.pattern)) {
    raiseError({
      code: 'LIST-201',
      message: `path is not a list: ${ref.info.pattern}`,
      context: { where: 'getListIndexesByRef', pattern: ref.info.pattern },
      docsUrl: '/docs/error-codes.md#state',
    });
  }
  if (handler.engine.stateOutput.startsWith(ref.info) && handler.engine.pathManager.getters.intersection(ref.info.cumulativePathSet).size === 0) {
    return handler.engine.stateOutput.getListIndexes(ref) ?? [];
  }

  getByRef(target, ref, receiver, handler); // キャッシュ更新を兼ねる
  const cacheEntry = handler.engine.getCacheEntry(ref);
  if (cacheEntry === null) {
    raiseError({
      code: 'LIST-202',
      message: `List cache entry not found: ${ref.info.pattern}`,
      context: { where: 'getListIndexesByRef', pattern: ref.info.pattern },
      docsUrl: '/docs/error-codes.md#state',
    });
  }

  const listIndexes = cacheEntry.listIndexes;
  if (listIndexes == null) {
    raiseError({
      code: 'LIST-203',
      message: `List indexes not found in cache entry: ${ref.info.pattern}`,
      context: { where: 'getListIndexesByRef', pattern: ref.info.pattern },
      docsUrl: '/docs/error-codes.md#state',
    });
  }

  return listIndexes;
}