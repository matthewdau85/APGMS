module.exports = {
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  overrides: [
    {
      files: ["src/components/**/*.{ts,tsx}", "src/context/**/*.{ts,tsx}", "src/pages/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: ["../utils/mockData", "../utils/mockData.*"],
            message: "Use demoDataClient for accessing mock data in UI modules.",
          },
        ],
      },
    },
  ],
  ignorePatterns: ["dist/", "node_modules/", "apps/", "public/"],
};
