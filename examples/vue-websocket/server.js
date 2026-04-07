import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/websocket/server.js";

const distDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "dist");

createDemoServer({
  port: Number(process.env.PORT || 3302),
  staticRoot: distDir,
  spaFallback: true,
});
