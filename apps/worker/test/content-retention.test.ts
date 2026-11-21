import { describe, expect, it, vi } from "vitest";

import { createContentRetentionWorker } from "../src/application/content-retention.js";

describe("content retention worker", () => {
  it("marks claimed objects expired after deleting their bytes", async () => {
    const markExpired = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const worker = createContentRetentionWorker(
      {
        claimExpired: async () => [
          { contentId: "content-1", objectKey: "content/one.txt" },
        ],
        markExpired,
      },
      { delete: remove },
    );

    await expect(worker.runOnce()).resolves.toEqual({
      expired: 1,
      failed: 0,
    });
    expect(remove).toHaveBeenCalledWith("content/one.txt");
    expect(markExpired).toHaveBeenCalledWith("content-1");
  });

  it("leaves an object unavailable for retry when storage deletion fails", async () => {
    const markExpired = vi.fn();
    const worker = createContentRetentionWorker(
      {
        claimExpired: async () => [
          { contentId: "content-2", objectKey: "content/two.txt" },
        ],
        markExpired,
      },
      {
        delete: async () => {
          throw new Error("storage unavailable");
        },
      },
    );

    await expect(worker.runOnce()).resolves.toEqual({
      expired: 0,
      failed: 1,
    });
    expect(markExpired).not.toHaveBeenCalled();
  });
});
