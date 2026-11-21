import { describe, expect, it } from "vitest";

import { resolveOidcRole } from "../src/infrastructure/auth/oidc-auth.js";

const groups = {
  adminGroups: ["agent-ops-admins"],
  reviewerGroups: ["agent-ops-reviewers"],
};

describe("OIDC role mapping", () => {
  it("maps configured groups in descending privilege order", () => {
    expect(resolveOidcRole(["agent-ops-reviewers"], groups)).toBe("reviewer");
    expect(
      resolveOidcRole(
        ["agent-ops-reviewers", "agent-ops-admins"],
        groups,
      ),
    ).toBe("admin");
  });

  it("falls back to metadata-only viewer access", () => {
    expect(resolveOidcRole("unknown-group", groups)).toBe("viewer");
    expect(resolveOidcRole(undefined, groups)).toBe("viewer");
  });
});
