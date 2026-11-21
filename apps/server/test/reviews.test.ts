import { describe, expect, it, vi } from "vitest";

import {
  createReviewService,
  ReviewValidationError,
} from "../src/application/reviews.js";

const principal = {
  subject: "reviewer-1",
  displayName: "Reviewer One",
  email: null,
  role: "reviewer" as const,
};

describe("review service", () => {
  it("normalizes a reviewer decision before persistence", async () => {
    const create = vi.fn().mockResolvedValue({
      reviewId: "review-1",
      traceId: "trace-1",
      reviewerSubject: "reviewer-1",
      reviewerName: "Reviewer One",
      status: "resolved",
      issueArea: "tool",
      comment: "Retry policy fixed",
      createdAt: "2026-11-21T12:00:00.000Z",
    });
    const reviews = createReviewService({ create });

    await reviews.create("trace-1", principal, {
      status: "resolved",
      issueArea: "tool",
      comment: " Retry policy fixed ",
    });

    expect(create).toHaveBeenCalledWith("trace-1", principal, {
      status: "resolved",
      issueArea: "tool",
      comment: "Retry policy fixed",
    });
  });

  it("rejects invalid statuses and oversized comments", async () => {
    const reviews = createReviewService({ create: vi.fn() });

    await expect(
      reviews.create("trace-1", principal, {
        status: "invalid" as "open",
      }),
    ).rejects.toBeInstanceOf(ReviewValidationError);

    await expect(
      reviews.create("trace-1", principal, {
        status: "open",
        comment: "x".repeat(4001),
      }),
    ).rejects.toBeInstanceOf(ReviewValidationError);
  });
});
