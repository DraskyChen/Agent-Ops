import { CircleX, History, Save, X } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  PromptRegistryEvent,
  PromptVersionDetail,
  PromptVersionSummary,
} from "@agent-ops/contracts";

import { fetchPromptVersion, updatePromptVersion } from "./api.js";

export function PromptMetadataDialog({
  promptVersion,
  onClose,
  onUpdated,
}: {
  promptVersion: string;
  onClose: () => void;
  onUpdated: (prompt: PromptVersionSummary) => void;
}) {
  const [detail, setDetail] = useState<PromptVersionDetail | null>(null);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"active" | "deprecated">("active");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchPromptVersion(promptVersion)
      .then((next) => {
        if (!active) {
          return;
        }
        applyDetail(next);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(message(loadError, "Unable to load prompt metadata"));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      active = false;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [promptVersion]);

  const applyDetail = (next: PromptVersionDetail) => {
    setDetail(next);
    setName(next.prompt.name);
    setOwner(next.prompt.owner ?? "");
    setDescription(next.prompt.description ?? "");
    setStatus(next.prompt.status);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await updatePromptVersion(promptVersion, {
        name,
        owner: owner.trim() === "" ? null : owner,
        description: description.trim() === "" ? null : description,
        status,
      });
      applyDetail(updated);
      onUpdated(updated.prompt);
      setError(null);
    } catch (saveError) {
      setError(message(saveError, "Unable to update prompt metadata"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="dataset-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <section
        className="dataset-dialog prompt-metadata-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-metadata-title"
      >
        <header className="dataset-dialog-header">
          <div>
            <span className="dataset-dialog-icon">
              <History size={17} />
            </span>
            <div>
              <h2 id="prompt-metadata-title">Prompt metadata</h2>
              <p>{promptVersion} · content remains read-only</p>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close prompt metadata"
            onClick={onClose}
            disabled={saving}
          >
            <X size={16} />
          </button>
        </header>

        {loading ? (
          <div className="detail-loading">Loading prompt metadata…</div>
        ) : detail === null ? null : (
          <div className="prompt-metadata-layout">
            <form className="entity-form prompt-metadata-form" onSubmit={submit}>
              {error === null ? null : (
                <div className="data-error" role="alert">
                  <CircleX size={15} />
                  {error}
                </div>
              )}
              <label className="entity-field">
                <span>Display name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  required
                />
              </label>
              <label className="entity-field">
                <span>Owner</span>
                <input
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  maxLength={120}
                  placeholder="Unassigned"
                />
              </label>
              <label className="entity-field">
                <span>Status</span>
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as "active" | "deprecated")
                  }
                >
                  <option value="active">Active</option>
                  <option value="deprecated">Deprecated</option>
                </select>
              </label>
              <label className="entity-field">
                <span>Description</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={4000}
                  rows={5}
                />
              </label>
              <div className="form-actions">
                <button
                  className="button secondary compact"
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                >
                  Close
                </button>
                <button
                  className="button primary compact"
                  type="submit"
                  disabled={saving || name.trim() === ""}
                >
                  <Save size={13} />
                  {saving ? "Saving…" : "Save metadata"}
                </button>
              </div>
            </form>

            <div className="prompt-history-panel">
              <div className="panel-heading">
                <div>
                  <History size={14} />
                  <div>
                    <strong>Metadata history</strong>
                    <small>Append-only lifecycle audit</small>
                  </div>
                </div>
              </div>
              <div className="prompt-history-list">
                {detail.history.map((event) => (
                  <PromptHistoryItem event={event} key={event.eventId} />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PromptHistoryItem({ event }: { event: PromptRegistryEvent }) {
  return (
    <article>
      <div>
        <strong>{event.eventType}</strong>
        <span>{event.actor}</span>
      </div>
      <small>{formatTimestamp(event.createdAt)}</small>
      <p>
        {stringValue(event.after.status)} ·{" "}
        {stringValue(event.after.owner) ?? "Unassigned"}
      </p>
    </article>
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
