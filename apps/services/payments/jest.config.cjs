module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  extensionsToTreatAsEsm: [".ts"],
  globals: {
    "ts-jest": {
      useESM: true,
      tsconfig: "<rootDir>/tsconfig.json",
    },
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
