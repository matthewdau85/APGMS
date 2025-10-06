const MONEY_NAME_PATTERN = "/(amount|cents|money|balance|liability|total|owed)/i";

module.exports = {
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  overrides: [
    {
      files: ["src/**/*.ts", "src/**/*.tsx", "libs/**/*.ts", "pages/api/**/*.ts"],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector: `TSTypeAnnotation[parent.type="Identifier"][parent.name=${MONEY_NAME_PATTERN}] > TSNumberKeyword`,
            message: "Do not use 'number' for monetary identifier; use MoneyCents instead.",
          },
          {
            selector: `TSPropertySignature[key.type="Identifier"][key.name=${MONEY_NAME_PATTERN}] TSTypeAnnotation > TSNumberKeyword`,
            message: "Do not use 'number' for monetary property; use MoneyCents instead.",
          },
          {
            selector: `TSParameterProperty > Identifier[name=${MONEY_NAME_PATTERN}] > TSTypeAnnotation > TSNumberKeyword`,
            message: "Do not use 'number' for monetary parameter; use MoneyCents instead.",
          },
          {
            selector: `Identifier[name=${MONEY_NAME_PATTERN}] > TSTypeAnnotation > TSNumberKeyword`,
            message: "Do not use 'number' for monetary identifier; use MoneyCents instead.",
          },
        ],
      },
    },
  ],
};
