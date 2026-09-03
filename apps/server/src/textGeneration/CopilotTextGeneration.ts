import {
  CopilotClient,
  type CopilotClientOptions,
  type CopilotSession,
  type SessionConfig,
} from "@github/copilot-sdk";
import { type CopilotSettings, type ModelSelection, TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { makeCopilotClientOptions } from "../provider/Layers/copilotClientOptions.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const GENERATION_TIMEOUT_MS = 180_000;
const CREATE_SESSION_TIMEOUT_MS = 30_000;
const MAX_GENERATION_RESPONSE_CHARS = 20_000;
const DISCONNECT_TIMEOUT_MS = 5_000;
const DELETE_SESSION_TIMEOUT_MS = 5_000;
const CLIENT_STOP_TIMEOUT_MS = 10_000;
const FORCE_STOP_TIMEOUT_MS = 5_000;

type CopilotTextGenerationSession = Pick<
  CopilotSession,
  "sessionId" | "sendAndWait" | "disconnect"
>;
type CopilotTextGenerationClient = Pick<
  CopilotClient,
  "start" | "stop" | "forceStop" | "deleteSession"
> & {
  readonly createSession: (config: SessionConfig) => Promise<CopilotTextGenerationSession>;
};

export interface CopilotTextGenerationOptions {
  readonly timeoutMs?: number;
  readonly createSessionTimeoutMs?: number;
  readonly clientFactory?: (options: CopilotClientOptions) => CopilotTextGenerationClient;
  readonly cleanupDeadlines?: {
    readonly disconnectMs?: number;
    readonly deleteSessionMs?: number;
    readonly clientStopMs?: number;
    readonly forceStopMs?: number;
  };
}

type TextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

type CopilotCleanupStage = "disconnect" | "delete-session" | "client-stop" | "force-stop";

class CopilotTextGenerationCleanupError extends Data.TaggedError(
  "CopilotTextGenerationCleanupError",
)<{
  readonly stage: CopilotCleanupStage;
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return `GitHub Copilot text generation ${this.stage} cleanup failed: ${this.detail}`;
  }
}

interface CopilotTextGenerationLifecycle {
  session: CopilotTextGenerationSession | undefined;
  creationTimedOut: boolean;
  finalized: boolean;
  readonly cleanupErrors: CopilotTextGenerationCleanupError[];
}

