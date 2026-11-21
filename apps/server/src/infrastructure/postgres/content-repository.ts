import type { Pool } from "pg";

import type {
  ContentRecord,
  ContentRepository,
} from "../../application/content.js";

export function createPostgresContentRepository(
  pool: Pool,
): ContentRepository {
  return {
    async insert(record) {
      await pool.query(
        `insert into content_objects (
          content_id, object_key, owner_app, content_kind, media_type,
          capture_mode, size_bytes, sha256, redaction_rule_version,
          encryption, status, expires_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )`,
        [
          record.contentId,
          record.objectKey,
          record.ownerApp,
          record.contentKind,
          record.mediaType,
          record.captureMode,
          record.sizeBytes,
          record.sha256,
          record.redactionRuleVersion,
          record.encryption,
          record.status,
          record.expiresAt,
        ],
      );
    },

    async find(contentId) {
      const result = await pool.query<ContentRow>(
        `select
          content_id, object_key, owner_app, content_kind, media_type,
          capture_mode, size_bytes, sha256, redaction_rule_version,
          encryption, status, expires_at
        from content_objects
        where content_id = $1`,
        [contentId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return null;
      }
      return {
        contentId: row.content_id,
        objectKey: row.object_key,
        ownerApp: row.owner_app,
        contentKind: row.content_kind,
        mediaType: row.media_type,
        captureMode:
          row.capture_mode === "full" ? "full" : "metadata_only",
        sizeBytes: Number(row.size_bytes),
        sha256: row.sha256,
        redactionRuleVersion: row.redaction_rule_version,
        encryption: row.encryption,
        status:
          row.status === "uploading" ||
          row.status === "available" ||
          row.status === "quarantined" ||
          row.status === "unavailable" ||
          row.status === "deleted"
            ? row.status
            : "unavailable",
        expiresAt: row.expires_at,
      };
    },
  };
}

interface ContentRow {
  content_id: string;
  object_key: string;
  owner_app: string;
  content_kind: string;
  media_type: string;
  capture_mode: string;
  size_bytes: string;
  sha256: string;
  redaction_rule_version: string;
  encryption: string;
  status: string;
  expires_at: Date | null;
}

