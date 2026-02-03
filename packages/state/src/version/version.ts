import { IVersionInfo } from "./types";

let versionCounter = 0;

export function getNextVersion(): IVersionInfo {
  versionCounter++;
  return {
    version: versionCounter,
    revision: 0,
  };
}
