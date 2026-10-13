import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  // Bundle workspace packages (TypeScript sources); keep npm dependencies external.
  noExternal: [/^@arf\//],
});
