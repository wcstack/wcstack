import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  // dev only: proxy the API to the shared hub (run it with
  // `node packages/fetch/examples/pagination/shared/server.js`).
  server: { proxy: { "/api": "http://localhost:3400" } },
});
