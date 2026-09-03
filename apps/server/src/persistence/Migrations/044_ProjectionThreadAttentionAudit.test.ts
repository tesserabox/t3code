import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("044_ProjectionThreadAttentionAudit", (it) => {
  it.effect("creates the attention audit table and bounded-read index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* runMigrations({ toMigrationInclusive: 44 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_attention_audit)
      `;
      assert.deepEqual(
        columns.map((column) => column.name),
        ["event_id", "thread_id", "turn_id", "request_id", "kind", "sequence", "occurred_at"],
      );

      const indexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_thread_attention_audit)
      `;
      assert.isTrue(
        indexes.some(
          (index) => index.name === "idx_projection_thread_attention_audit_thread_sequence",
        ),
      );
    }),
  );
});
