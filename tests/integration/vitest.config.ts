import { defineConfig } from "vitest/config";

// Integration tests share one PostgreSQL server and one Redis database, so
// files run sequentially; each file creates its own throwaway database.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
