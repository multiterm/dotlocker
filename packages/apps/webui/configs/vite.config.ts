import { resolve } from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const pkgRoot = resolve(import.meta.dirname, "..");
const webuiRoot = resolve(pkgRoot, "src");

export default defineConfig({
  root: webuiRoot,
  base: "/webui/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "~webui": webuiRoot,
    },
  },
  build: {
    outDir: resolve(pkgRoot, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    manifest: true,
    rollupOptions: {
      input: resolve(webuiRoot, "index.html"),
    },
  },
});
