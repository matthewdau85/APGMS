declare module "vite/client" {
  export interface ImportMetaEnv {
    [key: string]: string | undefined;
  }
  export interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
