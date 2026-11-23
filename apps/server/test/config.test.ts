import { describe, expect, it } from "vitest";

import { loadServerConfig } from "../src/config.js";

describe("server auth configuration", () => {
  it("defaults local development to the explicit dev identity", () => {
    const config = loadServerConfig({});
    expect(config.auth.mode).toBe("dev");
    expect(config.evaluationJudgeEnabled).toBe(false);
    if (config.auth.mode === "dev") {
      expect(config.auth.dev.role).toBe("admin");
    }
  });

  it("never permits dev identity in production", () => {
    expect(() =>
      loadServerConfig({
        NODE_ENV: "production",
        AGENT_OPS_AUTH_MODE: "dev",
      }),
    ).toThrow(/not allowed in production/);
  });

  it("requires OIDC settings when production omits the auth mode", () => {
    expect(() =>
      loadServerConfig({
        NODE_ENV: "production",
      }),
    ).toThrow(/OIDC_ISSUER is required/);
  });
});
