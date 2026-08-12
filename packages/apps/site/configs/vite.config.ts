import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "../src");
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: { outDir: resolve(import.meta.dirname, "../dist"), emptyOutDir: true },
});
