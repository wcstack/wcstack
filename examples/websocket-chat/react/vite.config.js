import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The app derives its socket url from `location.host`, so under `npm run dev`
  // it targets ws://localhost:5173/ws. Proxy that to the demo server (port 3301),
  // which owns the only /ws endpoint — start it with `node server.js`.
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:3301", ws: true },
    },
  },
  build: {
    outDir: "dist",
  },
});
