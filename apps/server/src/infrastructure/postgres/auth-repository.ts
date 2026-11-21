import type { Pool } from "pg";

import type {
  HumanAuthRepository,
  HumanSessionRecord,
  LoginStateRecord,
} from "../../application/auth.js";

export function createPostgresHumanAuthRepository(
  pool: Pool,
): HumanAuthRepository {
  return {
    async saveLoginState(stateHash, record) {
      await pool.query(
        `insert into auth_login_states (
          state_hash, code_verifier, nonce, return_to, expires_at, created_at
        ) values ($1, $2, $3, $4, $5, now())`,
        [
          stateHash,
          record.codeVerifier,
          record.nonce,
          record.returnTo,
          record.expiresAt,
        ],
      );
    },

    async consumeLoginState(stateHash, now) {
      const result = await pool.query<LoginStateRow>(
        `delete from auth_login_states
         where state_hash = $1 and expires_at > $2
         returning code_verifier, nonce, return_to, expires_at`,
        [stateHash, now],
      );
      return mapLoginState(result.rows[0]);
    },

    async saveSession(sessionHash, record) {
      await pool.query(
        `insert into auth_sessions (
          session_hash, subject, display_name, email, role, expires_at, created_at
        ) values ($1, $2, $3, $4, $5, $6, now())`,
        [
          sessionHash,
          record.principal.subject,
          record.principal.displayName,
          record.principal.email,
          record.principal.role,
          record.expiresAt,
        ],
      );
    },

    async findSession(sessionHash, now) {
      const result = await pool.query<SessionRow>(
        `select subject, display_name, email, role, expires_at
         from auth_sessions
         where session_hash = $1 and expires_at > $2`,
        [sessionHash, now],
      );
      return mapSession(result.rows[0]);
    },

    async deleteSession(sessionHash) {
      await pool.query("delete from auth_sessions where session_hash = $1", [
        sessionHash,
      ]);
    },

    async deleteExpired(now) {
      await Promise.all([
        pool.query("delete from auth_sessions where expires_at <= $1", [now]),
        pool.query("delete from auth_login_states where expires_at <= $1", [
          now,
        ]),
      ]);
    },
  };
}

interface LoginStateRow {
  code_verifier: string;
  nonce: string;
  return_to: string;
  expires_at: Date;
}

interface SessionRow {
  subject: string;
  display_name: string;
  email: string | null;
  role: string;
  expires_at: Date;
}

function mapLoginState(row: LoginStateRow | undefined): LoginStateRecord | null {
  return row === undefined
    ? null
    : {
        codeVerifier: row.code_verifier,
        nonce: row.nonce,
        returnTo: row.return_to,
        expiresAt: row.expires_at,
      };
}

function mapSession(row: SessionRow | undefined): HumanSessionRecord | null {
  if (row === undefined) {
    return null;
  }
  return {
    principal: {
      subject: row.subject,
      displayName: row.display_name,
      email: row.email,
      role:
        row.role === "reviewer" || row.role === "admin"
          ? row.role
          : "viewer",
    },
    expiresAt: row.expires_at,
  };
}
