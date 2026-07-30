import { fileURLToPath } from "node:url";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Mock catalog generated up front. 87 items with a page size of 20 means the
// last page is partial (87 = 20*4 + 7). That partial page is what signals the
// end of the feed: a response shorter than `limit` means "no more pages".
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

// Failure injection, so the retry path is actually demoable (and so the deadlock
// this demo used to have is reproducible):
//   FAIL_PAGE=1 node server.js   page 1 returns 503 for its first FAIL_TIMES (default
//                                2) requests. The feed starts EMPTY, so there is
//                                nothing to scroll — only the retry clock can recover
//                                it. Raise FAIL_TIMES above maxRetries (3) to spend
//                                the budget and land on the Retry button.
//   FLAKY=0.4   node server.js   every page fails with 40% probability.
const FAIL_PAGE = Number(process.env.FAIL_PAGE || 0);
const FAIL_TIMES = Number(process.env.FAIL_TIMES || 2);
const FLAKY = Number(process.env.FLAKY || 0);
const injectedFailures = new Map();

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    // Paginated catalog. Returns a plain array (never a {items,hasMore} envelope):
    // the client treats "array shorter than limit" as the end-of-feed signal, so
    // the response shape stays identical to the other fetch demos.
    if (url.pathname === "/api/items" && req.method === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
      const start = (page - 1) * limit;
      const slice = catalog.slice(start, start + limit);
      // Small randomized delay (300–600ms) so the bottom spinner is actually visible on a fast network.
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
