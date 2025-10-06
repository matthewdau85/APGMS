declare module "*.svg" {
  const content: string;
  export default content;
}

import type { PublicRuntimeConfig } from "./utils/runtimeConfig";

declare global {
  // eslint-disable-next-line no-var
  var __APGMS_CONFIG__: PublicRuntimeConfig | undefined;

  interface Window {
    __APGMS_CONFIG__?: PublicRuntimeConfig;
  }
}

export {};
