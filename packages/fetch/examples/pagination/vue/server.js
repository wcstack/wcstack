import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPaginationServer } from "../shared/server.js";

const distDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "dist");

createPaginationServer({
  port: Number(process.env.PORT || 3405),
  staticRoot: distDir,
  spaFallback: true,
});
