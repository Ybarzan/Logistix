import { defineConfig } from "vitest/config";

// Tests backend : les fonctions Convex tournent réellement (convex-test,
// base en mémoire) dans le runtime edge, comme en production.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test", "@convex-dev/rate-limiter"] } },
  },
});
