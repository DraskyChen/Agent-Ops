import {
  Activity,
  Braces,
  CircleX,
  Database,
  FlaskConical,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  PromptRegistryResponse,
  PromptVersionSummary,
} from "@agent-ops/contracts";

import { Metric } from "../traces/TracePrimitives.js";
import { PromptMetadataDialog } from "./PromptMetadataDialog.js";
import { createPromptVersion, fetchPromptRegistry } from "./api.js";

export function PromptsPage({
  canManage,
  onOpenPrompt,
}: {
  canManage: boolean;
  onOpenPrompt: (promptVersion: string) => void;
}) {
  const [registry, setRegistry] = useState<PromptRegistryResponse | null>(null);
  const [search, setSearch] = useState("");
  const [promptVersion, setPromptVersion] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managedPrompt, setManagedPrompt] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRegistry(await fetchPromptRegistry());
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load prompt registry",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const register = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await createPromptVersion({
        promptVersion,
        ...(name.trim() === "" ? {} : { name: name.trim() }),
        ...(owner.trim() === "" ? {} : { owner: owner.trim() }),
        ...(description.trim() === ""
          ? {}
          : { description: description.trim() }),
      });
      setPromptVersion("");
      setName("");
      setOwner("");
      setDescription("");
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to register prompt version",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const entries = (registry?.entries ?? []).filter((entry) =>
    matchesSearch(entry, search),
  );
  const unregistered = (registry?.observedUnregistered ?? []).filter(
    (entry) =>
      search.trim() === "" ||
      entry.promptVersion.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const totalTraces =
    registry?.entries.reduce((sum, entry) => sum + entry.traceCount, 0) ?? 0;
  const totalDatasets =
    registry?.entries.reduce((sum, entry) => sum + entry.datasetCount, 0) ?? 0;
  const totalEvaluations =
    registry?.entries.reduce(
      (sum, entry) => sum + entry.evaluationCount,
      0,
    ) ?? 0;

  return (
    <div className="page prompts-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Prompt versions</p>
          <h1>Prompts</h1>
          <p>
            Register immutable prompt metadata and trace its use across runs,
            datasets, and evaluations.
          </p>
        </div>
        <button
          className="button secondary compact"
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={14} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error === null ? null : (
        <div className="data-error" role="alert">
          <CircleX size={15} />
          {error}
        </div>
      )}

      <section className="metrics-strip prompt-kpis">
        <Metric
          icon={<Braces size={16} />}
          label="Registered versions"
          value={(registry?.entries.length ?? 0).toLocaleString()}
          detail="immutable metadata"
        />
        <Metric
          icon={<Activity size={16} />}
          label="Associated traces"
          value={totalTraces.toLocaleString()}
          detail="across registered versions"
        />
        <Metric
          icon={<Database size={16} />}
          label="Dataset links"
          value={totalDatasets.toLocaleString()}
          detail="dataset-version associations"
        />
        <Metric
          icon={<FlaskConical size={16} />}
          label="Evaluation links"
          value={totalEvaluations.toLocaleString()}
          detail="runs filtering this prompt"
        />
      </section>

      <section className="prompt-registry-layout">
        <aside className="prompt-register-panel">
          <div className="panel-heading">
            <div>
              <strong>Register prompt version</strong>
              <small>Metadata only; prompt content is not edited here</small>
            </div>
          </div>
          {canManage ? (
            <form className="entity-form prompt-register-form" onSubmit={register}>
              <Field label="Prompt version">
                <input
                  value={promptVersion}
                  onChange={(event) => setPromptVersion(event.target.value)}
                  placeholder="refund-v12"
                  maxLength={128}
                  required
                />
              </Field>
              <Field label="Display name">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Refund policy"
                  maxLength={120}
                />
              </Field>
              <Field label="Owner">
                <input
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  placeholder="Team or person"
                  maxLength={120}
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What changed, how to verify, or release context"
                  maxLength={4000}
                  rows={4}
                />
              </Field>
              <button
                className="button primary compact"
                type="submit"
                disabled={submitting || promptVersion.trim() === ""}
              >
                <Plus size={14} />
                {submitting ? "Registering…" : "Register version"}
              </button>
            </form>
          ) : (
            <p className="permission-note">
              Reviewer access is required to register prompt versions.
            </p>
          )}

          {unregistered.length === 0 ? null : (
            <div className="unregistered-prompts">
              <div className="form-heading">
                <strong>Observed but unregistered</strong>
                <small>Select one to prefill the registration form</small>
              </div>
              {unregistered.map((entry) => (
                <button
                  type="button"
                  key={entry.promptVersion}
                  onClick={() => {
                    setPromptVersion(entry.promptVersion);
                    setName(entry.promptVersion);
                    setOwner("");
                    setDescription("");
                  }}
                >
                  <span>
                    <strong>{entry.promptVersion}</strong>
                    <small>{entry.traceCount} traces observed</small>
                  </span>
                  <Plus size={13} />
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="prompt-registry-main">
          <div className="prompt-registry-toolbar">
            <label className="search-field">
              <Search size={15} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search version, name, owner, or description…"
                aria-label="Search prompt versions"
              />
            </label>
            <span>{entries.length} registered versions</span>
          </div>

          <div className="prompt-version-list">
            {loading && registry === null ? (
              <div className="detail-loading">Loading prompt registry…</div>
            ) : entries.length === 0 ? (
              <div className="prompt-registry-empty">
                <Braces size={22} />
                <strong>No registered prompt versions</strong>
                <span>
                  Register an observed version to start building traceability.
                </span>
              </div>
            ) : (
              entries.map((entry) => (
                <article
                  className="prompt-version-card"
                  key={entry.promptVersion}
                >
                  <button
                    className="prompt-version-open"
                    type="button"
                    onClick={() => onOpenPrompt(entry.promptVersion)}
                  >
                    <span className="prompt-version-heading">
                      <span>
                        <strong>{entry.name}</strong>
                        <code>{entry.promptVersion}</code>
                      </span>
                      <span className={`prompt-status ${entry.status}`}>
                        {entry.status}
                      </span>
                    </span>
                    <span className="prompt-version-description">
                      {entry.description ?? "No description"}
                    </span>
                    <span className="prompt-version-footer">
                      <span>{entry.owner ?? "Unassigned"}</span>
                      <span>{entry.traceCount} traces</span>
                      <span>{entry.datasetCount} datasets</span>
                      <span>{entry.evaluationCount} evaluations</span>
                      <span>
                        {entry.lastSeenAt === null
                          ? "never observed"
                          : `last seen ${formatDate(entry.lastSeenAt)}`}
                      </span>
                    </span>
                  </button>
                  {canManage ? (
                    <button
                      className="prompt-version-manage"
                      type="button"
                      onClick={() => setManagedPrompt(entry.promptVersion)}
                    >
                      <Settings2 size={13} />
                      Manage
                    </button>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>
      </section>
      {managedPrompt === null ? null : (
        <PromptMetadataDialog
          promptVersion={managedPrompt}
          onClose={() => setManagedPrompt(null)}
          onUpdated={(updated) => {
            setRegistry((current) =>
              current === null
                ? current
                : {
                    ...current,
                    entries: current.entries.map((entry) =>
                      entry.promptVersion === updated.promptVersion
                        ? updated
                        : entry,
                    ),
                  },
            );
          }}
        />
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="entity-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function matchesSearch(
  entry: PromptVersionSummary,
  search: string,
): boolean {
  const query = search.trim().toLowerCase();
  if (query === "") {
    return true;
  }
  return [entry.promptVersion, entry.name, entry.owner, entry.description]
    .filter((value): value is string => value !== null)
    .some((value) => value.toLowerCase().includes(query));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
