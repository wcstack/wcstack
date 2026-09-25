// Serves e2e/serve.mjs on PORT+1 and proxies PORT to it, answering the state bundle
// (/packages/state/dist/auto.min.js) with state-next's when STATE=next.
import { createServer, request } from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 4400);
const UPSTREAM = PORT + 1;
const e2e = process.env.E2E_DIR;
const next = process.env.STATE === "next";
const child = spawn(process.execPath, ["serve.mjs"], { cwd: e2e, env: { ...process.env, PORT: String(UPSTREAM) }, stdio: "inherit", windowsHide: true });
process.on("exit", () => child.kill());
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));

createServer((req, res) => {
  let path = req.url;
  if (next && path.startsWith("/packages/state/dist/auto.min.js")) path = "/packages/state-next/dist/auto.min.js";
  const up = request({ host: "127.0.0.1", port: UPSTREAM, path, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(PORT, "127.0.0.1");
