import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS tws_workspace_bindings (
      environment_id TEXT NOT NULL,
      workspace_binding_id TEXT NOT NULL,
      canonical_locator_kind TEXT NOT NULL,
      canonical_locator_value TEXT NOT NULL,
      locators_json TEXT NOT NULL,
      repository_identity_json TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      retired_at TEXT,
      PRIMARY KEY (environment_id, workspace_binding_id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS tws_workspace_project_bindings (
      environment_id TEXT NOT NULL,
      workspace_binding_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      retired_at TEXT,
      PRIMARY KEY (environment_id, workspace_binding_id, project_id),
      FOREIGN KEY (environment_id, workspace_binding_id)
        REFERENCES tws_workspace_bindings(environment_id, workspace_binding_id)
        ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS tws_feature_bindings (
      environment_id TEXT NOT NULL,
      feature_binding_id TEXT NOT NULL,
      workspace_binding_id TEXT NOT NULL,
      canonical_locator_kind TEXT NOT NULL,
      canonical_locator_value TEXT NOT NULL,
      locators_json TEXT NOT NULL,
      repository_identity_json TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      retired_at TEXT,
      PRIMARY KEY (environment_id, feature_binding_id),
      FOREIGN KEY (environment_id, workspace_binding_id)
        REFERENCES tws_workspace_bindings(environment_id, workspace_binding_id)
        ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS tws_stack_node_bindings (
      environment_id TEXT NOT NULL,
      stack_node_binding_id TEXT NOT NULL,
      feature_binding_id TEXT NOT NULL,
      project_id TEXT,
      canonical_locator_kind TEXT NOT NULL,
      canonical_locator_value TEXT NOT NULL,
      locators_json TEXT NOT NULL,
      repository_identity_json TEXT,
      git_branch TEXT NOT NULL,
      worktree_path TEXT,
      archived INTEGER NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      retired_at TEXT,
      PRIMARY KEY (environment_id, stack_node_binding_id),
      FOREIGN KEY (environment_id, feature_binding_id)
        REFERENCES tws_feature_bindings(environment_id, feature_binding_id)
        ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_workspace_bindings_environment_locator
    ON tws_workspace_bindings(
      environment_id,
      canonical_locator_kind,
      canonical_locator_value
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_workspace_bindings_environment_retired
    ON tws_workspace_bindings(
      environment_id,
      retired_at,
      last_seen_at DESC,
      workspace_binding_id ASC
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_workspace_bindings_environment_seen
    ON tws_workspace_bindings(
      environment_id,
      last_seen_at DESC,
      workspace_binding_id ASC
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_workspace_project_bindings_workspace_retired
    ON tws_workspace_project_bindings(
      environment_id,
      workspace_binding_id,
      retired_at,
      last_seen_at DESC,
      project_id ASC
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_workspace_project_bindings_workspace_seen
    ON tws_workspace_project_bindings(
      environment_id,
      workspace_binding_id,
      last_seen_at DESC,
      project_id ASC
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_workspace_project_bindings_project
    ON tws_workspace_project_bindings(
      environment_id,
      project_id,
      retired_at,
      last_seen_at DESC,
      workspace_binding_id ASC
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_workspace_project_bindings_project_seen
    ON tws_workspace_project_bindings(
      environment_id,
      project_id,
      last_seen_at DESC,
      workspace_binding_id ASC
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_feature_bindings_workspace_locator
    ON tws_feature_bindings(
      environment_id,
      workspace_binding_id,
      canonical_locator_kind,
      canonical_locator_value
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_feature_bindings_workspace_retired
    ON tws_feature_bindings(
      environment_id,
      workspace_binding_id,
      retired_at,
      last_seen_at DESC,
      feature_binding_id ASC
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_feature_bindings_workspace_seen
    ON tws_feature_bindings(
      environment_id,
      workspace_binding_id,
      last_seen_at DESC,
      feature_binding_id ASC
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_stack_node_bindings_feature_locator
    ON tws_stack_node_bindings(
      environment_id,
      feature_binding_id,
      canonical_locator_kind,
      canonical_locator_value
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_stack_node_bindings_project
    ON tws_stack_node_bindings(
      environment_id,
      project_id,
      retired_at,
      last_seen_at DESC,
      stack_node_binding_id ASC
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_stack_node_bindings_feature_retired
    ON tws_stack_node_bindings(
      environment_id,
      feature_binding_id,
      retired_at,
      last_seen_at DESC,
      stack_node_binding_id ASC
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tws_stack_node_bindings_feature_seen
    ON tws_stack_node_bindings(
      environment_id,
      feature_binding_id,
      last_seen_at DESC,
      stack_node_binding_id ASC
    )
  `;
});
