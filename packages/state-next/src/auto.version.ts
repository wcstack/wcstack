// The spike's version (pull-validation) strategy, kept for the record: the dirty strategy
// was chosen (docs/state-engine-rewrite/spike-results.ja.md §2).
import { configure, define } from "./element";
import { VersionStrategy } from "./strategy/version";

configure(() => new VersionStrategy());
define();
