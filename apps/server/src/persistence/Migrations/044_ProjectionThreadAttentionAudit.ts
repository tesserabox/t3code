import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_attention_audit (
      event_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      request_id TEXT,
      kind TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      occurred_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_attention_audit_thread_sequence
    ON projection_thread_attention_audit(thread_id, sequence DESC, event_id DESC)
  `;
});
