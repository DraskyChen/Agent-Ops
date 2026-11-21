export interface ExpiredContent {
  contentId: string;
  objectKey: string;
}

export interface ContentRetentionRepository {
  claimExpired(now: Date, limit: number): Promise<ExpiredContent[]>;
  markExpired(contentId: string): Promise<void>;
}

export interface ContentBlobDeleter {
  delete(objectKey: string): Promise<void>;
}

export interface ContentRetentionWorker {
  runOnce(): Promise<{ expired: number; failed: number }>;
}

export function createContentRetentionWorker(
  repository: ContentRetentionRepository,
  blobs: ContentBlobDeleter,
  now: () => Date = () => new Date(),
): ContentRetentionWorker {
  return {
    async runOnce() {
      const candidates = await repository.claimExpired(now(), 100);
      let expired = 0;
      let failed = 0;
      for (const candidate of candidates) {
        try {
          await blobs.delete(candidate.objectKey);
          await repository.markExpired(candidate.contentId);
          expired += 1;
        } catch {
          failed += 1;
        }
      }
      return { expired, failed };
    },
  };
}
