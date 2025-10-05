import "@testing-library/jest-dom/vitest";

if (typeof globalThis.atob !== "function") {
  globalThis.atob = (input: string): string => {
    return Buffer.from(input, "base64").toString("binary");
  };
}
