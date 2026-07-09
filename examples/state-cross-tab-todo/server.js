import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Static-only server. This demo has NO backend: the todo list lives in
// localStorage (<wcs-storage>) and cross-tab signals ride BroadcastChannel
// (<wcs-broadcast>) — both are pure browser APIs. The server only needs to hand
// out index.html over http:// so ES modules and a shared storage origin work
// (file:// would break both). Open http://localhost:3000 in two tabs.
createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  notes: ["Open it in TWO tabs to see cross-tab sync."],
});
