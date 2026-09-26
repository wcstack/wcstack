/**
 * Every add-on: what `@wcstack/state` (`bootstrapState`) and the auto bundle install. A page
 * that installs only some imports `@wcstack/state/core` and `features/<name>` instead.
 */
import type { Feature } from "../hooks";
import { formats } from "./formats";
import { diagnostics } from "./diagnostics";
import { temporal } from "./temporal";
import { listKeys } from "./list-keys";
import { scopes } from "./scopes";
import { recursion } from "./recursion";
import { ssr } from "./ssr";
import { devtools } from "./devtools";

export const ALL_FEATURES: readonly Feature[] = [formats, diagnostics, temporal, listKeys, scopes, recursion, ssr, devtools];
