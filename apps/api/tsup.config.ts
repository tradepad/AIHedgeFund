import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  // Self-contained bundle: workspace packages are TypeScript sources and their
  // dependencies are not hoisted under pnpm, so everything is bundled.
  noExternal: [/.*/],
  external: ["pg-native"],
  banner: { js: "import { createRequire as __arfCreateRequire } from 'node:module'; const require = __arfCreateRequire(import.meta.url);" },
});
