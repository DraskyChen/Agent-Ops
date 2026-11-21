import type { ApiErrorResponse } from "@agent-ops/contracts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      accept: "application/json",
    },
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await responseError(response, path);
  }
  return (await response.json()) as T;
}

export async function postJson<Response, Body>(
  path: string,
  body: Body,
): Promise<Response> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await responseError(response, path);
  }
  return (await response.json()) as Response;
}

export async function getText(path: string): Promise<string> {
  const response = await fetch(path, {
    headers: {
      accept: "text/plain, application/json, */*",
    },
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw await responseError(response, path);
  }
  return response.text();
}

async function responseError(
  response: Response,
  path: string,
): Promise<HttpError> {
  let body: Partial<ApiErrorResponse> = {};
  try {
    body = (await response.json()) as Partial<ApiErrorResponse>;
  } catch {
    // The status and path remain useful when the response is not JSON.
  }
  return new HttpError(
    response.status,
    typeof body.code === "string" ? body.code : null,
    typeof body.message === "string"
      ? body.message
      : `${path} failed with HTTP ${response.status}`,
  );
}
