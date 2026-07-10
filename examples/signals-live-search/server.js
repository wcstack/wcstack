import { fileURLToPath } from "node:url";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const people = [
  { id: 1, name: "Ada Lovelace", role: "admin" },
  { id: 2, name: "Linus Torvalds", role: "editor" },
  { id: 3, name: "Grace Hopper", role: "admin" },
  { id: 4, name: "Alan Turing", role: "viewer" },
  { id: 5, name: "Margaret Hamilton", role: "editor" },
  { id: 6, name: "Dennis Ritchie", role: "editor" },
  { id: 7, name: "Barbara Liskov", role: "admin" },
  { id: 8, name: "Tim Berners-Lee", role: "viewer" },
  { id: 9, name: "Katherine Johnson", role: "viewer" },
  { id: 10, name: "Donald Knuth", role: "editor" },
];

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    if (url.pathname === "/api/people" && req.method === "GET") {
      await delay(300); // simulate latency
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const filtered = q
        ? people.filter((p) => p.name.toLowerCase().includes(q))
        : people;
      jsonResponse(res, filtered);
      return true;
    }
    return false;
  },
});
