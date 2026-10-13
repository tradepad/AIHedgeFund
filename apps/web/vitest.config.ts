import { defineConfig } from "vitest/config";

// Unit tests only; the Playwright suite in e2e/ runs with `pnpm test:e2e`.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
