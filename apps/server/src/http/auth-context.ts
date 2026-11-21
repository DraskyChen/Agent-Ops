import type {
  ApiErrorResponse,
  HumanRole,
  MeResponse,
} from "@agent-ops/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  canReview,
  canViewContent,
  roleAllows,
  type HumanAuth,
  type HumanPrincipal,
} from "../application/auth.js";

export const HUMAN_SESSION_COOKIE = "agent_ops_session";
export const OIDC_STATE_COOKIE = "agent_ops_oidc_state";

export async function requirePrincipal(
  auth: HumanAuth,
  request: FastifyRequest,
  reply: FastifyReply,
  requiredRole: HumanRole = "viewer",
): Promise<HumanPrincipal | null> {
  const principal = await auth.authenticate(
    request.cookies[HUMAN_SESSION_COOKIE],
  );
  if (principal === null) {
    await reply.code(401).send({
      code: "AUTHENTICATION_REQUIRED",
      message: "Authentication required",
    } satisfies ApiErrorResponse);
    return null;
  }
  if (!roleAllows(principal.role, requiredRole)) {
    await reply.code(403).send({
      code: "PERMISSION_DENIED",
      message: "Insufficient permission",
    } satisfies ApiErrorResponse);
    return null;
  }
  return principal;
}

export function meResponse(principal: HumanPrincipal): MeResponse {
  return {
    subject: principal.subject,
    displayName: principal.displayName,
    email: principal.email,
    role: principal.role,
    canViewContent: canViewContent(principal.role),
    canReview: canReview(principal.role),
  };
}
