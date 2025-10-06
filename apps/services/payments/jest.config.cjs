const config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  extensionsToTreatAsEsm: [".ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  globals: {
    "ts-jest": {
      useESM: true,
      tsconfig: "<rootDir>/tsconfig.json",
    },
  },
};

module.exports = config;
