import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";

const pkgRoot = resolve(import.meta.dirname, "..");
const src = resolve(pkgRoot, "src");

export default defineConfig({
  root: pkgRoot,
  plugins: [
    react(),
    dts({
      entryRoot: src,
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "tests/**", "dist/**"],
      rollupTypes: true,
      tsconfigPath: resolve(pkgRoot, "tsconfig.json"),
    }),
  ],
  build: {
    outDir: resolve(pkgRoot, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      formats: ["es"],
      entry: {
        index: resolve(src, "index.ts"),
      },
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime"],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
