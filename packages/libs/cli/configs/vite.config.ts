import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const src = resolve(pkgRoot, "src");

const NODE_BUILTINS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
]);

const SHEBANG = "#!/usr/bin/env node";
const SHEBANG_ENTRIES = new Set(["cli"]);

export default defineConfig({
  root: pkgRoot,
  plugins: [
    dts({
      entryRoot: src,
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "tests/**", "dist/**"],
      rollupTypes: true,
      tsconfigPath: resolve(pkgRoot, "tsconfig.json"),
    }),
  ],
  build: {
    target: "node20",
    outDir: resolve(pkgRoot, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      formats: ["es"],
      entry: {
        index: resolve(src, "index.ts"),
        cli: resolve(src, "cli.ts"),
        "client/index": resolve(src, "client", "index.ts"),
        "server/index": resolve(src, "server", "index.ts"),
      },
    },
    rollupOptions: {
      // Bundle the workspace libs into the published package; keep third-party
      // and node builtins external.
      external: id => {
        if (id.startsWith("@multiterm/pluto-")) return false;
        if (NODE_BUILTINS.has(id) || id.startsWith("node:")) return true;
        if (id.startsWith(".") || id.startsWith("/")) return false;
        return true;
      },
      treeshake: {
        moduleSideEffects: id => /[\\/]src[\\/]cli\.ts$/.test(id),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        banner: chunk => {
          if (chunk.isEntry && SHEBANG_ENTRIES.has(chunk.name)) {
            return `${SHEBANG}\n`;
          }
          return "";
        },
      },
    },
  },
});
