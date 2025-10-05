declare module "jsonwebtoken" {
  export interface JwtPayload {
    [key: string]: unknown;
    sub?: string;
    roles?: string[];
  }

  export interface VerifyOptions {
    algorithms?: string[];
  }

  export function verify(token: string, secretOrPublicKey: string, options?: VerifyOptions): JwtPayload | string;

  const jwt: {
    verify: typeof verify;
  };

  export default jwt;
}
