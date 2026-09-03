import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ProjectId } from "./baseSchemas.ts";
import {
  TWS_BINDING_MAX_LOCATOR_LENGTH,
  TWS_BINDING_MAX_LOCATORS,
  TwsFeatureBinding,
  TwsStackNodeBinding,
  TwsWorkspaceBinding,
  TwsWorkspaceBindingId,
  TwsWorkspaceProjectBinding,
} from "./twsBindings.ts";

const decodeWorkspace = Schema.decodeUnknownSync(TwsWorkspaceBinding);
const decodeFeature = Schema.decodeUnknownSync(TwsFeatureBinding);
const decodeStackNode = Schema.decodeUnknownSync(TwsStackNodeBinding);
const decodeWorkspaceProject = Schema.decodeUnknownSync(TwsWorkspaceProjectBinding);
const decodeWorkspaceId = Schema.decodeUnknownSync(TwsWorkspaceBindingId);

const environmentId = EnvironmentId.make("environment-1");
const workspaceBindingId = TwsWorkspaceBindingId.make("workspace-binding-1");
const repositoryIdentity = {
  canonicalKey: "github.com/acme/web",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "git@github.com:acme/web.git",
  },
};

describe("TWS binding contracts", () => {
  it("round-trips workspace, feature, project, and multi-repo stack-node bindings", () => {
    const workspace = decodeWorkspace({
      workspaceBindingId,
      environmentId,
      canonicalLocator: { kind: "stable-id", value: "workspace-stable-id" },
      locators: [
        { kind: "stable-id", value: "workspace-stable-id" },
        { kind: "registry-entry", value: "registry-entry-1" },
        { kind: "path", value: "/workspaces/acme" },
      ],
      repositoryIdentity,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-02T00:00:00Z",
      retiredAt: null,
    });
    const project = decodeWorkspaceProject({
      environmentId,
      workspaceBindingId,
      projectId: ProjectId.make("project-web"),
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-02T00:00:00Z",
      retiredAt: null,
    });
    const feature = decodeFeature({
      featureBindingId: "feature-binding-1",
      workspaceBindingId,
      environmentId,
      canonicalLocator: { kind: "name", value: "remote-agents" },
      locators: [
        { kind: "name", value: "remote-agents" },
        { kind: "path", value: "/workspaces/acme/.tws/features/remote-agents" },
      ],
      repositoryIdentity: null,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-02T00:00:00Z",
      retiredAt: null,
    });
    const node = decodeStackNode({
      stackNodeBindingId: "stack-node-binding-1",
      featureBindingId: feature.featureBindingId,
      projectId: project.projectId,
      gitBranch: "feature/remote-agents-api",
      worktreePath: null,
      archived: true,
      environmentId,
      canonicalLocator: { kind: "git-branch", value: "feature/remote-agents-api" },
      locators: [
        { kind: "name", value: "api" },
        { kind: "git-branch", value: "feature/remote-agents-api" },
        { kind: "repository", value: "github.com/acme/api" },
      ],
      repositoryIdentity: {
        ...repositoryIdentity,
        canonicalKey: "github.com/acme/api",
        locator: {
          ...repositoryIdentity.locator,
          remoteUrl: "git@github.com:acme/api.git",
        },
      },
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-02T00:00:00Z",
      retiredAt: null,
    });

    const codec = Schema.toCodecJson(TwsStackNodeBinding);
    expect(Schema.decodeUnknownSync(codec)(Schema.encodeUnknownSync(codec)(node))).toStrictEqual(
      node,
    );
    expect(workspace.workspaceBindingId).toBe(workspaceBindingId);
    expect(feature.workspaceBindingId).toBe(workspaceBindingId);
    expect(node.repositoryIdentity?.canonicalKey).toBe("github.com/acme/api");
  });

  it("rejects empty IDs and unbounded locator collections", () => {
    expect(() => decodeWorkspaceId("")).toThrow();
    expect(() =>
      decodeWorkspace({
        workspaceBindingId,
        environmentId,
        canonicalLocator: { kind: "path", value: "/workspace" },
        locators: [],
        repositoryIdentity: null,
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-01T00:00:00Z",
        retiredAt: null,
      }),
    ).toThrow();
    expect(() =>
      decodeWorkspace({
        workspaceBindingId,
        environmentId,
        canonicalLocator: { kind: "path", value: "/workspace" },
        locators: Array.from({ length: TWS_BINDING_MAX_LOCATORS + 1 }, (_, index) => ({
          kind: "name",
          value: `alias-${index}`,
        })),
        repositoryIdentity: null,
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-01T00:00:00Z",
        retiredAt: null,
      }),
    ).toThrow();
    expect(() =>
      decodeWorkspace({
        workspaceBindingId,
        environmentId,
        canonicalLocator: { kind: "path", value: "/workspace" },
        locators: [{ kind: "path", value: "x".repeat(TWS_BINDING_MAX_LOCATOR_LENGTH + 1) }],
        repositoryIdentity: null,
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-01T00:00:00Z",
        retiredAt: null,
      }),
    ).toThrow();
  });
});
