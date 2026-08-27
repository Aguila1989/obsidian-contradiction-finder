import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
  resolve: {
    alias: { obsidian: path.resolve(root, "test/obsidian-mock.ts") },
  },
});
