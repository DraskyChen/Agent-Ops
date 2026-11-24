import type {
  PromptRegistryResponse,
  PromptRegistryStatus,
  PromptVersionCreateRequest,
  PromptVersionDetail,
  PromptVersionSummary,
  PromptVersionUpdateRequest,
} from "@agent-ops/contracts";

import type { HumanPrincipal } from "./auth.js";

export interface NormalizedPromptVersion {
  promptVersion: string;
  name: string;
  owner: string | null;
  description: string | null;
  status: PromptRegistryStatus;
}

export interface NormalizedPromptVersionUpdate {
  name?: string;
  owner?: string | null;
  description?: string | null;
  status?: PromptRegistryStatus;
}

export interface PromptRegistryRepository {
  list(): Promise<PromptRegistryResponse>;
  get(promptVersion: string): Promise<PromptVersionDetail | null>;
  create(
    principal: HumanPrincipal,
    input: NormalizedPromptVersion,
  ): Promise<PromptVersionSummary>;
  update(
    principal: HumanPrincipal,
    promptVersion: string,
    input: NormalizedPromptVersionUpdate,
  ): Promise<PromptVersionDetail>;
}

export interface PromptRegistryService {
  list(): Promise<PromptRegistryResponse>;
  get(promptVersion: string): Promise<PromptVersionDetail | null>;
  create(
    principal: HumanPrincipal,
    input: PromptVersionCreateRequest,
  ): Promise<PromptVersionSummary>;
  update(
    principal: HumanPrincipal,
    promptVersion: string,
    input: PromptVersionUpdateRequest,
  ): Promise<PromptVersionDetail>;
}

export class PromptRegistryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptRegistryValidationError";
  }
}

export class PromptVersionConflictError extends Error {
  constructor() {
    super("This prompt version is already registered");
    this.name = "PromptVersionConflictError";
  }
}

export class PromptVersionNotFoundError extends Error {
  constructor() {
    super("Prompt version not found");
    this.name = "PromptVersionNotFoundError";
  }
}

const PROMPT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function createPromptRegistryService(
  repository: PromptRegistryRepository,
): PromptRegistryService {
  return {
    list() {
      return repository.list();
    },
    get(promptVersion) {
      const normalized = normalizePromptVersion(promptVersion);
      return repository.get(normalized);
    },
    create(principal, input) {
      if (typeof input !== "object" || input === null) {
        throw new PromptRegistryValidationError(
          "Request body must be an object",
        );
      }
      const promptVersion = requiredText(
        input.promptVersion,
        "promptVersion",
        128,
      );
      if (!PROMPT_VERSION_PATTERN.test(promptVersion)) {
        throw new PromptRegistryValidationError(
          "promptVersion contains unsupported characters",
        );
      }
      const name = optionalText(input.name, "name", 120) ?? promptVersion;
      const owner =
        optionalText(input.owner, "owner", 120) ?? principal.displayName;
      const description = optionalText(
        input.description,
        "description",
        4000,
      );
      const status = input.status ?? "active";
      if (status !== "active" && status !== "deprecated") {
        throw new PromptRegistryValidationError(
          "status must be active or deprecated",
        );
      }
      return repository.create(principal, {
        promptVersion,
        name,
        owner,
        description,
        status,
      });
    },
    update(principal, promptVersion, input) {
      const normalizedVersion = normalizePromptVersion(promptVersion);
      const normalized = normalizeUpdate(input);
      return repository.update(principal, normalizedVersion, normalized);
    },
  };
}

function normalizePromptVersion(value: string): string {
  const normalized = requiredText(value, "promptVersion", 128);
  if (!PROMPT_VERSION_PATTERN.test(normalized)) {
    throw new PromptRegistryValidationError(
      "promptVersion contains unsupported characters",
    );
  }
  return normalized;
}

function normalizeUpdate(
  input: PromptVersionUpdateRequest,
): NormalizedPromptVersionUpdate {
  if (typeof input !== "object" || input === null) {
    throw new PromptRegistryValidationError(
      "Request body must be an object",
    );
  }
  const update: NormalizedPromptVersionUpdate = {};
  if (input.name !== undefined) {
    update.name = requiredText(input.name, "name", 120);
  }
  if (input.owner !== undefined) {
    update.owner = nullableText(input.owner, "owner", 120);
  }
  if (input.description !== undefined) {
    update.description = nullableText(
      input.description,
      "description",
      4000,
    );
  }
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "deprecated") {
      throw new PromptRegistryValidationError(
        "status must be active or deprecated",
      );
    }
    update.status = input.status;
  }
  if (Object.keys(update).length === 0) {
    throw new PromptRegistryValidationError(
      "At least one metadata field must be updated",
    );
  }
  return update;
}

function requiredText(
  value: string | undefined,
  name: string,
  maxLength: number,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "" || normalized.length > maxLength) {
    throw new PromptRegistryValidationError(
      `${name} must be 1-${maxLength} characters`,
    );
  }
  return normalized;
}

function optionalText(
  value: string | undefined,
  name: string,
  maxLength: number,
): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new PromptRegistryValidationError(`${name} must be text`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new PromptRegistryValidationError(
      `${name} must be at most ${maxLength} characters`,
    );
  }
  return normalized === "" ? null : normalized;
}

function nullableText(
  value: string | null,
  name: string,
  maxLength: number,
): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new PromptRegistryValidationError(`${name} must be text`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new PromptRegistryValidationError(
      `${name} must be at most ${maxLength} characters`,
    );
  }
  return normalized === "" ? null : normalized;
}
