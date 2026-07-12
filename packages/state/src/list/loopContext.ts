import { IStateAddress } from "../address/types";
import { MAX_LOOP_DEPTH } from "../define";
import { raiseError } from "../raiseError";
import { ILoopContext, ILoopContextStack } from "./types";

type LoopContextCallback<T> = (loopContext: ILoopContext) => T | Promise<T>;

class LoopContextStack {
  private _loopContextStack: (ILoopContext | undefined)[] = Array(MAX_LOOP_DEPTH).fill(undefined);
  private _length: number = 0;

  createLoopContext(
    elementStateAddress: IStateAddress,
    callback: LoopContextCallback<void>
  ): void | Promise<void> {
    if (elementStateAddress.listIndex === null) {
      raiseError(`Cannot create loop context for a state address that does not have a list index.`);
    }
    const loopContext = elementStateAddress as ILoopContext;
    if (this._length >= MAX_LOOP_DEPTH) {
      raiseError(`Exceeded maximum loop context stack depth of ${MAX_LOOP_DEPTH}. Possible infinite loop.`);
    }
    const lastLoopContext = this._loopContextStack[this._length - 1];
    if (typeof lastLoopContext !== "undefined" ) {
      if (lastLoopContext.pathInfo.wildcardCount + 1 !== loopContext.pathInfo.wildcardCount) {
        raiseError(`Cannot push loop context for a list whose wildcard count is not exactly one more than the current active loop context.`);
      }
      // 
      const prevWildcardPathInfo = loopContext.pathInfo.wildcardPathInfos[loopContext.pathInfo.wildcardPathInfos.length - 2];
      if (lastLoopContext.pathInfo !== prevWildcardPathInfo) {
        raiseError(`Cannot push loop context for a list whose parent wildcard path info does not match the current active loop context.`);
      }
    } else {
      // With no active loop context the address must be self-contained: the
      // listIndex chain supplies one index per wildcard. Top-level lists
      // (wildcardCount 1) always satisfy this. A nested list re-rendered
      // directly (e.g. replaced via $resolve from outside the loop) also
      // satisfies it — the for binding's listIndex carries the full ancestor
      // chain.
      if (loopContext.listIndex.length !== loopContext.pathInfo.wildcardCount) {
        raiseError(`Cannot push loop context when there is no active loop context: the list index chain (length ${loopContext.listIndex.length}) does not cover the wildcard path (wildcard count ${loopContext.pathInfo.wildcardCount}).`);
      }
    }
    this._loopContextStack[this._length] = loopContext;
    this._length++;
    let retValue : void | Promise<void> = void 0;
    try {
      retValue = callback(loopContext);
    } finally {
      if (retValue instanceof Promise) {
        retValue.finally(() => {
          this._length--;
          this._loopContextStack[this._length] = undefined;
        });
      } else {
        this._length--;
        this._loopContextStack[this._length] = undefined;
      }
    }
    return retValue;
  }  
}

export function createLoopContextStack(): ILoopContextStack {
  return new LoopContextStack();
}

