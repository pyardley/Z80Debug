import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const shim = (name: string) => fileURLToPath(new URL(`./src/shims/${name}.ts`, import.meta.url));

export default defineConfig({
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
