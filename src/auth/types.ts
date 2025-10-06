export type Role = "viewer" | "operator" | "approver" | "admin";

export interface AuthClaims {
  sub: string;
  role: Role;
  mfa?: boolean;
  [key: string]: unknown;
}
