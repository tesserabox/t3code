import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ProcessRunner, type ProcessRunInput, type ProcessRunOutput } from "../processRunner.ts";
import { TwsCliAdapter, TwsCliAdapterLive } from "./TwsCliAdapter.ts";

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
};
const statusReport = {
  schema_version: 1,
  generated_at: "2026-01-01T00:00:00Z",
  workspace: {},
  features: [],
  issues: [],
  summary: { needs_attention: 0 },
};
const stackStatusReport = {
  schema_version: 1,
  workspace: {},
  feature: "feature-a",
  entries: [],
  summary: {},
};

function processOutput(input: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number | null;
  readonly stdoutInvalidUtf8?: boolean;
  readonly stderrInvalidUtf8?: boolean;
}): ProcessRunOutput {
  return {
    stdout: input.stdout ?? "",
    stderr: input.stderr ?? "",
    code: input.code === null ? null : ChildProcessSpawner.ExitCode(input.code ?? 0),
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutInvalidUtf8: input.stdoutInvalidUtf8 ?? false,
    stderrInvalidUtf8: input.stderrInvalidUtf8 ?? false,
  };
}

function testLayer(outputs: ReadonlyArray<ProcessRunOutput>, calls: ProcessRunInput[]) {
  let index = 0;
  const runner = {
    run: (input: ProcessRunInput) =>
      Effect.sync(() => {
        calls.push(input);
        const output = outputs[index];
        index += 1;
        if (!output) {
          throw new Error(`Missing fake TWS output for call ${index}`);
        }
        return output;
      }),
  };
  return TwsCliAdapterLive.pipe(Layer.provide(Layer.succeed(ProcessRunner, runner)));
}

describe("TwsCliAdapter", () => {
  it.effect("uses only read-only direct argument arrays and caches a successful version", () => {
    const calls: ProcessRunInput[] = [];
    const layer = testLayer(
      [
        processOutput({ stdout: "tws version v1.2.14\n" }),
        processOutput({ stdout: encodeJson([registryEntry]) }),
        processOutput({ stdout: encodeJson([{ entry: registryEntry, status: "ok" }]) }),
        processOutput({ stdout: encodeJson(statusReport) }),
        processOutput({ stdout: encodeJson(stackStatusReport) }),
      ],
      calls,
    );

    return Effect.gen(function* () {
      const adapter = yield* TwsCliAdapter;
      yield* adapter.listRegistry();
      yield* adapter.checkRegistry();
      yield* adapter.readStatus({ cwd: "/workspace/example", feature: "feature-a" });
      yield* adapter.readStackStatus({ cwd: "/workspace/example", feature: "feature-a" });

      assert.deepEqual(
        calls.map((call) => ({
          command: call.command,
          args: call.args,
          cwd: call.cwd,
          timeout: call.timeout,
          maxOutputBytes: call.maxOutputBytes,
        })),
        [
          {
            command: "tws",
            args: ["--version"],
            cwd: undefined,
            timeout: "15 seconds",
            maxOutputBytes: 4 * 1024 * 1024,
          },
          {
            command: "tws",
            args: ["registry", "list", "--json"],
            cwd: undefined,
            timeout: "15 seconds",
            maxOutputBytes: 4 * 1024 * 1024,
          },
          {
            command: "tws",
            args: ["registry", "check", "--json"],
            cwd: undefined,
            timeout: "15 seconds",
            maxOutputBytes: 4 * 1024 * 1024,
          },
          {
            command: "tws",
            args: ["status", "feature-a", "--json"],
            cwd: "/workspace/example",
            timeout: "15 seconds",
            maxOutputBytes: 4 * 1024 * 1024,
          },
          {
            command: "tws",
            args: ["stack", "status", "feature-a", "--json"],
            cwd: "/workspace/example",
            timeout: "15 seconds",
            maxOutputBytes: 4 * 1024 * 1024,
          },
        ],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("retries a failed version probe instead of caching the failure", () => {
    const calls: ProcessRunInput[] = [];
    const layer = testLayer(
      [
        processOutput({ code: 1, stderr: "Error: temporary failure\n" }),
        processOutput({ stdout: "tws version v1.2.14\n" }),
      ],
      calls,
    );

    return Effect.gen(function* () {
      const adapter = yield* TwsCliAdapter;
      const first = yield* adapter.probe().pipe(Effect.flip);
      assert.strictEqual(first._tag, "TwsCommandFailedError");
      assert.deepEqual(yield* adapter.probe(), { version: "v1.2.14" });
      assert.strictEqual(calls.length, 2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("does not parse valid JSON stdout from a nonzero command", () => {
    const calls: ProcessRunInput[] = [];
    const layer = testLayer(
      [
        processOutput({ stdout: "tws version v1.2.14\n" }),
        processOutput({ code: 1, stdout: encodeJson(statusReport) }),
      ],
      calls,
    );

    return Effect.gen(function* () {
      const adapter = yield* TwsCliAdapter;
      const result = yield* adapter.readStatus({ cwd: "/outside" }).pipe(Effect.flip);
      assert.strictEqual(result._tag, "TwsCommandFailedError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects invalid UTF-8 observations before decoding", () => {
    const calls: ProcessRunInput[] = [];
    const layer = testLayer(
      [
        processOutput({ stdout: "tws version v1.2.14\n" }),
        processOutput({
          stdout: encodeJson(statusReport),
          stdoutInvalidUtf8: true,
        }),
      ],
      calls,
    );

    return Effect.gen(function* () {
      const adapter = yield* TwsCliAdapter;
      const result = yield* adapter.readStatus({ cwd: "/workspace/example" }).pipe(Effect.flip);
      assert.strictEqual(result._tag, "TwsOutputDecodeError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects option-like and empty feature identifiers before spawning", () => {
    const calls: ProcessRunInput[] = [];
    const layer = testLayer([], calls);

    return Effect.gen(function* () {
      const adapter = yield* TwsCliAdapter;
      const optionLike = yield* adapter
        .readStatus({ cwd: "/workspace/example", feature: "--help" })
        .pipe(Effect.flip);
      assert.strictEqual(optionLike._tag, "TwsInvalidFeatureError");

      const empty = yield* adapter
        .readStackStatus({ cwd: "/workspace/example", feature: "" })
        .pipe(Effect.flip);
      assert.strictEqual(empty._tag, "TwsInvalidFeatureError");
      assert.deepEqual(calls, []);
    }).pipe(Effect.provide(layer));
  });

  it.effect("prioritizes invalid UTF-8 over nonzero command output", () => {
    const calls: ProcessRunInput[] = [];
    const layer = testLayer(
      [
        processOutput({ stdout: "tws version v1.2.14\n" }),
        processOutput({
          code: 1,
          stderr: "corrupted",
          stderrInvalidUtf8: true,
        }),
      ],
      calls,
    );

    return Effect.gen(function* () {
      const adapter = yield* TwsCliAdapter;
      const result = yield* adapter.readStatus({ cwd: "/workspace/example" }).pipe(Effect.flip);
      assert.strictEqual(result._tag, "TwsOutputDecodeError");
    }).pipe(Effect.provide(layer));
  });
});
