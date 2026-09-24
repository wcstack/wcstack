// EXPERIMENT: the auto bundle with delegated row events (config.delegateEvents).
import { config } from "./config";
import { define } from "./element";
import { installFormats } from "./filters/formats";

config.delegateEvents = true;
installFormats();
define();
