import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/websocket/server.js";

const exampleRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(exampleRoot, "../..");

createDemoServer({
  port: Number(process.env.PORT || 3300),
  staticRoot: repoRoot,
  defaultFile: "examples/state-websocket/index.html",
});
