import { fileURLToPath } from "node:url";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Mock product catalog
const products = [
  { id: 1, name: "Mechanical Keyboard", category: "peripherals", price: 12800 },
  { id: 2, name: "Wireless Mouse", category: "peripherals", price: 5400 },
  { id: 3, name: "USB-C Hub", category: "peripherals", price: 3900 },
  { id: 4, name: "27\" 4K Monitor", category: "displays", price: 48000 },
  { id: 5, name: "Ultrawide Monitor", category: "displays", price: 72000 },
  { id: 6, name: "Laptop Stand", category: "accessories", price: 4200 },
  { id: 7, name: "Noise-Cancelling Headphones", category: "audio", price: 32000 },
  { id: 8, name: "USB Microphone", category: "audio", price: 15800 },
  { id: 9, name: "Webcam 1080p", category: "accessories", price: 6800 },
  { id: 10, name: "Desk Mat", category: "accessories", price: 2400 },
  { id: 11, name: "Mechanical Numpad", category: "peripherals", price: 6900 },
  { id: 12, name: "Portable SSD 1TB", category: "storage", price: 13800 },
  { id: 13, name: "NVMe SSD 2TB", category: "storage", price: 24800 },
  { id: 14, name: "Bluetooth Speaker", category: "audio", price: 9800 },
  { id: 15, name: "Monitor Arm", category: "accessories", price: 8900 },
];

// Ground-truth counter for requests that actually reached the server. The debounce
// dispatch interval (>=300ms) guarantees a request is sent — and arrives here — before
// any superseding request can abort it, so this tally is the source of truth for
// "requests sent". Compare it with the on-screen counter: they must match.
let searchHits = 0;

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    // Search API — matches name or category (case-insensitive). Empty query returns all.
    if (url.pathname === "/api/search" && req.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      // Log on arrival (before the delay) so the count reflects requests sent, not landed.
      console.log(`[search] #${++searchHits}  q="${q}"`);
      // Randomized latency (150–800ms) so responses can complete OUT OF ORDER. A fixed
      // delay would make every response arrive in request order (FIFO) and hide the
      // interesting case: a slow earlier search landing after a newer one. With jitter,
      // that race actually happens — and wcs-fetch's abort-on-new-request guarantees the
      // newest result still wins (the superseded request is aborted, emits no response).
      await delay(150 + Math.floor(Math.random() * 650));
      const hits = q
        ? products.filter(
            (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
          )
        : products;
      jsonResponse(res, hits);
      return true;
    }
    return false;
  },
});
