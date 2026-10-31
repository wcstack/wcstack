import { define } from "./element";
import { installFeatures } from "./hooks";
import { ALL_FEATURES } from "./features/all";
import { defineOnce } from "./twice";

// the auto bundle is the full engine: the core and every add-on
installFeatures(ALL_FEATURES);
// and says when another copy of @wcstack/state defined the tags first (src/twice.ts)
defineOnce(() => define());
