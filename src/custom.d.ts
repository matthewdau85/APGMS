declare module "*.svg" {
  const content: string;
  export default content;
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: {
        sub?: string;
        roles?: string[];
      };
    }
  }
}

export {};
