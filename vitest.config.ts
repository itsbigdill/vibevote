import { defineConfig } from "vitest/config";

// Pure logic only (scoring, validation, tokens), so plain Node is enough: no Workers runtime is needed.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
