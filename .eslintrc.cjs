module.exports = {
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "no-restricted-syntax": [
      "error",
      { selector: "NewExpression[callee.name='Pool']", message: "Use getPool() from src/db/pool.ts" }
    ]
  }
};
