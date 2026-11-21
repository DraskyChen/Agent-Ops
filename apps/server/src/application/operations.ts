import type { IngestHealthResponse } from "@agent-ops/contracts";

export interface OperationsRepository {
  ingestHealth(windowHours: number): Promise<IngestHealthResponse>;
}

export interface OperationsService {
  ingestHealth(windowHours?: number): Promise<IngestHealthResponse>;
}

export class InvalidOperationsQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationsQueryError";
  }
}

export function createOperationsService(
  repository: OperationsRepository,
  now: () => Date = () => new Date(),
): OperationsService {
  return {
    async ingestHealth(windowHours = 24) {
      if (
        !Number.isInteger(windowHours) ||
        windowHours < 1 ||
        windowHours > 168
      ) {
        throw new InvalidOperationsQueryError(
          "windowHours must be an integer from 1 to 168",
        );
      }
      return repository.ingestHealth(windowHours).then((response) => ({
        ...response,
        generatedAt: now().toISOString(),
      }));
    },
  };
}
