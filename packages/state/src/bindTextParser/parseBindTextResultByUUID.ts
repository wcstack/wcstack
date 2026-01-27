import { ParseBindTextResult } from "./types.js";

const parseBindTextResultByUUID = new Map<string, ParseBindTextResult>();

export function getParseBindTextResultByUUID(uuid: string): ParseBindTextResult | null {
  return parseBindTextResultByUUID.get(uuid) || null;
}

export function setParseBindTextResultByUUID(uuid: string, parseBindTextResult: ParseBindTextResult | null): void {
  if (parseBindTextResult === null) {
    parseBindTextResultByUUID.delete(uuid);
  } else {
    parseBindTextResultByUUID.set(uuid, parseBindTextResult);
  }
}