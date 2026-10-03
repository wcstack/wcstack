import { define } from "./element";
import { installFeatures } from "./hooks";
import { ALL_FEATURES } from "./features/all";

// the auto bundle is the full engine: the core and every add-on
installFeatures(ALL_FEATURES);
define();
