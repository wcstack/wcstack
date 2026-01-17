import { ILoader } from "./types";
import { config } from "./config.js";

export function addLoader(key: string, loader: ILoader): void {
  config.loaders[key] = loader;
}
