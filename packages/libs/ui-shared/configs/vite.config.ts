import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const root = resolve(import.meta.dirname, "..");

export default defineConfig({
  root,
  plugins: [react(), dts({ tsconfigPath: resolve(root, "tsconfig.json"), rollupTypes: true })],
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    lib: { entry: { index: resolve(root, "src/index.ts") }, formats: ["es"] },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "@dotlocker/gds", "@dotlocker/ui"],
      output: { entryFileNames: "[name].js" },
    },
  },
});
