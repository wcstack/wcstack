import { define } from "./element";
import { installFeatures } from "./hooks";
import { formats } from "./features/formats";
import { diagnostics } from "./features/diagnostics";
import { temporal } from "./features/temporal";
import { listKeys } from "./features/list-keys";
import { scopes } from "./features/scopes";
import { recursion } from "./features/recursion";

// the auto bundle is the full engine: the core and every add-on
installFeatures([formats, diagnostics, temporal, listKeys, scopes, recursion]);
define();
