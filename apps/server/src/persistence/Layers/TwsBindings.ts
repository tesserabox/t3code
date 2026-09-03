import {
  EnvironmentId,
  IsoDateTime,
  ProjectId,
  RepositoryIdentity,
  TrimmedNonEmptyString,
  TwsFeatureBinding,
  TwsFeatureBindingId,
  TwsLocator,
  TwsLocators,
  TwsStackNodeBinding,
  TwsStackNodeBindingId,
  TwsWorkspaceBinding,
  TwsWorkspaceBindingId,
  TwsWorkspaceProjectBinding,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  FindTwsFeatureByLocatorInput,
  FindTwsStackNodeByLocatorInput,
  FindTwsWorkspaceByLocatorInput,
  ListTwsFeaturesInput,
  ListTwsProjectWorkspacesInput,
  ListTwsStackNodesInput,
  ListTwsWorkspaceProjectsInput,
  ListTwsWorkspacesInput,
  TwsBindingRepository,
  type TwsBindingRepositoryShape,
} from "../Services/TwsBindings.ts";

const DEFAULT_BINDING_QUERY_LIMIT = 100;
const MAX_BINDING_QUERY_LIMIT = 500;

const RepositoryIdentityJson = Schema.NullOr(Schema.fromJsonString(RepositoryIdentity));
const TwsLocatorJson = Schema.fromJsonString(TwsLocator);
const TwsLocatorsJson = Schema.fromJsonString(TwsLocators);

const TwsWorkspaceBindingDbRow = Schema.Struct({
  workspaceBindingId: TwsWorkspaceBindingId,
  environmentId: EnvironmentId,
  canonicalLocator: TwsLocatorJson,
  locators: TwsLocatorsJson,
  repositoryIdentity: RepositoryIdentityJson,
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  retiredAt: Schema.NullOr(IsoDateTime),
});

const TwsWorkspaceProjectBindingDbRow = TwsWorkspaceProjectBinding;

const TwsFeatureBindingDbRow = Schema.Struct({
  featureBindingId: TwsFeatureBindingId,
  workspaceBindingId: TwsWorkspaceBindingId,
  environmentId: EnvironmentId,
  canonicalLocator: TwsLocatorJson,
  locators: TwsLocatorsJson,
  repositoryIdentity: RepositoryIdentityJson,
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  retiredAt: Schema.NullOr(IsoDateTime),
});

const TwsStackNodeBindingDbRow = Schema.Struct({
  stackNodeBindingId: TwsStackNodeBindingId,
  featureBindingId: TwsFeatureBindingId,
  projectId: Schema.NullOr(ProjectId),
  gitBranch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  archived: Schema.Literals([0, 1]),
  environmentId: EnvironmentId,
  canonicalLocator: TwsLocatorJson,
  locators: TwsLocatorsJson,
  repositoryIdentity: RepositoryIdentityJson,
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  retiredAt: Schema.NullOr(IsoDateTime),
});

const decodeStackNodeBinding = Schema.decodeUnknownEffect(TwsStackNodeBinding);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function queryLimit(limit: number | undefined): number {
  return Math.min(limit ?? DEFAULT_BINDING_QUERY_LIMIT, MAX_BINDING_QUERY_LIMIT);
}

const makeTwsBindingRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const retiredFilter = (includeRetired: boolean | undefined) =>
    includeRetired ? sql`1 = 1` : sql`retired_at IS NULL`;

  const upsertWorkspaceRow = SqlSchema.void({
    Request: TwsWorkspaceBinding,
    execute: (binding) =>
      sql`
        INSERT INTO tws_workspace_bindings (
          workspace_binding_id,
          environment_id,
          canonical_locator_kind,
          canonical_locator_value,
          locators_json,
          repository_identity_json,
          first_seen_at,
          last_seen_at,
          retired_at
        )
        VALUES (
          ${binding.workspaceBindingId},
          ${binding.environmentId},
          ${binding.canonicalLocator.kind},
          ${binding.canonicalLocator.value},
          ${JSON.stringify(binding.locators)},
          ${
            binding.repositoryIdentity === null ? null : JSON.stringify(binding.repositoryIdentity)
          },
          ${binding.firstSeenAt},
          ${binding.lastSeenAt},
          ${binding.retiredAt}
        )
        ON CONFLICT (environment_id, workspace_binding_id)
        DO UPDATE SET
          canonical_locator_kind = excluded.canonical_locator_kind,
          canonical_locator_value = excluded.canonical_locator_value,
          locators_json = excluded.locators_json,
          repository_identity_json = excluded.repository_identity_json,
          first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
          last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
          retired_at = excluded.retired_at
      `,
  });

  const upsertWorkspaceProjectRow = SqlSchema.void({
    Request: TwsWorkspaceProjectBinding,
    execute: (binding) =>
      sql`
        INSERT INTO tws_workspace_project_bindings (
          environment_id,
          workspace_binding_id,
          project_id,
          first_seen_at,
          last_seen_at,
          retired_at
        )
        VALUES (
          ${binding.environmentId},
          ${binding.workspaceBindingId},
          ${binding.projectId},
          ${binding.firstSeenAt},
          ${binding.lastSeenAt},
          ${binding.retiredAt}
        )
        ON CONFLICT (environment_id, workspace_binding_id, project_id)
        DO UPDATE SET
          first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
          last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
          retired_at = excluded.retired_at
      `,
  });

  const upsertFeatureRow = SqlSchema.void({
    Request: TwsFeatureBinding,
    execute: (binding) =>
      sql`
        INSERT INTO tws_feature_bindings (
          feature_binding_id,
          environment_id,
          workspace_binding_id,
          canonical_locator_kind,
          canonical_locator_value,
          locators_json,
          repository_identity_json,
          first_seen_at,
          last_seen_at,
          retired_at
        )
        VALUES (
          ${binding.featureBindingId},
          ${binding.environmentId},
          ${binding.workspaceBindingId},
          ${binding.canonicalLocator.kind},
          ${binding.canonicalLocator.value},
          ${JSON.stringify(binding.locators)},
          ${
            binding.repositoryIdentity === null ? null : JSON.stringify(binding.repositoryIdentity)
          },
          ${binding.firstSeenAt},
          ${binding.lastSeenAt},
          ${binding.retiredAt}
        )
        ON CONFLICT (environment_id, feature_binding_id)
        DO UPDATE SET
          workspace_binding_id = excluded.workspace_binding_id,
          canonical_locator_kind = excluded.canonical_locator_kind,
          canonical_locator_value = excluded.canonical_locator_value,
          locators_json = excluded.locators_json,
          repository_identity_json = excluded.repository_identity_json,
          first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
          last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
          retired_at = excluded.retired_at
      `,
  });

  const upsertStackNodeRow = SqlSchema.void({
    Request: TwsStackNodeBinding,
    execute: (binding) =>
      sql`
        INSERT INTO tws_stack_node_bindings (
          stack_node_binding_id,
          environment_id,
          feature_binding_id,
          project_id,
          canonical_locator_kind,
          canonical_locator_value,
          locators_json,
          repository_identity_json,
          git_branch,
          worktree_path,
          archived,
          first_seen_at,
          last_seen_at,
          retired_at
        )
        VALUES (
          ${binding.stackNodeBindingId},
          ${binding.environmentId},
          ${binding.featureBindingId},
          ${binding.projectId},
          ${binding.canonicalLocator.kind},
          ${binding.canonicalLocator.value},
          ${JSON.stringify(binding.locators)},
          ${
            binding.repositoryIdentity === null ? null : JSON.stringify(binding.repositoryIdentity)
          },
          ${binding.gitBranch},
          ${binding.worktreePath},
          ${binding.archived ? 1 : 0},
          ${binding.firstSeenAt},
          ${binding.lastSeenAt},
          ${binding.retiredAt}
        )
        ON CONFLICT (environment_id, stack_node_binding_id)
        DO UPDATE SET
          feature_binding_id = excluded.feature_binding_id,
          project_id = excluded.project_id,
          canonical_locator_kind = excluded.canonical_locator_kind,
          canonical_locator_value = excluded.canonical_locator_value,
          locators_json = excluded.locators_json,
          repository_identity_json = excluded.repository_identity_json,
          git_branch = excluded.git_branch,
          worktree_path = excluded.worktree_path,
          archived = excluded.archived,
          first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
          last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
          retired_at = excluded.retired_at
      `,
  });

  const listWorkspaceRows = SqlSchema.findAll({
    Request: ListTwsWorkspacesInput,
    Result: TwsWorkspaceBindingDbRow,
    execute: ({ environmentId, includeRetired, limit }) =>
      sql`
        SELECT
          workspace_binding_id AS "workspaceBindingId",
          environment_id AS "environmentId",
          json_object(
            'kind', canonical_locator_kind,
            'value', canonical_locator_value
          ) AS "canonicalLocator",
          locators_json AS locators,
          repository_identity_json AS "repositoryIdentity",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          retired_at AS "retiredAt"
        FROM tws_workspace_bindings
        WHERE environment_id = ${environmentId}
          AND ${retiredFilter(includeRetired)}
        ORDER BY last_seen_at DESC, workspace_binding_id ASC
        LIMIT ${queryLimit(limit)}
      `,
  });

  const listWorkspaceProjectRows = SqlSchema.findAll({
    Request: ListTwsWorkspaceProjectsInput,
    Result: TwsWorkspaceProjectBindingDbRow,
    execute: ({ environmentId, workspaceBindingId, includeRetired, limit }) =>
      sql`
        SELECT
          environment_id AS "environmentId",
          workspace_binding_id AS "workspaceBindingId",
          project_id AS "projectId",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          retired_at AS "retiredAt"
        FROM tws_workspace_project_bindings
        WHERE environment_id = ${environmentId}
          AND workspace_binding_id = ${workspaceBindingId}
          AND ${retiredFilter(includeRetired)}
        ORDER BY last_seen_at DESC, project_id ASC
        LIMIT ${queryLimit(limit)}
      `,
  });

  const listProjectWorkspaceRows = SqlSchema.findAll({
    Request: ListTwsProjectWorkspacesInput,
    Result: TwsWorkspaceProjectBindingDbRow,
    execute: ({ environmentId, projectId, includeRetired, limit }) =>
      sql`
        SELECT
          environment_id AS "environmentId",
          workspace_binding_id AS "workspaceBindingId",
          project_id AS "projectId",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          retired_at AS "retiredAt"
        FROM tws_workspace_project_bindings
        WHERE environment_id = ${environmentId}
          AND project_id = ${projectId}
          AND ${retiredFilter(includeRetired)}
        ORDER BY last_seen_at DESC, workspace_binding_id ASC
        LIMIT ${queryLimit(limit)}
      `,
  });

  const listFeatureRows = SqlSchema.findAll({
    Request: ListTwsFeaturesInput,
    Result: TwsFeatureBindingDbRow,
    execute: ({ environmentId, workspaceBindingId, includeRetired, limit }) =>
      sql`
        SELECT
          feature_binding_id AS "featureBindingId",
          workspace_binding_id AS "workspaceBindingId",
          environment_id AS "environmentId",
          json_object(
            'kind', canonical_locator_kind,
            'value', canonical_locator_value
          ) AS "canonicalLocator",
          locators_json AS locators,
          repository_identity_json AS "repositoryIdentity",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          retired_at AS "retiredAt"
        FROM tws_feature_bindings
        WHERE environment_id = ${environmentId}
          AND workspace_binding_id = ${workspaceBindingId}
          AND ${retiredFilter(includeRetired)}
        ORDER BY last_seen_at DESC, feature_binding_id ASC
        LIMIT ${queryLimit(limit)}
      `,
  });

  const listStackNodeRows = SqlSchema.findAll({
    Request: ListTwsStackNodesInput,
    Result: TwsStackNodeBindingDbRow,
    execute: ({ environmentId, featureBindingId, includeRetired, limit }) =>
      sql`
        SELECT
          stack_node_binding_id AS "stackNodeBindingId",
          feature_binding_id AS "featureBindingId",
          project_id AS "projectId",
          git_branch AS "gitBranch",
          worktree_path AS "worktreePath",
          archived,
          environment_id AS "environmentId",
          json_object(
            'kind', canonical_locator_kind,
            'value', canonical_locator_value
          ) AS "canonicalLocator",
          locators_json AS locators,
          repository_identity_json AS "repositoryIdentity",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          retired_at AS "retiredAt"
        FROM tws_stack_node_bindings
        WHERE environment_id = ${environmentId}
          AND feature_binding_id = ${featureBindingId}
          AND ${retiredFilter(includeRetired)}
        ORDER BY last_seen_at DESC, stack_node_binding_id ASC
        LIMIT ${queryLimit(limit)}
      `,
  });

  const findWorkspaceRows = SqlSchema.findAll({
    Request: FindTwsWorkspaceByLocatorInput,
    Result: TwsWorkspaceBindingDbRow,
    execute: ({ environmentId, locator, includeRetired, limit }) =>
      sql`
        WITH matching_ids AS (
          SELECT workspace_binding_id
          FROM tws_workspace_bindings
          WHERE environment_id = ${environmentId}
            AND ${retiredFilter(includeRetired)}
            AND canonical_locator_kind = ${locator.kind}
            AND canonical_locator_value = ${locator.value}
          UNION
          SELECT workspace_binding_id
          FROM tws_workspace_bindings
          WHERE environment_id = ${environmentId}
            AND ${retiredFilter(includeRetired)}
            AND EXISTS (
              SELECT 1
              FROM json_each(tws_workspace_bindings.locators_json) AS item
              WHERE json_extract(item.value, '$.kind') = ${locator.kind}
                AND json_extract(item.value, '$.value') = ${locator.value}
            )
        )
        SELECT
          workspace_binding_id AS "workspaceBindingId",
          environment_id AS "environmentId",
          json_object(
            'kind', canonical_locator_kind,
            'value', canonical_locator_value
          ) AS "canonicalLocator",
          locators_json AS locators,
          repository_identity_json AS "repositoryIdentity",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          retired_at AS "retiredAt"
        FROM tws_workspace_bindings
        WHERE environment_id = ${environmentId}
          AND workspace_binding_id IN (SELECT workspace_binding_id FROM matching_ids)
        ORDER BY workspace_binding_id ASC
        LIMIT ${queryLimit(limit)}
      `,
  });

  const findFeatureRows = SqlSchema.findAll({
    Request: FindTwsFeatureByLocatorInput,
    Result: TwsFeatureBindingDbRow,
    execute: ({ environmentId, workspaceBindingId, locator, includeRetired, limit }) =>
      sql`
        WITH matching_ids AS (
          SELECT feature_binding_id
          FROM tws_feature_bindings
          WHERE environment_id = ${environmentId}
            AND workspace_binding_id = ${workspaceBindingId}
            AND ${retiredFilter(includeRetired)}
            AND canonical_locator_kind = ${locator.kind}
            AND canonical_locator_value = ${locator.value}
          UNION
          SELECT feature_binding_id
          FROM tws_feature_bindings
          WHERE environment_id = ${environmentId}
            AND workspace_binding_id = ${workspaceBindingId}
            AND ${retiredFilter(includeRetired)}
            AND EXISTS (
              SELECT 1
              FROM json_each(tws_feature_bindings.locators_json) AS item
              WHERE json_extract(item.value, '$.kind') = ${locator.kind}
                AND json_extract(item.value, '$.value') = ${locator.value}
            )
        )
        SELECT
          feature_binding_id AS "featureBindingId",
          workspace_binding_id AS "workspaceBindingId",
          environment_id AS "environmentId",
          json_object(
            'kind', canonical_locator_kind,
            'value', canonical_locator_value
          ) AS "canonicalLocator",
          locators_json AS locators,
          repository_identity_json AS "repositoryIdentity",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          retired_at AS "retiredAt"
        FROM tws_feature_bindings
        WHERE environment_id = ${environmentId}
          AND workspace_binding_id = ${workspaceBindingId}
          AND feature_binding_id IN (SELECT feature_binding_id FROM matching_ids)
        ORDER BY feature_binding_id ASC
        LIMIT ${queryLimit(limit)}
      `,
  });

  const findStackNodeRows = SqlSchema.findAll({
    Request: FindTwsStackNodeByLocatorInput,
    Result: TwsStackNodeBindingDbRow,
    execute: ({ environmentId, featureBindingId, locator, includeRetired, limit }) =>
      sql`
        WITH matching_ids AS (
          SELECT stack_node_binding_id
          FROM tws_stack_node_bindings
          WHERE environment_id = ${environmentId}
            AND feature_binding_id = ${featureBindingId}
            AND ${retiredFilter(includeRetired)}
            AND canonical_locator_kind = ${locator.kind}
            AND canonical_locator_value = ${locator.value}
          UNION
          SELECT stack_node_binding_id
          FROM tws_stack_node_bindings
          WHERE environment_id = ${environmentId}
            AND feature_binding_id = ${featureBindingId}
            AND ${retiredFilter(includeRetired)}
            AND EXISTS (
              SELECT 1
              FROM json_each(tws_stack_node_bindings.locators_json) AS item
              WHERE json_extract(item.value, '$.kind') = ${locator.kind}
                AND json_extract(item.value, '$.value') = ${locator.value}
            )
        )
        SELECT
          stack_node_binding_id AS "stackNodeBindingId",
          feature_binding_id AS "featureBindingId",
          project_id AS "projectId",
          git_branch AS "gitBranch",
          worktree_path AS "worktreePath",
          archived,
          environment_id AS "environmentId",
          json_object(
            'kind', canonical_locator_kind,
            'value', canonical_locator_value
          ) AS "canonicalLocator",
          locators_json AS locators,
          repository_identity_json AS "repositoryIdentity",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          retired_at AS "retiredAt"
        FROM tws_stack_node_bindings
        WHERE environment_id = ${environmentId}
          AND feature_binding_id = ${featureBindingId}
          AND stack_node_binding_id IN (SELECT stack_node_binding_id FROM matching_ids)
        ORDER BY stack_node_binding_id ASC
        LIMIT ${queryLimit(limit)}
      `,
  });

  const decodeStackNodeRows = (
    rows: ReadonlyArray<Schema.Schema.Type<typeof TwsStackNodeBindingDbRow>>,
  ) =>
    Effect.forEach(
      rows,
      (row) =>
        decodeStackNodeBinding({
          ...row,
          archived: row.archived === 1,
        }),
      { concurrency: 1 },
    ).pipe(Effect.mapError(toPersistenceDecodeError("TwsBindingRepository.decodeStackNodeRows")));

  const repositoryError = (sqlOperation: string, decodeOperation: string) => (cause: unknown) =>
    toPersistenceSqlOrDecodeError(sqlOperation, decodeOperation)(cause);

  const upsertWorkspace: TwsBindingRepositoryShape["upsertWorkspace"] = (binding) =>
    upsertWorkspaceRow(binding).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.upsertWorkspace:query",
          "TwsBindingRepository.upsertWorkspace:encodeRequest",
        ),
      ),
    );
  const upsertWorkspaceProject: TwsBindingRepositoryShape["upsertWorkspaceProject"] = (binding) =>
    upsertWorkspaceProjectRow(binding).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.upsertWorkspaceProject:query",
          "TwsBindingRepository.upsertWorkspaceProject:encodeRequest",
        ),
      ),
    );
  const upsertFeature: TwsBindingRepositoryShape["upsertFeature"] = (binding) =>
    upsertFeatureRow(binding).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.upsertFeature:query",
          "TwsBindingRepository.upsertFeature:encodeRequest",
        ),
      ),
    );
  const upsertStackNode: TwsBindingRepositoryShape["upsertStackNode"] = (binding) =>
    upsertStackNodeRow(binding).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.upsertStackNode:query",
          "TwsBindingRepository.upsertStackNode:encodeRequest",
        ),
      ),
    );

  const listWorkspaces: TwsBindingRepositoryShape["listWorkspaces"] = (input) =>
    listWorkspaceRows(input).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.listWorkspaces:query",
          "TwsBindingRepository.listWorkspaces:decodeRows",
        ),
      ),
    );
  const listWorkspaceProjects: TwsBindingRepositoryShape["listWorkspaceProjects"] = (input) =>
    listWorkspaceProjectRows(input).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.listWorkspaceProjects:query",
          "TwsBindingRepository.listWorkspaceProjects:decodeRows",
        ),
      ),
    );
  const listProjectWorkspaces: TwsBindingRepositoryShape["listProjectWorkspaces"] = (input) =>
    listProjectWorkspaceRows(input).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.listProjectWorkspaces:query",
          "TwsBindingRepository.listProjectWorkspaces:decodeRows",
        ),
      ),
    );
  const listFeatures: TwsBindingRepositoryShape["listFeatures"] = (input) =>
    listFeatureRows(input).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.listFeatures:query",
          "TwsBindingRepository.listFeatures:decodeRows",
        ),
      ),
    );
  const listStackNodes: TwsBindingRepositoryShape["listStackNodes"] = (input) =>
    listStackNodeRows(input).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.listStackNodes:query",
          "TwsBindingRepository.listStackNodes:decodeRows",
        ),
      ),
      Effect.flatMap(decodeStackNodeRows),
    );
  const findWorkspacesByLocator: TwsBindingRepositoryShape["findWorkspacesByLocator"] = (input) =>
    findWorkspaceRows(input).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.findWorkspacesByLocator:query",
          "TwsBindingRepository.findWorkspacesByLocator:decodeRows",
        ),
      ),
    );
  const findFeaturesByLocator: TwsBindingRepositoryShape["findFeaturesByLocator"] = (input) =>
    findFeatureRows(input).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.findFeaturesByLocator:query",
          "TwsBindingRepository.findFeaturesByLocator:decodeRows",
        ),
      ),
    );
  const findStackNodesByLocator: TwsBindingRepositoryShape["findStackNodesByLocator"] = (input) =>
    findStackNodeRows(input).pipe(
      Effect.mapError(
        repositoryError(
          "TwsBindingRepository.findStackNodesByLocator:query",
          "TwsBindingRepository.findStackNodesByLocator:decodeRows",
        ),
      ),
      Effect.flatMap(decodeStackNodeRows),
    );

  const deleteWorkspace: TwsBindingRepositoryShape["deleteWorkspace"] = ({
    environmentId,
    workspaceBindingId,
  }) =>
    sql`
      DELETE FROM tws_workspace_bindings
      WHERE environment_id = ${environmentId}
        AND workspace_binding_id = ${workspaceBindingId}
    `.pipe(Effect.mapError(toPersistenceSqlError("TwsBindingRepository.deleteWorkspace:query")));

  return {
    upsertWorkspace,
    upsertWorkspaceProject,
    upsertFeature,
    upsertStackNode,
    listWorkspaces,
    listWorkspaceProjects,
    listProjectWorkspaces,
    listFeatures,
    listStackNodes,
    findWorkspacesByLocator,
    findFeaturesByLocator,
    findStackNodesByLocator,
    deleteWorkspace,
  } satisfies TwsBindingRepositoryShape;
});

export const TwsBindingRepositoryLive = Layer.effect(
  TwsBindingRepository,
  makeTwsBindingRepository,
);
