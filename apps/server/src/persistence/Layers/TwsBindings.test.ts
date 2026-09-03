import {
  EnvironmentId,
  ProjectId,
  TwsFeatureBindingId,
  TwsStackNodeBindingId,
  TwsWorkspaceBindingId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { TwsBindingRepository } from "../Services/TwsBindings.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { TwsBindingRepositoryLive } from "./TwsBindings.ts";

const layer = it.layer(TwsBindingRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

const environmentId = EnvironmentId.make("environment-tws");
const workspaceId = TwsWorkspaceBindingId.make("workspace-binding-1");
const secondWorkspaceId = TwsWorkspaceBindingId.make("workspace-binding-2");
const featureId = TwsFeatureBindingId.make("feature-binding-1");
const secondFeatureId = TwsFeatureBindingId.make("feature-binding-2");
const firstProjectId = ProjectId.make("project-web");
const secondProjectId = ProjectId.make("project-api");
const seenAt = "2026-01-01T00:00:00Z";

const repositoryIdentity = {
  canonicalKey: "github.com/acme/web",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "git@github.com:acme/web.git",
  },
};

layer("TwsBindingRepository", (it) => {
  it.effect("round-trips a multi-project workspace and multi-repo feature", () =>
    Effect.gen(function* () {
      const repository = yield* TwsBindingRepository;

      yield* repository.upsertWorkspace({
        workspaceBindingId: workspaceId,
        environmentId,
        canonicalLocator: { kind: "stable-id", value: "workspace-stable-1" },
        locators: [
          { kind: "stable-id", value: "workspace-stable-1" },
          { kind: "registry-entry", value: "registry-1" },
          { kind: "path", value: "/workspaces/old" },
        ],
        repositoryIdentity,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        retiredAt: null,
      });
      for (const projectId of [firstProjectId, secondProjectId]) {
        yield* repository.upsertWorkspaceProject({
          environmentId,
          workspaceBindingId: workspaceId,
          projectId,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          retiredAt: null,
        });
      }
      yield* repository.upsertFeature({
        featureBindingId: featureId,
        workspaceBindingId: workspaceId,
        environmentId,
        canonicalLocator: { kind: "name", value: "remote-agents" },
        locators: [
          { kind: "name", value: "remote-agents" },
          { kind: "path", value: "/workspaces/old/.tws/features/remote-agents" },
        ],
        repositoryIdentity: null,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        retiredAt: null,
      });
      yield* repository.upsertStackNode({
        stackNodeBindingId: TwsStackNodeBindingId.make("stack-node-web"),
        featureBindingId: featureId,
        projectId: firstProjectId,
        gitBranch: "feature/remote-agents-web",
        worktreePath: "/worktrees/remote-agents-web",
        archived: false,
        environmentId,
        canonicalLocator: { kind: "git-branch", value: "feature/remote-agents-web" },
        locators: [
          { kind: "name", value: "web" },
          { kind: "git-branch", value: "feature/remote-agents-web" },
          { kind: "repository", value: "github.com/acme/web" },
        ],
        repositoryIdentity,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        retiredAt: null,
      });
      yield* repository.upsertStackNode({
        stackNodeBindingId: TwsStackNodeBindingId.make("stack-node-api"),
        featureBindingId: featureId,
        projectId: secondProjectId,
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
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        retiredAt: null,
      });

      assert.strictEqual(
        (yield* repository.listWorkspaceProjects({
          environmentId,
          workspaceBindingId: workspaceId,
        })).length,
        2,
      );
      const nodes = yield* repository.listStackNodes({
        environmentId,
        featureBindingId: featureId,
      });
      assert.deepEqual(
        nodes.map((node) => [node.projectId, node.archived, node.worktreePath]),
        [
          [secondProjectId, true, null],
          [firstProjectId, false, "/worktrees/remote-agents-web"],
        ],
      );
      assert.strictEqual(nodes[0]?.repositoryIdentity?.canonicalKey, "github.com/acme/api");

      const alternateMatch = yield* repository.findWorkspacesByLocator({
        environmentId,
        locator: { kind: "registry-entry", value: "registry-1" },
      });
      assert.deepEqual(
        alternateMatch.map((binding) => binding.workspaceBindingId),
        [workspaceId],
      );

      yield* repository.upsertWorkspace({
        ...alternateMatch[0]!,
        canonicalLocator: { kind: "path", value: "/workspaces/new" },
        locators: [{ kind: "path", value: "/workspaces/new" }, ...alternateMatch[0]!.locators],
        firstSeenAt: "2026-01-02T00:00:00Z",
        lastSeenAt: "2026-01-02T00:00:00Z",
      });
      const renamed = yield* repository.listWorkspaces({ environmentId });
      assert.strictEqual(renamed[0]?.workspaceBindingId, workspaceId);
      assert.strictEqual(renamed[0]?.canonicalLocator.value, "/workspaces/new");
      assert.strictEqual(renamed[0]?.firstSeenAt, seenAt);
    }),
  );

  it.effect("scopes equal feature names, filters retired rows, and deletes one subtree", () =>
    Effect.gen(function* () {
      const repository = yield* TwsBindingRepository;

      yield* repository.upsertWorkspace({
        workspaceBindingId: secondWorkspaceId,
        environmentId,
        canonicalLocator: { kind: "path", value: "/workspaces/second" },
        locators: [{ kind: "path", value: "/workspaces/second" }],
        repositoryIdentity: null,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        retiredAt: null,
      });
      yield* repository.upsertFeature({
        featureBindingId: secondFeatureId,
        workspaceBindingId: secondWorkspaceId,
        environmentId,
        canonicalLocator: { kind: "name", value: "remote-agents" },
        locators: [{ kind: "name", value: "remote-agents" }],
        repositoryIdentity: null,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        retiredAt: null,
      });

      const secondMatch = yield* repository.findFeaturesByLocator({
        environmentId,
        workspaceBindingId: secondWorkspaceId,
        locator: { kind: "name", value: "remote-agents" },
      });
      assert.deepEqual(
        secondMatch.map((binding) => binding.featureBindingId),
        [secondFeatureId],
      );

      yield* repository.upsertFeature({
        ...secondMatch[0]!,
        retiredAt: "2026-01-03T00:00:00Z",
      });
      assert.deepEqual(
        yield* repository.listFeatures({ environmentId, workspaceBindingId: secondWorkspaceId }),
        [],
      );
      assert.strictEqual(
        (yield* repository.listFeatures({
          environmentId,
          workspaceBindingId: secondWorkspaceId,
          includeRetired: true,
        })).length,
        1,
      );

      yield* repository.deleteWorkspace({ environmentId, workspaceBindingId: workspaceId });
      assert.deepEqual(yield* repository.listWorkspaces({ environmentId }), [
        {
          workspaceBindingId: secondWorkspaceId,
          environmentId,
          canonicalLocator: { kind: "path", value: "/workspaces/second" },
          locators: [{ kind: "path", value: "/workspaces/second" }],
          repositoryIdentity: null,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          retiredAt: null,
        },
      ]);
      assert.deepEqual(
        yield* repository.listWorkspaceProjects({
          environmentId,
          workspaceBindingId: workspaceId,
          includeRetired: true,
        }),
        [],
      );
      assert.deepEqual(
        yield* repository.listFeatures({
          environmentId,
          workspaceBindingId: workspaceId,
          includeRetired: true,
        }),
        [],
      );
      assert.deepEqual(
        yield* repository.listStackNodes({
          environmentId,
          featureBindingId: featureId,
          includeRetired: true,
        }),
        [],
      );
    }),
  );

  it.effect("scopes IDs, parent constraints, and deletion by environment", () =>
    Effect.gen(function* () {
      const repository = yield* TwsBindingRepository;
      const firstEnvironment = EnvironmentId.make("environment-scope-1");
      const secondEnvironment = EnvironmentId.make("environment-scope-2");
      const sharedWorkspaceId = TwsWorkspaceBindingId.make("workspace-shared-id");

      for (const [scopedEnvironmentId, path] of [
        [firstEnvironment, "/workspaces/first"],
        [secondEnvironment, "/workspaces/second"],
      ] as const) {
        yield* repository.upsertWorkspace({
          workspaceBindingId: sharedWorkspaceId,
          environmentId: scopedEnvironmentId,
          canonicalLocator: { kind: "path", value: path },
          locators: [{ kind: "path", value: path }],
          repositoryIdentity: null,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          retiredAt: null,
        });
      }

      assert.strictEqual(
        (yield* repository.listWorkspaces({ environmentId: firstEnvironment })).length,
        1,
      );
      assert.strictEqual(
        (yield* repository.listWorkspaces({ environmentId: secondEnvironment })).length,
        1,
      );

      const invalidParent = yield* repository
        .upsertFeature({
          featureBindingId: TwsFeatureBindingId.make("feature-invalid-parent"),
          workspaceBindingId: TwsWorkspaceBindingId.make("workspace-missing"),
          environmentId: firstEnvironment,
          canonicalLocator: { kind: "name", value: "invalid" },
          locators: [{ kind: "name", value: "invalid" }],
          repositoryIdentity: null,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          retiredAt: null,
        })
        .pipe(Effect.flip);
      assert.strictEqual(invalidParent._tag, "PersistenceSqlError");

      yield* repository.deleteWorkspace({
        environmentId: firstEnvironment,
        workspaceBindingId: sharedWorkspaceId,
      });
      assert.deepEqual(yield* repository.listWorkspaces({ environmentId: firstEnvironment }), []);
      assert.strictEqual(
        (yield* repository.listWorkspaces({ environmentId: secondEnvironment })).length,
        1,
      );
    }),
  );

  it.effect("uses list indexes without temporary sort trees", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const plans = [
        yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT workspace_binding_id
          FROM tws_workspace_bindings
          WHERE environment_id = 'environment'
            AND retired_at IS NULL
          ORDER BY last_seen_at DESC, workspace_binding_id ASC
          LIMIT 100
        `,
        yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT project_id
          FROM tws_workspace_project_bindings
          WHERE environment_id = 'environment'
            AND workspace_binding_id = 'workspace'
            AND retired_at IS NULL
          ORDER BY last_seen_at DESC, project_id ASC
          LIMIT 100
        `,
        yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT feature_binding_id
          FROM tws_feature_bindings
          WHERE environment_id = 'environment'
            AND workspace_binding_id = 'workspace'
            AND retired_at IS NULL
          ORDER BY last_seen_at DESC, feature_binding_id ASC
          LIMIT 100
        `,
        yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT stack_node_binding_id
          FROM tws_stack_node_bindings
          WHERE environment_id = 'environment'
            AND feature_binding_id = 'feature'
            AND retired_at IS NULL
          ORDER BY last_seen_at DESC, stack_node_binding_id ASC
          LIMIT 100
        `,
      ];

      for (const plan of plans) {
        assert.isFalse(plan.some((row) => row.detail.includes("USE TEMP B-TREE")));
      }
    }),
  );
});
