/**
 * updatedCallback.ts
 *
 * Utility function to invoke the StateClass lifecycle hook "$updatedCallback".
 *
 * Main responsibilities:
 * - Invokes $updatedCallback method if defined on the object (target)
 * - Callback is invoked with target's this context, passing IReadonlyStateProxy (receiver) as argument
 * - Executable as async function (await compatible)
 *
 * Design points:
 * - Safely retrieves $updatedCallback property using Reflect.get
 * - Does nothing if the callback doesn't exist
 * - Used for lifecycle management and update handling logic
 */

import { IAbsoluteStateAddress } from "../../address/types";
import { STATE_UPDATED_CALLBACK_NAME } from "../../define";
import { IStateHandler } from "../types";

/**
 * Invokes the $updatedCallback lifecycle hook if defined on the target.
 * Aggregates updated paths and their indexes before passing to the callback.
 * @param target - Target object to check for callback
 * @param refs - Array of state property references that were updated
 * @param receiver - State proxy to pass as this context
 * @param handler - State handler (unused but part of signature)
 * @returns Promise or void depending on callback implementation
 */
export function updatedCallback(
  target: object, 
  refs: IAbsoluteStateAddress[], 
  receiver: any,
  handler: IStateHandler
): unknown {
  const callback: unknown = Reflect.get(target, STATE_UPDATED_CALLBACK_NAME);
  if (typeof callback === "function") {
    const paths: Set<string> = new Set();
    // ToDo:現状では1階層のみのワイルドカードに対応。多階層対応は後回し
    const indexesByPath: Record<string, number[]> = {};
    for (const ref of refs) {
      const pathInfo = ref.absolutePathInfo.pathInfo;
      let pathName;
      if (ref.absolutePathInfo.stateName === handler.stateName) {
        pathName = pathInfo.path;
      } else {
        pathName = pathInfo.path + "@" + ref.absolutePathInfo.stateName;
      }
      paths.add(pathName);
      if (pathInfo.wildcardCount > 0) {
        const index = ref.listIndex!.index;
        const indexes = indexesByPath[pathName];
        if (typeof indexes === "undefined") {
          indexesByPath[pathName] = [index];
        } else {
          indexes.push(index);
        }
      }
    }
    return callback.call(receiver, Array.from(paths), indexesByPath);
  }
}