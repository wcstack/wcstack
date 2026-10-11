import { fileURLToPath } from "node:url";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// The same mock catalog as examples/state-intersect-scroll: 87 items with a page
// size of 20, so the last page is partial (87 = 20*4 + 7) and ends the feed.
const CATEGORIES = ["peripherals", "displays", "audio", "storage", "accessories"];
const ADJ = ["Wireless", "Mechanical", "Portable", "Compact", "Ultra", "Pro", "Mini", "Smart", "Hybrid", "Premium"];
const NOUN = ["Keyboard", "Mouse", "Monitor", "Headphones", "SSD", "Hub", "Webcam", "Speaker", "Microphone", "Stand"];
const TOTAL = 87;
const catalog = Array.from({ length: TOTAL }, (_, i) => ({
  id: i + 1,
  name: `${ADJ[i % ADJ.length]} ${NOUN[(i * 7) % NOUN.length]} #${i + 1}`,
  category: CATEGORIES[i % CATEGORIES.length],
  price: 1000 + ((i * 137) % 90) * 100,
}));

// Failure injection, to see the Retry button:
//   FAIL_PAGE=2 node server.js   page 2 returns 503 for its first FAIL_TIMES (default 1) requests.
//   FLAKY=0.4   node server.js   every page fails with 40% probability.
const FAIL_PAGE = Number(process.env.FAIL_PAGE || 0);
const FAIL_TIMES = Number(process.env.FAIL_TIMES || 1);
const FLAKY = Number(process.env.FLAKY || 0);
const injectedFailures = new Map();

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    // A plain array per page; an array shorter than `limit` is the end of the feed.
    if (url.pathname === "/api/items" && req.method === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
      const start = (page - 1) * limit;
      const slice = catalog.slice(start, start + limit);
      // 300–600ms, so the bottom spinner is visible on a fast network.
      await delay(300 + Math.floor(Math.random() * 300));

      const failed = injectedFailures.get(page) ?? 0;
      const injected = (FAIL_PAGE === page && failed < FAIL_TIMES) || (FLAKY > 0 && Math.random() < FLAKY);
      if (injected) {
        injectedFailures.set(page, failed + 1);
        console.log(`[items] page=${page} -> injected 503 (failure ${failed + 1})`);
        jsonResponse(res, { error: "Injected failure" }, 503);
        return true;
      }

      console.log(`[items] page=${page} limit=${limit} -> ${slice.length} items`);
      jsonResponse(res, slice);
      return true;
    }
    return false;
  },
});
