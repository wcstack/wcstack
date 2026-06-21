import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  // Treat <wcs-*> as native custom elements so the template compiler leaves
  // them alone (and lets us bind `:url` on <wcs-fetch>) instead of trying to
  // resolve them as Vue components.
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("wcs-") } } })],
  build: { outDir: "dist" },
  server: { proxy: { "/api": "http://localhost:3400" } },
});
