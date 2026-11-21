import type { HealthResponse } from "@agent-ops/contracts";
import { useEffect, useState } from "react";

import { getJson } from "../../shared/http.js";

export interface HealthState {
  state: "checking" | "ok" | "unavailable";
  schemaVersion?: string;
}

export function useServerHealth(): HealthState {
  const [health, setHealth] = useState<HealthState>({ state: "checking" });

  useEffect(() => {
    let active = true;
    getJson<HealthResponse>("/healthz")
      .then((body) => {
        if (active) {
          setHealth({
            state: "ok",
            schemaVersion: body.schemaVersion,
          });
        }
      })
      .catch(() => {
        if (active) {
          setHealth({ state: "unavailable" });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return health;
}

export function healthLabel(health: HealthState): string {
  switch (health.state) {
    case "ok":
      return "Connected";
    case "unavailable":
      return "Unavailable";
    case "checking":
      return "Checking";
  }
}
