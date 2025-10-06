declare module "*.svg" {
  const content: string;
  export default content;
}

declare namespace NodeJS {
  interface ProcessEnv {
    APP_MODE?: string;
  }
}
