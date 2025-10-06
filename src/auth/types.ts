export type UserRole = "viewer" | "operator" | "approver" | "admin";

export interface AuthenticatedUser {
  sub: string;
  roles: UserRole[];
  name?: string;
  email?: string;
  mfa?: boolean;
  tokenId?: string;
  issuedAt?: number;
  expiresAt?: number;
  [key: string]: unknown;
}
