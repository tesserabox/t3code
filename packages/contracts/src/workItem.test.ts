import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ProjectId } from "./baseSchemas.ts";
import {
  WorkItemListInput,
  WorkItemListResult,
  WorkItemProviderErrorReason,
  WorkItemState,
  WorkItemUnavailableError,
} from "./workItem.ts";

const decodeListInput = Schema.decodeUnknownSync(WorkItemListInput);
const decodeListResult = Schema.decodeUnknownSync(WorkItemListResult);
const decodeWorkItemState = Schema.decodeUnknownSync(WorkItemState);
const decodeWorkItemProviderErrorReason = Schema.decodeUnknownSync(WorkItemProviderErrorReason);

const githubProjectId = ProjectId.make("project-github");
const azureProjectId = ProjectId.make("project-azure");

const LIST_RESULT: WorkItemListResult = {
  providers: [
    {
      host: "github.com",
      kind: "github",
      searchesOnHost: true,
      projectCount: 1,
      configured: true,
      detail: null,
    },
    {
      host: "dev.azure.com",
      kind: "azure-devops",
      searchesOnHost: true,
      projectCount: 1,
      configured: true,
      detail: null,
    },
  ],
  entries: [
    {
      projectId: githubProjectId,
      provider: "github",
      host: "github.com",
      containerId: "R_kgDOGitHub",
      number: 193,
      projectTitle: "t3code",
      kind: "issue",
      containerTitle: "tesseracode/t3code",
      repository: "tesseracode/t3code",
      title: "Add Copilot CLI support",
      url: "https://github.com/tesseracode/t3code/issues/193",
      state: "open",
      providerState: "OPEN",
      author: { login: "octocat", name: null, avatarUrl: null },
      labels: [{ name: "enhancement", color: "84b6eb" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    },
    {
      projectId: azureProjectId,
      provider: "azure-devops",
      host: "dev.azure.com",
      containerId: "azure-project-guid",
      number: 42,
      projectTitle: "Platform",
      kind: "work-item",
      containerTitle: "Platform",
      repository: null,
      title: "Ship remote agent attention",
      url: "https://dev.azure.com/example/Platform/_workitems/edit/42",
      state: "closed",
      providerState: "Resolved",
      author: { login: "user@example.com", name: "Example User", avatarUrl: null },
      labels: [{ name: "remote", color: null }],
      createdAt: null,
      updatedAt: "2026-01-03T00:00:00Z",
    },
  ],
  errors: [
    {
      projectId: ProjectId.make("project-unavailable"),
      projectTitle: "Unavailable",
      provider: "github",
      reason: "rate-limited",
      message: "GitHub rate limit reached.",
    },
  ],
  truncated: true,
  nextCursors: {
    "github.com R_kgDOGitHub": "cursor-github",
    "dev.azure.com azure-project-guid": "cursor-azure",
  },
};

describe("WorkItemListResult", () => {
  it("round-trips through the JSON codec used by future RPCs", () => {
    const codec = Schema.toCodecJson(WorkItemListResult);
    const decoded = Schema.decodeUnknownSync(codec)(Schema.encodeUnknownSync(codec)(LIST_RESULT));

    expect(decoded).toStrictEqual(LIST_RESULT);
  });

  it("decodes GitHub repository issues and Azure project work items together", () => {
    const decoded = decodeListResult(LIST_RESULT);

    expect(decoded.entries.map((entry) => [entry.provider, entry.kind, entry.repository])).toEqual([
      ["github", "issue", "tesseracode/t3code"],
      ["azure-devops", "work-item", null],
    ]);
    expect(decoded.errors).toHaveLength(1);
  });

  it("keeps multiple hosts of one provider as separate summaries", () => {
    const decoded = decodeListResult({
      ...LIST_RESULT,
      providers: [
        LIST_RESULT.providers[0],
        {
          ...LIST_RESULT.providers[0],
          host: "github.example.com",
        },
      ],
    });

    expect(decoded.providers.map((provider) => provider.host)).toEqual([
      "github.com",
      "github.example.com",
    ]);
  });

  it("rejects unsupported providers and impossible provider-kind-repository combinations", () => {
    const github = LIST_RESULT.entries[0];
    const azure = LIST_RESULT.entries[1];

    expect(github).toBeDefined();
    expect(azure).toBeDefined();
    if (!github || !azure) return;

    expect(() =>
      decodeListResult({
        ...LIST_RESULT,
        entries: [{ ...github, provider: "gitlab" }],
      }),
    ).toThrow();
    expect(() =>
      decodeListResult({
        ...LIST_RESULT,
        entries: [{ ...github, kind: "work-item" }],
      }),
    ).toThrow();
    expect(() =>
      decodeListResult({
        ...LIST_RESULT,
        entries: [{ ...github, repository: null }],
      }),
    ).toThrow();
    expect(() =>
      decodeListResult({
        ...LIST_RESULT,
        entries: [{ ...azure, repository: "example/repo" }],
      }),
    ).toThrow();
  });
});

describe("WorkItemListInput", () => {
  it("trims and bounds host-side search text", () => {
    expect(decodeListInput({ state: "open", query: "  remote attention  " }).query).toBe(
      "remote attention",
    );
    expect(decodeListInput({ state: "open", query: "q".repeat(200) }).query).toHaveLength(200);
    expect(() => decodeListInput({ state: "open", query: "q".repeat(201) })).toThrow();
  });

  it("bounds projects, rows, and opaque cursors", () => {
    expect(
      decodeListInput({
        state: "all",
        projectIds: Array.from({ length: 100 }, (_, index) => ProjectId.make(`project-${index}`)),
        limit: 500,
        cursors: { "github.com repo": "c".repeat(4096) },
      }).projectIds,
    ).toHaveLength(100);

    expect(() =>
      decodeListInput({
        state: "all",
        projectIds: Array.from({ length: 101 }, (_, index) => ProjectId.make(`project-${index}`)),
      }),
    ).toThrow();
    expect(() => decodeListInput({ state: "all", limit: 501 })).toThrow();
    expect(() =>
      decodeListInput({ state: "all", cursors: { "github.com repo": "c".repeat(4097) } }),
    ).toThrow();
  });
});

describe("work item enums", () => {
  it("keeps normalized state narrow while allowing provider-native context", () => {
    expect(decodeWorkItemState("closed")).toBe("closed");
    expect(() => decodeWorkItemState("resolved")).toThrow();
    expect(LIST_RESULT.entries[1]?.providerState).toBe("Resolved");
  });

  it("rejects unknown provider error reasons", () => {
    expect(decodeWorkItemProviderErrorReason("rate-limited")).toBe("rate-limited");
    expect(() => decodeWorkItemProviderErrorReason("forbidden")).toThrow();
  });

  it("derives unavailable messages from closed reasons instead of raw provider output", () => {
    const error = new WorkItemUnavailableError({
      reason: "unauthenticated",
      provider: "github",
      host: "github.com",
    });

    expect(error.message).toBe("The work-item provider has no working credentials.");
    expect(error).not.toHaveProperty("detail");
  });
});
