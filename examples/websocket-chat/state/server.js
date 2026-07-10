import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/server.js";

const exampleRoot = fileURLToPath(new URL(".", import.meta.url));
const chatRoot = resolve(exampleRoot, "..");

createDemoServer({
  port: Number(process.env.PORT || 3300),
  staticRoot: chatRoot,
  defaultFile: "state/index.html",
});
