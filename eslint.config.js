export default [
  {
    ignores: [
      "node_modules",
      "dist",
      "**/*.bak*",
      "**/*.ps1",
      "apps/**",
      "server.js.bak",
      "server.js.bak.**",
      "commitlint.config.cjs",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Pool']",
          message: "Use the shared pool from src/db/pool.ts",
        },
      ],
    },
  },
  {
    files: ["server.js"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
];
