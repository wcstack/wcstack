import { define } from "./element";
import { installFormats } from "./filters/formats";

// the auto bundle is the full engine: core + the formatting filters
installFormats();
define();
