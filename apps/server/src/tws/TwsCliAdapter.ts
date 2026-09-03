import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  decodeTwsRegistryCheck,
  decodeTwsRegistryList,
  decodeTwsStackStatus,
  decodeTwsStatus,
  decodeTwsVersionOutput,
  TwsCommandFailedError,
  type TwsCliDecodeError,
  type TwsRegistryCheck,
  type TwsRegistryEntry,
  type TwsStackStatusReport,
  type TwsStatusReport,
  type TwsVersionInfo,
  twsCommandFailureLines,
  TwsInvalidFeatureError,
  TwsOutputDecodeError,
  type TwsCommandKind,
} from "./TwsCliDecoder.ts";
import { ProcessRunner, type ProcessRunError, type ProcessRunOutput } from "../processRunner.ts";

const TWS_COMMAND = "tws";
const TWS_TIMEOUT = "15 seconds";
const TWS_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export type TwsCliAdapterError = ProcessRunError | TwsCliDecodeError;

export interface TwsStatusInput {
  readonly cwd: string;
  readonly feature?: string | undefined;
}

export interface TwsStackStatusInput {
  readonly cwd: string;
  readonly feature: string;
}

export interface TwsCliAdapterShape {
  readonly probe: () => Effect.Effect<TwsVersionInfo, TwsCliAdapterError>;
  readonly listRegistry: () => Effect.Effect<ReadonlyArray<TwsRegistryEntry>, TwsCliAdapterError>;
  readonly checkRegistry: () => Effect.Effect<ReadonlyArray<TwsRegistryCheck>, TwsCliAdapterError>;
  readonly readStatus: (
    input: TwsStatusInput,
  ) => Effect.Effect<TwsStatusReport, TwsCliAdapterError>;
  readonly readStackStatus: (
    input: TwsStackStatusInput,
  ) => Effect.Effect<TwsStackStatusReport, TwsCliAdapterError>;
}

export class TwsCliAdapter extends Context.Service<TwsCliAdapter, TwsCliAdapterShape>()(
  "t3/tws/TwsCliAdapter",
) {}

function commandOutput(
  command: TwsCommandKind,
  output: ProcessRunOutput,
): Effect.Effect<string, TwsCommandFailedError | TwsOutputDecodeError> {
  if (output.stdoutInvalidUtf8 || output.stderrInvalidUtf8) {
    return Effect.fail(
      new TwsOutputDecodeError({
        command,
        reason: "invalid-utf8",
        detail: "command output was not valid UTF-8",
      }),
    );
  }
  if (output.code !== 0) {
    return Effect.fail(
      new TwsCommandFailedError({
        command,
        exitCode: output.code,
        failures: twsCommandFailureLines(output.stdout, output.stderr, output.code),
      }),
    );
  }
  return Effect.succeed(output.stdout);
}

function validateFeature(feature: string): Effect.Effect<string, TwsInvalidFeatureError> {
  if (feature.length === 0) {
    return Effect.fail(new TwsInvalidFeatureError({ detail: "TWS feature must not be empty" }));
  }
  if (feature.trim() !== feature) {
    return Effect.fail(
      new TwsInvalidFeatureError({
        detail: "TWS feature must not contain leading or trailing whitespace",
      }),
    );
  }
  if (feature.startsWith("-")) {
    return Effect.fail(
      new TwsInvalidFeatureError({ detail: "TWS feature must not be parsed as a CLI option" }),
    );
  }
  if (feature.includes("\0") || feature.length > 256) {
    return Effect.fail(new TwsInvalidFeatureError({ detail: "TWS feature is invalid" }));
  }
  return Effect.succeed(feature);
}

const makeTwsCliAdapter = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner;
  let cachedVersion: TwsVersionInfo | undefined;

  const run = (
    command: TwsCommandKind,
    args: ReadonlyArray<string>,
    cwd?: string,
  ): Effect.Effect<string, TwsCliAdapterError> =>
    processRunner
      .run({
        command: TWS_COMMAND,
        args,
        ...(cwd ? { cwd } : {}),
        timeout: TWS_TIMEOUT,
        maxOutputBytes: TWS_MAX_OUTPUT_BYTES,
      })
      .pipe(Effect.flatMap((output) => commandOutput(command, output)));

  const probeUncached = () =>
    run("version", ["--version"]).pipe(Effect.flatMap(decodeTwsVersionOutput));

  const probe: TwsCliAdapterShape["probe"] = () =>
    cachedVersion
      ? Effect.succeed(cachedVersion)
      : probeUncached().pipe(
          Effect.tap((version) =>
            Effect.sync(() => {
              cachedVersion = version;
            }),
          ),
        );

  const withSupportedVersion = <A, E>(
    effect: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | TwsCliAdapterError> => probe().pipe(Effect.andThen(effect));

  const listRegistry: TwsCliAdapterShape["listRegistry"] = () =>
    withSupportedVersion(
      run("registry-list", ["registry", "list", "--json"]).pipe(
        Effect.flatMap(decodeTwsRegistryList),
      ),
    );

  const checkRegistry: TwsCliAdapterShape["checkRegistry"] = () =>
    withSupportedVersion(
      run("registry-check", ["registry", "check", "--json"]).pipe(
        Effect.flatMap(decodeTwsRegistryCheck),
      ),
    );

  const readStatus: TwsCliAdapterShape["readStatus"] = (input) =>
    Effect.gen(function* () {
      const feature =
        input.feature === undefined ? undefined : yield* validateFeature(input.feature);
      return yield* withSupportedVersion(
        run("status", ["status", ...(feature ? [feature] : []), "--json"], input.cwd).pipe(
          Effect.flatMap(decodeTwsStatus),
        ),
      );
    });

  const readStackStatus: TwsCliAdapterShape["readStackStatus"] = (input) =>
    Effect.gen(function* () {
      const feature = yield* validateFeature(input.feature);
      return yield* withSupportedVersion(
        run("stack-status", ["stack", "status", feature, "--json"], input.cwd).pipe(
          Effect.flatMap(decodeTwsStackStatus),
        ),
      );
    });

  return {
    probe,
    listRegistry,
    checkRegistry,
    readStatus,
    readStackStatus,
  } satisfies TwsCliAdapterShape;
});

export const TwsCliAdapterLive = Layer.effect(TwsCliAdapter, makeTwsCliAdapter);
