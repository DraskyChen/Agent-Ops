import { CircleX, FileText, ListChecks } from "lucide-react";
import { useEffect, useState } from "react";

import type { DatasetItem } from "@agent-ops/contracts";

import { fetchContentText } from "../../shared/content.js";

interface ContentState {
  text: string | null;
  error: string | null;
}

const EMPTY_CONTENT: ContentState = {
  text: null,
  error: null,
};

export function DatasetItemPreview({ item }: { item: DatasetItem }) {
  const [input, setInput] = useState<ContentState>(EMPTY_CONTENT);
  const [baseline, setBaseline] = useState<ContentState>(EMPTY_CONTENT);
  const [expected, setExpected] = useState<ContentState>(EMPTY_CONTENT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      loadContent(item.inputContentRef),
      loadContent(item.baselineOutputContentRef),
      loadContent(item.expectedOutputContentRef),
    ]).then(([nextInput, nextBaseline, nextExpected]) => {
      if (!active) {
        return;
      }
      setInput(nextInput);
      setBaseline(nextBaseline);
      setExpected(nextExpected);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [item.itemId]);

  return (
    <section className="dataset-item-workbench">
      <header className="dataset-item-heading">
        <div>
          <span className="eyebrow">Dataset case</span>
          <h3>{item.caseId}</h3>
          <p>
            {item.appName ?? "Unknown application"} ·{" "}
            {item.promptVersion ?? "No prompt version"} ·{" "}
            <code>{item.sourceTraceId}</code>
          </p>
        </div>
        <div className="dataset-item-tags">
          {item.taskType === null ? null : <span>{item.taskType}</span>}
          {item.model === null ? null : <span>{item.model}</span>}
          {item.environment === null ? null : (
            <span>{item.environment}</span>
          )}
        </div>
      </header>

      <div className="dataset-content-grid">
        <ContentPanel
          icon={<FileText size={14} />}
          label="Input snapshot"
          state={input}
          loading={loading}
          empty="No input content is available."
        />
        <ContentPanel
          icon={<FileText size={14} />}
          label="Baseline output"
          state={baseline}
          loading={loading}
          empty="No baseline output is available."
        />
        <ContentPanel
          icon={<ListChecks size={14} />}
          label="Expected output"
          state={expected}
          loading={loading}
          empty="No expected output was supplied."
        />
      </div>

      <div className="dataset-expected-behavior">
        <span>Expected behavior</span>
        <p>
          {item.expectedBehavior ??
            "No behavior guidance was supplied for this case."}
        </p>
      </div>
    </section>
  );
}

function ContentPanel({
  icon,
  label,
  state,
  loading,
  empty,
}: {
  icon: React.ReactNode;
  label: string;
  state: ContentState;
  loading: boolean;
  empty: string;
}) {
  return (
    <article className="dataset-content-panel">
      <header>
        {icon}
        <strong>{label}</strong>
      </header>
      {loading ? (
        <p className="dataset-content-state">Loading content…</p>
      ) : state.error === null ? (
        state.text === null ? (
          <p className="dataset-content-state">{empty}</p>
        ) : (
          <pre>{state.text}</pre>
        )
      ) : (
        <p className="dataset-content-error">
          <CircleX size={13} />
          {state.error}
        </p>
      )}
    </article>
  );
}

async function loadContent(contentId: string | null): Promise<ContentState> {
  if (contentId === null) {
    return EMPTY_CONTENT;
  }
  try {
    return {
      text: await fetchContentText(contentId),
      error: null,
    };
  } catch (error) {
    return {
      text: null,
      error: error instanceof Error ? error.message : "Content unavailable",
    };
  }
}
