import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import js from "@eslint/js";

const poolRestriction = {
  selector: "NewExpression[callee.name='Pool']",
  message: "Use the shared Pool from src/db/pool.ts"
};

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.cjs", "**/*.mjs"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: false
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      "no-restricted-syntax": ["error", poolRestriction]
    }
  },
  {
    files: ["src/db/pool.ts"],
    rules: {
      "no-restricted-syntax": "off"
    }
  }
];
