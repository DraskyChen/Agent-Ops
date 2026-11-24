import { Check, Clipboard, Download, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import type { TraceSpanView } from "./model.js";

export function SpanContentActions({
  traceId,
  span,
  tab,
  content,
  downloadable,
}: {
  traceId: string;
  span: TraceSpanView;
  tab: "input" | "output";
  content: string;
  downloadable: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmDownload, setConfirmDownload] = useState(false);

  if (!downloadable) {
    return null;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([content], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = [
      traceId,
      safeFilePart(span.name),
      tab,
    ].join("-") + ".txt";
    anchor.click();
    URL.revokeObjectURL(url);
    setConfirmDownload(false);
  };

  return (
    <>
      <div className="span-content-actions">
        <button type="button" onClick={() => void copy()}>
          {copied ? <Check size={12} /> : <Clipboard size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => setConfirmDownload(true)}>
          <Download size={12} />
          Download
        </button>
      </div>
      {confirmDownload ? (
        <div
          className="dataset-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmDownload(false);
            }
          }}
        >
          <section
            className="dataset-dialog content-download-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="content-download-title"
          >
            <header className="dataset-dialog-header">
              <div>
                <span className="dataset-dialog-icon">
                  <ShieldCheck size={17} />
                </span>
                <div>
                  <h2 id="content-download-title">Download captured content</h2>
                  <p>
                    {span.name} · {tab} · {content.length.toLocaleString()} chars
                  </p>
                </div>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close download confirmation"
                onClick={() => setConfirmDownload(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="content-download-body">
              <p>
                This content was accessed through the audited content endpoint.
                The downloaded file leaves Agent Ops access controls and should
                be stored according to the captured data retention policy.
              </p>
              <div className="form-actions">
                <button
                  className="button secondary compact"
                  type="button"
                  onClick={() => setConfirmDownload(false)}
                >
                  Cancel
                </button>
                <button
                  className="button primary compact"
                  type="button"
                  onClick={download}
                >
                  <Download size={13} />
                  Download file
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function safeFilePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "span"
  );
}
