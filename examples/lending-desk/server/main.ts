// The API server. `API_PORT` (default 3001).
import { createServer } from "node:http";
import { Api } from "./api.ts";

const port = Number(process.env.API_PORT ?? 3001);
const api = new Api();
const server = createServer((req, res) => {
  if (!(req.url ?? "").startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("API only");
    return;
  }
  void api.handle(req, res);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`API on http://127.0.0.1:${port}/api/ (pid ${process.pid})`);
});
