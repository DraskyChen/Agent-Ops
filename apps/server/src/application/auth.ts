import type { HumanRole } from "@agent-ops/contracts";

export interface HumanPrincipal {
  subject: string;
  displayName: string;
  email: string | null;
  role: HumanRole;
}

export interface LoginStart {
  authorizationUrl: string;
  stateToken: string;
  maxAgeSeconds: number;
}

export interface LoginCompletion {
  sessionToken: string;
  maxAgeSeconds: number;
  principal: HumanPrincipal;
  returnTo: string;
}

export interface HumanAuth {
  mode: "dev" | "oidc";
  beginLogin(returnTo: string | undefined): Promise<LoginStart | null>;
  completeLogin(
    stateToken: string,
    callbackUrl: URL,
  ): Promise<LoginCompletion | null>;
  authenticate(sessionToken: string | undefined): Promise<HumanPrincipal | null>;
  logout(sessionToken: string | undefined): Promise<void>;
}

export interface LoginStateRecord {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  expiresAt: Date;
}

export interface HumanSessionRecord {
  principal: HumanPrincipal;
  expiresAt: Date;
}

export interface HumanAuthRepository {
  saveLoginState(stateHash: string, record: LoginStateRecord): Promise<void>;
  consumeLoginState(
    stateHash: string,
    now: Date,
  ): Promise<LoginStateRecord | null>;
  saveSession(sessionHash: string, record: HumanSessionRecord): Promise<void>;
  findSession(
    sessionHash: string,
    now: Date,
  ): Promise<HumanSessionRecord | null>;
  deleteSession(sessionHash: string): Promise<void>;
  deleteExpired(now: Date): Promise<void>;
}

export function canViewContent(role: HumanRole): boolean {
  return role === "reviewer" || role === "admin";
}

export function canReview(role: HumanRole): boolean {
  return role === "reviewer" || role === "admin";
}

export function roleAllows(actual: HumanRole, required: HumanRole): boolean {
  const rank: Record<HumanRole, number> = {
    viewer: 1,
    reviewer: 2,
    admin: 3,
  };
  return rank[actual] >= rank[required];
}

export function safeReturnTo(value: string | undefined): string {
  return value !== undefined &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : "/console";
}
