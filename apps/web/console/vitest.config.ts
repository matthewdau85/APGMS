import { mergeConfig, defineConfig } from "vite";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      css: true,
      reporters: "default",
      include: ["src/__tests__/**/*.test.{ts,tsx}"],
      typecheck: {
        tsconfig: "./tsconfig.vitest.json",
      },
    },
  }),
);
