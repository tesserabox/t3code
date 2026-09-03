import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  decodeTwsRegistryCheck,
  decodeTwsRegistryList,
  decodeTwsStackStatus,
  decodeTwsStatus,
  decodeTwsVersionOutput,
  twsCommandFailureLines,
} from "./TwsCliDecoder.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const registryEntry = {
  id: "registry-1",
  path: "/workspace/example",
  aliases: ["example"],
  kind: "checkout-workspace",
  git_identity: "git-identity",
  marker_id: "marker-id",
  added_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  future_registry_key: true,
};

const statusReport = {
  schema_version: 1,
  generated_at: "2026-01-01T00:00:00Z",
  workspace: {
    mode: "checkout",
    stable_id: "workspace-1",
    repo_root: "/workspace/example",
    metadata_root: "/workspace/example/.tws",
    degraded: false,
    degraded_reason: null,
    runtime_presence: "absent",
    agent_state: "unknown",
    attention: { status: "idle", issue_count: 0, codes: [] },
  },
  features: [],
  issues: [],
  summary: { needs_attention: 0 },
};

const stackStatusReport = {
  schema_version: 1,
  workspace: statusReport.workspace,
  feature: "feature-a",
  entries: [],
  summary: { entries: 0 },
};

describe("TwsCliDecoder", () => {
  it.effect("decodes the pinned version and rejects malformed or unsupported versions", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* decodeTwsVersionOutput("tws version v1.2.14\n"), {
        version: "v1.2.14",
      });

      const unsupported = yield* decodeTwsVersionOutput("tws version v1.3.0").pipe(Effect.flip);
      assert.strictEqual(unsupported._tag, "TwsUnsupportedVersionError");

      const malformed = yield* decodeTwsVersionOutput("v1.2.14").pipe(Effect.flip);
      assert.strictEqual(malformed._tag, "TwsMalformedVersionError");
    }),
  );

  it.effect("decodes registry list and check while preserving additive fields", () =>
    Effect.gen(function* () {
      const listed = yield* decodeTwsRegistryList(encodeJson([registryEntry]));
      assert.strictEqual(listed[0]?.gitIdentity, "git-identity");
      assert.strictEqual(listed[0]?.raw.future_registry_key, true);

      const checked = yield* decodeTwsRegistryCheck(
        encodeJson([{ entry: registryEntry, status: "ok", future_check_key: 42 }]),
      );
      assert.strictEqual(checked[0]?.status, "ok");
      assert.strictEqual(checked[0]?.raw.future_check_key, 42);
      assert.strictEqual(checked[0]?.entry.raw.future_registry_key, true);
    }),
  );

  it.effect("preserves additive status fields and degrades unknown enums", () =>
    Effect.gen(function* () {
      const report = yield* decodeTwsStatus(
        encodeJson({
          ...statusReport,
          future_top_level: "preserved",
          workspace: {
            ...statusReport.workspace,
            runtime_presence: "hibernating",
            future_workspace_key: true,
          },
          features: [
            {
              feature: "feature-a",
              agent_state: "awaiting_tool",
              attention: { status: "escalated", issue_count: 1, codes: ["future-code"] },
              entries: [],
            },
          ],
        }),
      );

      assert.strictEqual(report.raw.future_top_level, "preserved");
      assert.strictEqual(report.workspace.future_workspace_key, true);
      assert.isTrue(report.decoderDegraded);
      assert.deepEqual(report.unknownEnums.map((item) => item.raw).toSorted(), [
        "awaiting_tool",
        "escalated",
        "hibernating",
      ]);
      assert.isFalse(report.twsNeedsAttention);
    }),
  );

  it.effect("derives TWS attention independently from status and summary data", () =>
    Effect.gen(function* () {
      const nested = yield* decodeTwsStatus(
        encodeJson({
          ...statusReport,
          features: [
            {
              feature: "feature-a",
              attention: { status: "needs_attention", issue_count: 1, codes: ["ref-missing"] },
              entries: [],
            },
          ],
        }),
      );
      assert.isTrue(nested.twsNeedsAttention);

      const summary = yield* decodeTwsStatus(
        encodeJson({
          ...statusReport,
          summary: { needs_attention: 2 },
        }),
      );
      assert.isTrue(summary.twsNeedsAttention);
    }),
  );

  it.effect("decodes stack status and rejects invalid reports", () =>
    Effect.gen(function* () {
      const stack = yield* decodeTwsStackStatus(
        encodeJson({ ...stackStatusReport, future_stack_key: true }),
      );
      assert.strictEqual(stack.feature, "feature-a");
      assert.strictEqual(stack.raw.future_stack_key, true);

      const unsupported = yield* decodeTwsStatus(
        encodeJson({ ...statusReport, schema_version: 2 }),
      ).pipe(Effect.flip);
      assert.strictEqual(unsupported._tag, "TwsUnsupportedSchemaVersionError");

      const missing = yield* decodeTwsStatus(
        encodeJson({
          schema_version: 1,
          generated_at: statusReport.generated_at,
          workspace: statusReport.workspace,
        }),
      ).pipe(Effect.flip);
      assert.strictEqual(missing._tag, "TwsOutputDecodeError");

      const missingVersion = yield* decodeTwsStatus(
        encodeJson({
          generated_at: statusReport.generated_at,
          workspace: statusReport.workspace,
          features: [],
          issues: [],
          summary: {},
        }),
      ).pipe(Effect.flip);
      assert.strictEqual(missingVersion._tag, "TwsOutputDecodeError");
      if (missingVersion._tag === "TwsOutputDecodeError") {
        assert.strictEqual(missingVersion.reason, "missing-required-keys");
      }

      const invalidJson = yield* decodeTwsStatus("{").pipe(Effect.flip);
      assert.strictEqual(invalidJson._tag, "TwsOutputDecodeError");
    }),
  );

  it("deduplicates canonical error lines across output streams", () => {
    assert.deepEqual(
      twsCommandFailureLines(
        "not inside a git repository or tws workspace\n",
        "Error: not inside a git repository or tws workspace\n",
        1,
      ),
      [
        {
          message: "not inside a git repository or tws workspace",
          streams: ["stderr", "stdout"],
        },
      ],
    );
    assert.deepEqual(twsCommandFailureLines("", "", 9), [
      { message: "tws exited with status 9", streams: [] },
    ]);
  });
});
