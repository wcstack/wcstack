import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/server.js";

const exampleRoot = fileURLToPath(new URL(".", import.meta.url));
const chatRoot = resolve(exampleRoot, "..");

createDemoServer({
  port: Number(process.env.PORT || 3305),
  staticRoot: chatRoot,
  defaultFile: "signals/index.html",
});
