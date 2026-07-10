import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Mock product catalog (detail pages need description/stock, so the list
// endpoint ships the full objects — a real API would split them).
const products = [
  { id: 1, name: "Mechanical Keyboard", category: "peripherals", price: 12800, stock: 12, description: "Hot-swappable 75% board with tactile switches and PBT keycaps." },
  { id: 2, name: "Wireless Mouse", category: "peripherals", price: 5400, stock: 30, description: "Silent-click 2.4GHz mouse with 8 programmable buttons." },
  { id: 3, name: "USB-C Hub", category: "peripherals", price: 3900, stock: 25, description: "7-in-1 hub: HDMI 4K, 100W PD pass-through, SD/microSD, 3x USB-A." },
  { id: 4, name: "27\" 4K Monitor", category: "displays", price: 48000, stock: 6, description: "IPS panel, 95% DCI-P3, single-cable USB-C connection." },
  { id: 5, name: "Ultrawide Monitor", category: "displays", price: 72000, stock: 3, description: "34\" 21:9 curved WQHD with picture-by-picture dual input." },
  { id: 6, name: "Laptop Stand", category: "accessories", price: 4200, stock: 40, description: "Aluminium riser with 6 height steps, folds flat for travel." },
  { id: 7, name: "Noise-Cancelling Headphones", category: "audio", price: 32000, stock: 9, description: "Over-ear ANC, 35h battery, multipoint Bluetooth." },
  { id: 8, name: "USB Microphone", category: "audio", price: 15800, stock: 14, description: "Cardioid condenser mic with hardware mute and gain dial." },
];

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    if (req.method !== "GET") return false;

    // List API
    if (url.pathname === "/api/products") {
      await delay(300);
      jsonResponse(res, products);
      return true;
    }

    // Detail API — /api/products/:id
    const detail = url.pathname.match(/^\/api\/products\/(\d+)$/);
    if (detail) {
      await delay(250);
      const product = products.find((p) => p.id === Number(detail[1]));
      if (product) {
        jsonResponse(res, product);
      } else {
        jsonResponse(res, { error: "Product not found" }, 404);
      }
      return true;
    }

    // SPA fallback: the router uses real URL paths (/products/3, /about), so a
    // page reload or deep link must serve index.html for any extension-less,
    // non-API path and let <wcs-router> resolve it client-side.
    if (!url.pathname.startsWith("/api/") && extname(url.pathname) === "") {
      const html = await readFile(join(__dirname, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return true;
    }

    return false;
  },
  notes: ["Deep links work too: /products/3, /about, /nope"],
});
