import type { Pool } from "pg";

import type {
  ContentRetentionRepository,
  ExpiredContent,
} from "../../application/content-retention.js";

export function createPostgresContentRetentionRepository(
  pool: Pool,
): ContentRetentionRepository {
  return {
    async claimExpired(now, limit) {
      const result = await pool.query<ExpiredContent>(
        `with candidates as (
          select content_id
          from content_objects
          where expires_at <= $1
            and status in ('available', 'unavailable')
          order by expires_at asc
          for update skip locked
          limit $2
        )
        update content_objects content
        set status = 'unavailable'
        from candidates
        where content.content_id = candidates.content_id
        returning content.content_id as "contentId", content.object_key as "objectKey"`,
        [now, limit],
      );
      return result.rows;
    },

    async markExpired(contentId) {
      await pool.query(
        `update content_objects
         set status = 'expired'
         where content_id = $1`,
        [contentId],
      );
    },
  };
}
