import { fileURLToPath } from "node:url";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";
// Reuses the `ws` dependency installed under examples/websocket-chat/shared/
// (see that demo for the same pattern) instead of adding one to this example.
import { WebSocketServer } from "../websocket-chat/shared/ws.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Mock warehouse data for the Section 1 (<wcs-fetch>) demo.
const widgets = [
  { id: 1, name: "Torque Wrench", stock: 42 },
  { id: 2, name: "Ball Bearing 6203", stock: 318 },
  { id: 3, name: "Hex Bolt M8x40", stock: 1200 },
  { id: 4, name: "Gasket Set", stock: 76 },
  { id: 5, name: "Hydraulic Hose 2m", stock: 19 },
];

const server = createDemoServer({
  port: Number(process.env.PORT || 3303),
  root: __dirname,
  api: async (req, res, url) => {
    // Mock API for the :state(loading) / :state(error) showcase (Section 1).
    // `mode` picks which of the three demo buttons drove this request; `attempt`
    // is a cache-busting counter so re-clicking the same button always changes
    // the url (wcs-fetch only refetches when the url actually changes).
    if (url.pathname === "/api/widgets" && req.method === "GET") {
      const mode = url.searchParams.get("mode") || "fast";

      if (mode === "slow") {
        await delay(2500);
        jsonResponse(res, widgets);
      } else if (mode === "fail") {
        await delay(700);
        jsonResponse(res, { error: "Warehouse service unavailable (simulated failure)." }, 500);
      } else {
        // "fast" (default): still a short delay so the spinner is actually visible.
        await delay(400);
        jsonResponse(res, widgets);
      }
      return true;
    }
    return false;
  },
  notes: [":state() showcase — /api/widgets + ws://…/ws"],
});

// Minimal WebSocket endpoint for the :state(connected) showcase (Section 2).
// No message protocol is needed here — the demo only cares about connect /
// disconnect / reconnect, so nothing beyond accepting the connection is wired up.
new WebSocketServer(server, "/ws");
