import { IFragmentInfo } from "./types";

const fragmentInfoByUUID = new Map<string, IFragmentInfo>();

export function setFragmentInfoByUUID(uuid: string, fragmentInfo: IFragmentInfo | null): void {
  if (fragmentInfo === null) {
    fragmentInfoByUUID.delete(uuid);
  } else {
    fragmentInfoByUUID.set(uuid, fragmentInfo);
  }
}

export function getFragmentInfoByUUID(uuid: string): IFragmentInfo | null {
  return fragmentInfoByUUID.get(uuid) || null;
}