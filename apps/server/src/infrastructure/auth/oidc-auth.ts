import { createHash, randomBytes } from "node:crypto";

import type { HumanRole } from "@agent-ops/contracts";
import * as client from "openid-client";

import type { OidcAuthConfig } from "../../config.js";
import {
  safeReturnTo,
  type HumanAuth,
  type HumanAuthRepository,
  type HumanPrincipal,
  type LoginCompletion,
  type LoginStart,
} from "../../application/auth.js";

const LOGIN_STATE_TTL_SECONDS = 10 * 60;

export interface OidcHumanAuthOptions {
  config: OidcAuthConfig;
  sessionTtlHours: number;
  now?: () => Date;
}

export async function createOidcHumanAuth(
  repository: HumanAuthRepository,
  options: OidcHumanAuthOptions,
): Promise<HumanAuth> {
  const configuration = await client.discovery(
    new URL(options.config.issuer),
    options.config.clientId,
    options.config.clientSecret,
  );
  const now = options.now ?? (() => new Date());
  const sessionTtlSeconds = options.sessionTtlHours * 60 * 60;

  return {
    mode: "oidc",

    async beginLogin(returnTo): Promise<LoginStart> {
      const current = now();
      await repository.deleteExpired(current);
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge =
        await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();
      const nonce = client.randomNonce();
      const normalizedReturnTo = safeReturnTo(returnTo);

      await repository.saveLoginState(hashToken(state), {
        codeVerifier,
        nonce,
        returnTo: normalizedReturnTo,
        expiresAt: new Date(
          current.getTime() + LOGIN_STATE_TTL_SECONDS * 1000,
        ),
      });

      const authorizationUrl = client.buildAuthorizationUrl(configuration, {
        redirect_uri: options.config.redirectUri,
        response_type: "code",
        scope: options.config.scopes,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return {
        authorizationUrl: authorizationUrl.href,
        stateToken: state,
        maxAgeSeconds: LOGIN_STATE_TTL_SECONDS,
      };
    },

    async completeLogin(
      stateToken,
      callbackUrl,
    ): Promise<LoginCompletion | null> {
      const current = now();
      const state = await repository.consumeLoginState(
        hashToken(stateToken),
        current,
      );
      if (state === null) {
        return null;
      }

      const tokens = await client.authorizationCodeGrant(
        configuration,
        callbackUrl,
        {
          pkceCodeVerifier: state.codeVerifier,
          expectedState: stateToken,
          expectedNonce: state.nonce,
        },
      );
      const claims = tokens.claims();
      if (claims === undefined || typeof claims.sub !== "string") {
        return null;
      }

      const displayName =
        claimText(claims, "name") ??
          claimText(claims, "preferred_username") ??
          claimText(claims, "email") ??
          claims.sub;
      const principal: HumanPrincipal = {
        subject: claims.sub,
        displayName,
        email: claimText(claims, "email"),
        role: resolveOidcRole(
          claims[options.config.roleClaim],
          options.config,
        ),
      };
      const sessionToken = randomBytes(32).toString("base64url");
      await repository.saveSession(hashToken(sessionToken), {
        principal,
        expiresAt: new Date(current.getTime() + sessionTtlSeconds * 1000),
      });
      await repository.deleteExpired(current);

      return {
        sessionToken,
        maxAgeSeconds: sessionTtlSeconds,
        principal,
        returnTo: state.returnTo,
      };
    },

    async authenticate(sessionToken) {
      if (sessionToken === undefined || sessionToken === "") {
        return null;
      }
      const session = await repository.findSession(
        hashToken(sessionToken),
        now(),
      );
      return session?.principal ?? null;
    },

    async logout(sessionToken) {
      if (sessionToken !== undefined && sessionToken !== "") {
        await repository.deleteSession(hashToken(sessionToken));
      }
    },
  };
}

export function resolveOidcRole(
  value: unknown,
  config: Pick<OidcAuthConfig, "adminGroups" | "reviewerGroups">,
): HumanRole {
  const groups = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
  if (groups.some((group) => config.adminGroups.includes(group))) {
    return "admin";
  }
  if (groups.some((group) => config.reviewerGroups.includes(group))) {
    return "reviewer";
  }
  return "viewer";
}

function claimText(
  claims: Record<string, unknown>,
  key: string,
): string | null {
  const value = claims[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
