import { describe, expect, it, vi } from "vitest";

import {
  createFeedbackService,
  FeedbackValidationError,
} from "../src/application/feedback.js";

describe("feedback service", () => {
  it("normalizes input and returns the repository idempotency result", async () => {
    const create = vi.fn().mockResolvedValue({
      created: false,
      feedback: {
        feedbackId: "feedback-1",
        traceId: "trace-1",
        spanId: null,
        eventId: "event-1",
        type: "thumbs_down",
        actorRef: null,
        comment: "wrong answer",
        createdAt: "2026-11-21T12:00:00.000Z",
      },
    });
    const feedback = createFeedbackService({ create });

    const result = await feedback.create({
      traceId: " trace-1 ",
      eventId: " event-1 ",
      type: "thumbs_down",
      comment: " wrong answer ",
    });

    expect(create).toHaveBeenCalledWith({
      traceId: "trace-1",
      eventId: "event-1",
      type: "thumbs_down",
      spanId: null,
      actorRef: null,
      comment: "wrong answer",
    });
    expect(result.created).toBe(false);
  });

  it("rejects oversized comments before persistence", async () => {
    const create = vi.fn();
    const feedback = createFeedbackService({ create });

    await expect(
      feedback.create({
        traceId: "trace-1",
        eventId: "event-1",
        type: "comment",
        comment: "x".repeat(2001),
      }),
    ).rejects.toBeInstanceOf(FeedbackValidationError);
    expect(create).not.toHaveBeenCalled();
  });
});
