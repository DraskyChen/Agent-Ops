import { describe, expect, it } from "vitest";

import {
  canReview,
  canViewContent,
  roleAllows,
  safeReturnTo,
} from "../src/application/auth.js";

describe("human authorization rules", () => {
  it("keeps content and review permissions above metadata viewing", () => {
    expect(canViewContent("viewer")).toBe(false);
    expect(canViewContent("reviewer")).toBe(true);
    expect(canReview("reviewer")).toBe(true);
    expect(roleAllows("admin", "reviewer")).toBe(true);
    expect(roleAllows("viewer", "reviewer")).toBe(false);
  });

  it("only accepts local return paths", () => {
    expect(safeReturnTo("/console?trace=1")).toBe("/console?trace=1");
    expect(safeReturnTo("//example.com")).toBe("/console");
    expect(safeReturnTo("https://example.com")).toBe("/console");
    expect(safeReturnTo(undefined)).toBe("/console");
  });
});
