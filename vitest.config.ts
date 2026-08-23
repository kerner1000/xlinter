import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Integration tests spawn the built CLI; keep a generous timeout.
    testTimeout: 30_000,
  },
});
