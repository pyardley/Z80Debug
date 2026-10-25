import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const shim = (name: string) => fileURLToPath(new URL(`./src/shims/${name}.ts`, import.meta.url));

function asmText(): Plugin {
  return {
    name: "asm-text",
    enforce: "pre",
    load(id) {
      const file = id.split("?")[0];
      if (!file.endsWith(".asm")) {
        return null;
      }
      return `export default ${JSON.stringify(readFileSync(file, "utf8"))};`;
    },
  };
}

export default defineConfig({
  plugins: [asmText()],
  resolve: {
    alias: {
      fs: shim("fs"),
      path: shim("path"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
