declare module "*.svg" {
  const content: string;
  export default content;
}

declare const process: { env?: Record<string, string | undefined> } | undefined;

interface ImportMeta {
  readonly env?: Record<string, string | undefined>;
}