function generationError(operation: TextGenerationOperation, detail: string, cause?: unknown) {
  return new TextGenerationError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function copilotReasoningEffort(
  selection: ModelSelection,
): NonNullable<SessionConfig["reasoningEffort"]> | undefined {
  const value = getModelSelectionStringOptionValue(selection, "reasoningEffort");
  switch (value) {
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      return undefined;
  }
}

function makeCopilotTextGenerationService(
  settings: CopilotSettings,
  environment?: NodeJS.ProcessEnv,
  options: CopilotTextGenerationOptions = {},
): TextGeneration.TextGeneration["Service"] {
  const deadline = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback;
  const createSessionTimeoutMs = deadline(
    options.createSessionTimeoutMs,
    CREATE_SESSION_TIMEOUT_MS,
  );
  const cleanupDeadlines = {
    disconnectMs: deadline(options.cleanupDeadlines?.disconnectMs, DISCONNECT_TIMEOUT_MS),
    deleteSessionMs: deadline(options.cleanupDeadlines?.deleteSessionMs, DELETE_SESSION_TIMEOUT_MS),
    clientStopMs: deadline(options.cleanupDeadlines?.clientStopMs, CLIENT_STOP_TIMEOUT_MS),
    forceStopMs: deadline(options.cleanupDeadlines?.forceStopMs, FORCE_STOP_TIMEOUT_MS),
  };

  const runGeneration = Effect.fn("CopilotTextGeneration.runGeneration")(function* <
    S extends Schema.Top,
  >(input: {
    readonly operation: TextGenerationOperation;
    readonly cwd: string;
    readonly prompt: string;
    readonly modelSelection: ModelSelection;
    readonly outputSchema: S;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const clientOptions = makeCopilotClientOptions({
      settings,
      cwd: input.cwd,
      ...(environment ? { environment } : {}),
    });
    const client = options.clientFactory?.(clientOptions) ?? new CopilotClient(clientOptions);
    const reasoningEffort = copilotReasoningEffort(input.modelSelection);
    const lifecycle: CopilotTextGenerationLifecycle = {
      session: undefined,
      creationTimedOut: false,
      finalized: false,
      cleanupErrors: [],
    };
    const runRequest = <A>(
      detail: string,
      request: () => Promise<A>,
    ): Effect.Effect<A, TextGenerationError> =>
      Effect.tryPromise({
        try: request,
        catch: (cause) => generationError(input.operation, detail, cause),
      });
    const runCleanup = <A>(
      stage: CopilotCleanupStage,
      timeoutMs: number,
      request: () => Promise<A>,
    ): Effect.Effect<A, CopilotTextGenerationCleanupError> =>
      Effect.tryPromise({
        try: request,
        catch: (cause) =>
          new CopilotTextGenerationCleanupError({
            stage,
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }).pipe(
        Effect.timeoutOption(timeoutMs),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new CopilotTextGenerationCleanupError({
                  stage,
                  detail: `Timed out after ${timeoutMs}ms.`,
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );

    const generate = Effect.fn("CopilotTextGeneration.generate")(function* () {
      yield* runRequest("GitHub Copilot client failed to start.", () => client.start());
      const createdSession = yield* runRequest(
        "GitHub Copilot text generation session failed to start.",
        () =>
          client.createSession({
            clientName: "t3-code-text-generation",
            workingDirectory: input.cwd,
            model: input.modelSelection.model,
            ...(reasoningEffort ? { reasoningEffort } : {}),
            streaming: false,
            enableConfigDiscovery: false,
            enableSkills: false,
            availableTools: [],
            mcpServers: {},
            customAgents: [],
            skipCustomInstructions: true,
            requestExtensions: false,
            requestCanvasRenderer: false,
            enableMcpApps: false,
            manageScheduleEnabled: false,
            infiniteSessions: { enabled: false },
            onPermissionRequest: () => ({ kind: "reject" }),
          }),
      ).pipe(
        Effect.timeoutOption(createSessionTimeoutMs),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.sync(() => {
                lifecycle.creationTimedOut = true;
              }).pipe(
                Effect.andThen(
                  Effect.fail(
                    generationError(
                      input.operation,
                      `GitHub Copilot text generation session creation timed out after ${createSessionTimeoutMs}ms.`,
                    ),
                  ),
                ),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );
      lifecycle.session = createdSession;
      const response = yield* runRequest("GitHub Copilot text generation failed.", () =>
        createdSession.sendAndWait(
          {
            prompt: input.prompt,
            mode: "immediate",
            agentMode: "interactive",
          },
          options.timeoutMs ?? GENERATION_TIMEOUT_MS,
        ),
      );
      const content = response?.data.content?.trim();
      if (!content) {
        return yield* generationError(
          input.operation,
          "GitHub Copilot returned no text generation result.",
        );
      }
      if (content.length > MAX_GENERATION_RESPONSE_CHARS) {
        return yield* generationError(
          input.operation,
          `GitHub Copilot returned more than ${MAX_GENERATION_RESPONSE_CHARS.toLocaleString()} characters.`,
        );
      }

      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(input.outputSchema));
      return yield* decodeOutput(extractJsonObject(content)).pipe(
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              generationError(
                input.operation,
                "GitHub Copilot returned invalid structured output.",
                cause,
              ),
            ),
        }),
      );
    });

    const finalizeLifecycle = Effect.fn("CopilotTextGeneration.finalizeLifecycle")(function* (
      state: CopilotTextGenerationLifecycle,
      exit: Exit.Exit<unknown, TextGenerationError>,
    ) {
      if (state.finalized) return;
      state.finalized = true;
      const interrupted = Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause);
      const sessionToCleanup = state.session;
      state.session = undefined;

      if (sessionToCleanup) {
        const disconnectResult = yield* runCleanup(
          "disconnect",
          cleanupDeadlines.disconnectMs,
          () => sessionToCleanup.disconnect(),
        ).pipe(Effect.result);
        if (Result.isFailure(disconnectResult)) {
          state.cleanupErrors.push(disconnectResult.failure);
        }

        const deleteResult = yield* runCleanup(
          "delete-session",
          cleanupDeadlines.deleteSessionMs,
          () => client.deleteSession(sessionToCleanup.sessionId),
        ).pipe(Effect.result);
        if (Result.isFailure(deleteResult)) {
          state.cleanupErrors.push(deleteResult.failure);
        }
      }

      const stopResult = yield* runCleanup("client-stop", cleanupDeadlines.clientStopMs, () =>
        client.stop(),
      ).pipe(Effect.result);
      if (Result.isFailure(stopResult)) {
        state.cleanupErrors.push(stopResult.failure);
      } else {
        for (const cause of stopResult.success) {
          state.cleanupErrors.push(
            new CopilotTextGenerationCleanupError({
              stage: "client-stop",
              detail: cause.message,
              cause,
            }),
          );
        }
      }

      if (state.cleanupErrors.length > 0 || state.creationTimedOut || interrupted) {
        const forceStopResult = yield* runCleanup("force-stop", cleanupDeadlines.forceStopMs, () =>
          client.forceStop(),
        ).pipe(Effect.result);
        if (Result.isFailure(forceStopResult)) {
          state.cleanupErrors.push(forceStopResult.failure);
        }
      }

      if (interrupted && state.cleanupErrors.length > 0) {
        yield* Effect.logError(
          "GitHub Copilot text generation cleanup failed after interruption.",
          {
            errors: state.cleanupErrors.map((error) => ({
              stage: error.stage,
              detail: error.detail,
            })),
          },
        );
      }
    });

    const generationResult = yield* Effect.acquireUseRelease(
      Effect.succeed(lifecycle),
      () => generate(),
      finalizeLifecycle,
    ).pipe(Effect.result);
    const cleanupErrors = lifecycle.cleanupErrors;

    if (Result.isFailure(generationResult)) {
      const generationFailure = generationResult.failure;
      if (cleanupErrors.length === 0) {
        return yield* generationFailure;
      }
      return yield* generationError(
        input.operation,
        `${generationFailure.detail} Cleanup also failed.`,
        new AggregateError(
          [generationFailure, ...cleanupErrors],
          "GitHub Copilot text generation and cleanup both failed.",
          { cause: generationFailure },
        ),
      );
    }
    if (cleanupErrors.length > 0) {
      return yield* generationError(
        input.operation,
        "GitHub Copilot text generation cleanup failed.",
        new AggregateError(cleanupErrors, "GitHub Copilot text generation cleanup failed.", {
          cause: cleanupErrors[0],
        }),
      );
    }
    return generationResult.success;
  });

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("CopilotTextGeneration.generateCommitMessage")(function* (input) {
      const built = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runGeneration({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt: built.prompt,
        modelSelection: input.modelSelection,
        outputSchema: built.outputSchema,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("CopilotTextGeneration.generatePrContent")(function* (input) {
      const built = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });
      const generated = yield* runGeneration({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt: built.prompt,
        modelSelection: input.modelSelection,
        outputSchema: built.outputSchema,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("CopilotTextGeneration.generateBranchName")(function* (input) {
      const built = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runGeneration({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt: built.prompt,
        modelSelection: input.modelSelection,
        outputSchema: built.outputSchema,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("CopilotTextGeneration.generateThreadTitle")(function* (input) {
      const built = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });
      const generated = yield* runGeneration({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt: built.prompt,
        modelSelection: input.modelSelection,
        outputSchema: built.outputSchema,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
}

export const makeCopilotTextGeneration = Effect.fn("makeCopilotTextGeneration")(
  (
    settings: CopilotSettings,
    environment?: NodeJS.ProcessEnv,
    options: CopilotTextGenerationOptions = {},
  ): Effect.Effect<TextGeneration.TextGeneration["Service"]> =>
    Effect.sync(() => makeCopilotTextGenerationService(settings, environment, options)),
);
