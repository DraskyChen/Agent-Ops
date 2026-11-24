import type {
  PromptRegistryResponse,
  PromptRegistryEvent,
  PromptRegistryStatus,
  PromptVersionDetail,
  PromptVersionSummary,
} from "@agent-ops/contracts";
import type { Pool } from "pg";

import type { HumanPrincipal } from "../../application/auth.js";
import {
  PromptVersionConflictError,
  PromptVersionNotFoundError,
  type NormalizedPromptVersion,
  type NormalizedPromptVersionUpdate,
  type PromptRegistryRepository,
} from "../../application/prompt-registry.js";

export function createPostgresPromptRegistryRepository(
  pool: Pool,
): PromptRegistryRepository {
  return {
    async list() {
      const [entries, observed] = await Promise.all([
        pool.query<PromptVersionRow>(
          `${promptVersionQuery()}
           order by
             case when p.status = 'active' then 0 else 1 end,
             p.prompt_version`,
        ),
        pool.query<ObservedPromptRow>(
          `select
             prompt_version,
             count(*)::integer as trace_count,
             max(start_time) as last_seen_at
           from traces t
           where prompt_version is not null
             and prompt_version <> ''
             and not exists (
               select 1 from prompt_registry p
               where p.prompt_version = t.prompt_version
             )
           group by prompt_version
           order by trace_count desc, prompt_version
           limit 100`,
        ),
      ]);
      return {
        entries: entries.rows.map(mapPromptVersion),
        observedUnregistered: observed.rows.map((row) => ({
          promptVersion: row.prompt_version,
          traceCount: row.trace_count,
          lastSeenAt: row.last_seen_at?.toISOString() ?? null,
        })),
      };
    },

    async get(promptVersion) {
      const [promptResult, historyResult] = await Promise.all([
        pool.query<PromptVersionRow>(
          `${promptVersionQuery()} where p.prompt_version = $1`,
          [promptVersion],
        ),
        pool.query<PromptRegistryEventRow>(
          `select
             id, prompt_version, event_type, actor_name,
             before_state, after_state, created_at
           from prompt_registry_events
           where prompt_version = $1
           order by created_at desc, id desc`,
          [promptVersion],
        ),
      ]);
      const row = promptResult.rows[0];
      if (row === undefined) {
        return null;
      }
      return {
        prompt: mapPromptVersion(row),
        history: historyResult.rows.map(mapPromptEvent),
      };
    },

    async create(principal, input) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `insert into prompt_registry (
             prompt_version, name, owner, description, status,
             created_by_subject, created_by_name
           ) values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            input.promptVersion,
            input.name,
            input.owner,
            input.description,
            input.status,
            principal.subject,
            principal.displayName,
          ],
        );
        await client.query(
          `insert into prompt_registry_events (
             prompt_version, event_type, actor_subject, actor_name,
             before_state, after_state
           ) values ($1, 'created', $2, $3, '{}'::jsonb, $4::jsonb)`,
          [
            input.promptVersion,
            principal.subject,
            principal.displayName,
            JSON.stringify({
              name: input.name,
              owner: input.owner,
              description: input.description,
              status: input.status,
            }),
          ],
        );
        const result = await client.query<PromptVersionRow>(
          `${promptVersionQuery()} where p.prompt_version = $1`,
          [input.promptVersion],
        );
        await client.query("commit");
        const row = result.rows[0];
        if (row === undefined) {
          throw new Error("Registered prompt version could not be loaded");
        }
        return mapPromptVersion(row);
      } catch (error) {
        await client.query("rollback");
        if (isUniqueViolation(error)) {
          throw new PromptVersionConflictError();
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async update(principal, promptVersion, input) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const existing = await client.query<PromptRegistryStateRow>(
          `select
             prompt_version, name, owner, description, status
           from prompt_registry
           where prompt_version = $1
           for update`,
          [promptVersion],
        );
        const before = existing.rows[0];
        if (before === undefined) {
          throw new PromptVersionNotFoundError();
        }
        const after = {
          name: input.name ?? before.name,
          owner: input.owner === undefined ? before.owner : input.owner,
          description:
            input.description === undefined
              ? before.description
              : input.description,
          status: input.status ?? before.status,
        };
        await client.query(
          `update prompt_registry set
             name = $2,
             owner = $3,
             description = $4,
             status = $5,
             updated_at = now()
           where prompt_version = $1`,
          [
            promptVersion,
            after.name,
            after.owner,
            after.description,
            after.status,
          ],
        );
        await client.query(
          `insert into prompt_registry_events (
             prompt_version, event_type, actor_subject, actor_name,
             before_state, after_state
           ) values ($1, 'updated', $2, $3, $4::jsonb, $5::jsonb)`,
          [
            promptVersion,
            principal.subject,
            principal.displayName,
            JSON.stringify(promptState(before)),
            JSON.stringify(after),
          ],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
      const detail = await this.get(promptVersion);
      if (detail === null) {
        throw new PromptVersionNotFoundError();
      }
      return detail;
    },
  };
}

function promptVersionQuery(): string {
  return `select
    p.prompt_version, p.name, p.owner, p.description, p.status,
    p.created_at, p.updated_at,
    (select count(*) from traces t
     where t.prompt_version = p.prompt_version)::integer as trace_count,
    (select count(distinct r.dataset_id)
     from dataset_items i
     join dataset_revisions r on r.id = i.dataset_revision_id
     where i.prompt_version = p.prompt_version)::integer as dataset_count,
    (select count(*) from evaluation_runs e
     where e.trace_selector->>'promptVersion' = p.prompt_version)
      ::integer as evaluation_count,
    (select max(t.start_time) from traces t
     where t.prompt_version = p.prompt_version) as last_seen_at
  from prompt_registry p`;
}

interface PromptVersionRow {
  prompt_version: string;
  name: string;
  owner: string | null;
  description: string | null;
  status: PromptRegistryStatus;
  created_at: Date;
  updated_at: Date;
  trace_count: number;
  dataset_count: number;
  evaluation_count: number;
  last_seen_at: Date | null;
}

interface ObservedPromptRow {
  prompt_version: string;
  trace_count: number;
  last_seen_at: Date | null;
}

interface PromptRegistryStateRow {
  prompt_version: string;
  name: string;
  owner: string | null;
  description: string | null;
  status: PromptRegistryStatus;
}

interface PromptRegistryEventRow {
  id: string;
  prompt_version: string;
  event_type: "created" | "updated";
  actor_name: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  created_at: Date;
}

function mapPromptVersion(row: PromptVersionRow): PromptVersionSummary {
  return {
    promptVersion: row.prompt_version,
    name: row.name,
    owner: row.owner,
    description: row.description,
    status: row.status,
    traceCount: row.trace_count,
    datasetCount: row.dataset_count,
    evaluationCount: row.evaluation_count,
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapPromptEvent(row: PromptRegistryEventRow): PromptRegistryEvent {
  return {
    eventId: row.id,
    promptVersion: row.prompt_version,
    eventType: row.event_type,
    actor: row.actor_name,
    before: row.before_state,
    after: row.after_state,
    createdAt: row.created_at.toISOString(),
  };
}

function promptState(row: PromptRegistryStateRow): Record<string, unknown> {
  return {
    name: row.name,
    owner: row.owner,
    description: row.description,
    status: row.status,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
