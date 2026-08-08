import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith("wcs-"),
        },
      },
    }),
  ],
  // The app derives its socket url from `location.host`, so under `npm run dev`
  // it targets ws://localhost:5173/ws. Proxy that to the demo server (port 3302),
  // which owns the only /ws endpoint — start it with `node server.js`.
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:3302", ws: true },
    },
  },
  build: {
    outDir: "dist",
  },
});
