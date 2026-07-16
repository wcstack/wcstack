import { IStateAddress } from "../../address/types";
import { WILDCARD } from "../../define";
import { IStateHandler } from "../types";
import { getByAddress } from "./getByAddress";

/**
 * Reports whether an address has been initialized, independently of its value.
 * In particular, an own slot containing `undefined` is initialized while a
 * missing slot is not.
 */
export function hasByAddress(
  target: object,
  address: IStateAddress,
  receiver: unknown,
  handler: IStateHandler,
): boolean {
  if (address.pathInfo.path in target) return true;
  const parentAddress = address.parentAddress;
  if (parentAddress === null) return false;
  const parentValue = getByAddress(target, parentAddress, receiver, handler);
  if (parentValue === null || (typeof parentValue !== "object" && typeof parentValue !== "function")) {
    return false;
  }
  const lastSegment = address.pathInfo.lastSegment;
  if (lastSegment === WILDCARD) {
    const index = address.listIndex?.index;
    return typeof index === "number" && index in parentValue;
  }
  return lastSegment in parentValue;
}
