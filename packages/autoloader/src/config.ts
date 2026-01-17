
import { IConfig } from "./types.js"
import { load } from "./vanilla.js"

export const DEFAULT_KEY = "*";

export const VANILLA_KEY = "vanilla";

export const VANILLA_LOADER = {
  postfix: ".js",
  loader: load
}

const DEFAULT_CONFIG: IConfig = {
  scanImportmap: true,
  loaders: {
    [VANILLA_KEY]: VANILLA_LOADER,
    [DEFAULT_KEY]: VANILLA_KEY
  },
  observable: true
}

export const config = DEFAULT_CONFIG;