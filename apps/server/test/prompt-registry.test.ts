import { describe, expect, it, vi } from "vitest";

import type { HumanPrincipal } from "../src/application/auth.js";
import {
  PromptRegistryValidationError,
  createPromptRegistryService,
  type PromptRegistryRepository,
} from "../src/application/prompt-registry.js";

const principal: HumanPrincipal = {
  subject: "reviewer-1",
  displayName: "Reviewer One",
  email: null,
  role: "reviewer",
};

describe("prompt registry service", () => {
  it("lists registry entries and observed unregistered versions", async () => {
    const response = {
      entries: [],
      observedUnregistered: [
        {
          promptVersion: "refund-v12",
          traceCount: 2,
          lastSeenAt: "2026-11-24T10:00:00.000Z",
        },
      ],
    };
    const list = vi.fn().mockResolvedValue(response);
    const prompts = createPromptRegistryService(repository({ list }));

    await expect(prompts.list()).resolves.toEqual(response);
    expect(list).toHaveBeenCalledOnce();
  });

  it("normalizes metadata while keeping prompt content out of the registry", async () => {
    const create = vi.fn().mockImplementation(async (_principal, input) => ({
      ...input,
      traceCount: 0,
      datasetCount: 0,
      evaluationCount: 0,
      lastSeenAt: null,
      createdAt: "2026-11-24T10:00:00.000Z",
      updatedAt: "2026-11-24T10:00:00.000Z",
    }));
    const prompts = createPromptRegistryService(repository({ create }));

    await prompts.create(principal, {
      promptVersion: " refund-v12 ",
      name: " Refund policy ",
      description: " Versioned policy prompt ",
    });

    expect(create).toHaveBeenCalledWith(principal, {
      promptVersion: "refund-v12",
      name: "Refund policy",
      owner: "Reviewer One",
      description: "Versioned policy prompt",
      status: "active",
    });
  });

  it("rejects malformed prompt versions", () => {
    const prompts = createPromptRegistryService(repository());
    expect(() =>
      prompts.create(principal, {
        promptVersion: "invalid version",
      }),
    ).toThrow(PromptRegistryValidationError);
  });

  it("normalizes lifecycle metadata updates", async () => {
    const update = vi.fn().mockResolvedValue({
      prompt: {
        promptVersion: "refund-v12",
        name: "Refund policy",
        owner: null,
        description: "Deprecated after replacement",
        status: "deprecated",
        traceCount: 9,
        datasetCount: 1,
        evaluationCount: 2,
        lastSeenAt: null,
        createdAt: "2026-11-24T10:00:00.000Z",
        updatedAt: "2026-11-24T11:00:00.000Z",
      },
      history: [],
    });
    const prompts = createPromptRegistryService(repository({ update }));

    await prompts.update(principal, "refund-v12", {
      owner: null,
      description: " Deprecated after replacement ",
      status: "deprecated",
    });

    expect(update).toHaveBeenCalledWith(principal, "refund-v12", {
      owner: null,
      description: "Deprecated after replacement",
      status: "deprecated",
    });
  });
});

function repository(
  overrides: Partial<PromptRegistryRepository> = {},
): PromptRegistryRepository {
  return {
    list: async () => ({ entries: [], observedUnregistered: [] }),
    get: async () => null,
    create: async (_principal, input) => ({
      ...input,
      traceCount: 0,
      datasetCount: 0,
      evaluationCount: 0,
      lastSeenAt: null,
      createdAt: "2026-11-24T10:00:00.000Z",
      updatedAt: "2026-11-24T10:00:00.000Z",
    }),
    update: async (_principal, promptVersion, input) => ({
      prompt: {
        promptVersion,
        name: input.name ?? "prompt",
        owner: input.owner ?? null,
        description: input.description ?? null,
        status: input.status ?? "active",
        traceCount: 0,
        datasetCount: 0,
        evaluationCount: 0,
        lastSeenAt: null,
        createdAt: "2026-11-24T10:00:00.000Z",
        updatedAt: "2026-11-24T10:00:00.000Z",
      },
      history: [],
    }),
    ...overrides,
  };
}
