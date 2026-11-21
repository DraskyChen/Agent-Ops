import { timingSafeEqual } from "node:crypto";

import type {
  IngestRequestAuthorizer,
  IngestRequestMetadata,
} from "../application/dependencies.js";

export function createIngestRequestAuthorizer(
  requiredToken: string | undefined,
): IngestRequestAuthorizer {
  if (requiredToken === undefined || requiredToken === "") {
    return () => true;
  }

  return (request: IngestRequestMetadata): boolean => {
    const authorization = request.authorization;
    const bearer =
      authorization?.startsWith("Bearer ") === true
        ? authorization.slice("Bearer ".length)
        : undefined;
    return (
      tokenEquals(bearer, requiredToken) ||
      tokenEquals(request.apiKey, requiredToken)
    );
  };
}

function tokenEquals(candidate: string | undefined, expected: string): boolean {
  if (candidate === undefined) {
    return false;
  }

  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}
