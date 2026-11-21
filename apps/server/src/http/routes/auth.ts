import type { FastifyInstance } from "fastify";

import {
  safeReturnTo,
  type HumanAuth,
} from "../../application/auth.js";
import {
  HUMAN_SESSION_COOKIE,
  meResponse,
  OIDC_STATE_COOKIE,
  requirePrincipal,
} from "../auth-context.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: HumanAuth,
  options: { secureCookies: boolean },
): void {
  app.get<{ Querystring: { returnTo?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const started = await auth.beginLogin(
        safeReturnTo(request.query.returnTo),
      );
      if (started === null) {
        return reply.redirect(safeReturnTo(request.query.returnTo));
      }
      reply.setCookie(OIDC_STATE_COOKIE, started.stateToken, {
        path: "/auth",
        httpOnly: true,
        sameSite: "lax",
        secure: options.secureCookies || request.protocol === "https",
        maxAge: started.maxAgeSeconds,
      });
      return reply.redirect(started.authorizationUrl);
    },
  );

  app.get("/auth/callback", async (request, reply) => {
    const stateToken = request.cookies[OIDC_STATE_COOKIE];
    if (stateToken === undefined) {
      return reply.redirect("/console?authError=missing_state");
    }
    try {
      const host = request.headers.host ?? "127.0.0.1:4318";
      const currentUrl = new URL(request.url, `${request.protocol}://${host}`);
      const completed = await auth.completeLogin(stateToken, currentUrl);
      if (completed === null) {
        reply.clearCookie(OIDC_STATE_COOKIE, { path: "/auth" });
        return reply.redirect("/console?authError=login_failed");
      }
      reply.clearCookie(OIDC_STATE_COOKIE, { path: "/auth" });
      reply.setCookie(HUMAN_SESSION_COOKIE, completed.sessionToken, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: options.secureCookies || request.protocol === "https",
        maxAge: completed.maxAgeSeconds,
      });
      return reply.redirect(completed.returnTo);
    } catch (error) {
      request.log.warn(error, "OIDC callback failed");
      reply.clearCookie(OIDC_STATE_COOKIE, { path: "/auth" });
      return reply.redirect("/console?authError=login_failed");
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    await auth.logout(request.cookies[HUMAN_SESSION_COOKIE]);
    reply.clearCookie(HUMAN_SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/v1/me", async (request, reply) => {
    const principal = await requirePrincipal(auth, request, reply);
    if (principal === null) {
      return;
    }
    return meResponse(principal);
  });
}
