import { IContent } from "./types.js";

const fragmentByUUID: Map<string, DocumentFragment> = new Map();

export function getFragmentByUUID(uuid: string): DocumentFragment | null {
  return fragmentByUUID.get(uuid) || null;
}

export function setFragmentByUUID(uuid: string, fragment: DocumentFragment | null): void {
  if (fragment === null) {
    fragmentByUUID.delete(uuid);
  } else {
    fragmentByUUID.set(uuid, fragment);
  }
}