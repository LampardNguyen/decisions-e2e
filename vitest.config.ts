import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test chạy thẳng trên src, không cần build trước.
    alias: {
      "@decisions-e2e/core": fileURLToPath(new URL("packages/core/src/index.ts", import.meta.url)),
      "@decisions-e2e/driver-playwright": fileURLToPath(new URL("packages/driver-playwright/src/index.ts", import.meta.url)),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts"], testTimeout: 30_000 },
});
