export type Role = "viewer" | "operator" | "approver" | "admin";

export interface JwtLikePayload {
  [key: string]: unknown;
  sub?: string;
  exp?: number;
  iat?: number;
  role?: Role;
  mfa?: boolean;
}

export interface AuthenticatedUser {
  id: string;
  role: Role;
  mfa: boolean;
  claims: JwtLikePayload;
}
