import { describe, expect, it } from "vitest";

import { isSpanBeyondLateness } from "../src/application/ingest.js";

describe("ingest lateness", () => {
  it("accepts a span exactly at the 24 hour boundary", () => {
    expect(
      isSpanBeyondLateness(
        new Date("2026-11-20T12:00:00.000Z"),
        new Date("2026-11-21T12:00:00.000Z"),
        24,
      ),
    ).toBe(false);
  });

  it("rejects a span one millisecond beyond the boundary", () => {
    expect(
      isSpanBeyondLateness(
        new Date("2026-11-20T11:59:59.999Z"),
        new Date("2026-11-21T12:00:00.000Z"),
        24,
      ),
    ).toBe(true);
  });
});
