import * as NodeAssert from "node:assert/strict";

import type { AssistantMessageEvent, SessionConfig } from "@github/copilot-sdk";
import { CopilotSettings, ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { makeCopilotTextGeneration } from "./CopilotTextGeneration.ts";

const decodeSettings = Schema.decodeSync(CopilotSettings);
const isTextGenerationError = Schema.is(TextGenerationError);
const modelSelection = {
  instanceId: ProviderInstanceId.make("githubCopilot"),
  model: "gpt-test",
  options: [{ id: "reasoningEffort", value: "high" }],
} as const;

function assistantMessage(content: string): AssistantMessageEvent {
  return {
    type: "assistant.message",
    id: "response-event",
    parentId: null,
    timestamp: "2026-08-01T00:00:00.000Z",
    data: {
      messageId: "response-message",
      content,
    },
  };
}

function neverPromise<T>(): Promise<T> {
  return new Promise(() => undefined);
}

it.effect("generates all bounded text operations with ambient features disabled", () =>
  Effect.gen(function* () {
    const responses = [
      '{"subject":"Add Copilot provider","body":"- Wire SDK","branch":"copilot-provider"}',
      '{"title":"Add Copilot provider","body":"## Summary\\n- Wire SDK\\n\\n## Testing\\n- Unit tests"}',
      '{"branch":"copilot-provider"}',
      '{"title":"Port Copilot Provider"}',
    ];
    const configs: SessionConfig[] = [];
    const prompts: string[] = [];
    let disconnects = 0;
    let stops = 0;
    let forceStops = 0;
    const cleanupCalls: string[] = [];
    const deletedSessionIds: string[] = [];
    const textGeneration = yield* makeCopilotTextGeneration(
      decodeSettings({ enabled: true }),
      undefined,
      {
        createSessionTimeoutMs: 100,
        clientFactory: () => ({
          start: async () => {},
          stop: async () => {
            stops += 1;
            cleanupCalls.push("stop");
            return [];
          },
          forceStop: async () => {
            forceStops += 1;
            cleanupCalls.push("force-stop");
          },
          deleteSession: async (sessionId) => {
            deletedSessionIds.push(sessionId);
            cleanupCalls.push("delete");
          },
          createSession: async (config) => {
            configs.push(config);
            return {
              sessionId: `text-session-${configs.length}`,
              sendAndWait: async (message) => {
                prompts.push(typeof message === "string" ? message : message.prompt);
                return assistantMessage(responses.shift() ?? "");
              },
              disconnect: async () => {
                disconnects += 1;
                cleanupCalls.push("disconnect");
              },
            };
          },
        }),
      },
    );

    const commit = yield* textGeneration.generateCommitMessage({
      cwd: process.cwd(),
      branch: "main",
      stagedSummary: "1 file changed",
      stagedPatch: "+copilot",
      includeBranch: true,
      modelSelection,
    });
    const pr = yield* textGeneration.generatePrContent({
      cwd: process.cwd(),
      baseBranch: "main",
      headBranch: "copilot-provider",
      commitSummary: "Add Copilot provider",
      diffSummary: "1 file changed",
      diffPatch: "+copilot",
      modelSelection,
    });
    const branch = yield* textGeneration.generateBranchName({
      cwd: process.cwd(),
      message: "Add Copilot provider",
      modelSelection,
    });
    const title = yield* textGeneration.generateThreadTitle({
      cwd: process.cwd(),
      message: "Port the Copilot provider",
      modelSelection,
    });

    NodeAssert.equal(commit.subject, "Add Copilot provider");
    NodeAssert.equal(commit.branch, "feature/copilot-provider");
    NodeAssert.equal(pr.title, "Add Copilot provider");
    NodeAssert.equal(branch.branch, "copilot-provider");
    NodeAssert.equal(title.title, "Port Copilot Provider");
    NodeAssert.equal(prompts.length, 4);
    NodeAssert.equal(disconnects, 4);
    NodeAssert.equal(stops, 4);
    NodeAssert.equal(forceStops, 0);
    NodeAssert.deepEqual(cleanupCalls, [
      "disconnect",
      "delete",
      "stop",
      "disconnect",
      "delete",
      "stop",
      "disconnect",
      "delete",
      "stop",
      "disconnect",
      "delete",
      "stop",
    ]);
    NodeAssert.deepEqual(deletedSessionIds, [
      "text-session-1",
      "text-session-2",
      "text-session-3",
      "text-session-4",
    ]);
    for (const config of configs) {
      NodeAssert.equal(config.model, "gpt-test");
      NodeAssert.equal(config.reasoningEffort, "high");
      NodeAssert.equal(config.enableConfigDiscovery, false);
      NodeAssert.equal(config.enableSkills, false);
      NodeAssert.deepEqual(config.availableTools, []);
      NodeAssert.deepEqual(config.mcpServers, {});
      NodeAssert.deepEqual(config.customAgents, []);
      NodeAssert.equal(config.skipCustomInstructions, true);
      NodeAssert.equal(config.infiniteSessions?.enabled, false);
    }
  }),
);

it.effect("bounds hanging session creation and force-stops without double cleanup", () =>
  Effect.gen(function* () {
    let markCreateCalled: (() => void) | undefined;
    const createCalled = new Promise<void>((resolve) => {
      markCreateCalled = resolve;
    });
    const lifecycleCalls: string[] = [];
    const textGeneration = yield* makeCopilotTextGeneration(
      decodeSettings({ enabled: true }),
      undefined,
      {
        createSessionTimeoutMs: 100,
        cleanupDeadlines: {
          clientStopMs: 100,
          forceStopMs: 100,
        },
        clientFactory: () => ({
          start: async () => {
            lifecycleCalls.push("start");
          },
          stop: async () => {
            lifecycleCalls.push("stop");
            return [];
          },
          forceStop: async () => {
            lifecycleCalls.push("force-stop");
          },
          deleteSession: async () => {
            lifecycleCalls.push("delete");
          },
          createSession: async () => {
            lifecycleCalls.push("create");
            markCreateCalled?.();
            return neverPromise();
          },
        }),
      },
    );

    const fiber = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "Bound session creation",
        modelSelection,
      })
      .pipe(Effect.result, Effect.forkChild);
    yield* Effect.promise(() => createCalled);
    yield* TestClock.adjust(100);
    const result = yield* Fiber.join(fiber);

    NodeAssert.equal(result._tag, "Failure");
    if (Result.isFailure(result)) {
      NodeAssert.equal(
        result.failure.detail,
        "GitHub Copilot text generation session creation timed out after 100ms.",
      );
    }
    NodeAssert.deepEqual(lifecycleCalls, ["start", "create", "stop", "force-stop"]);
  }),
);

it.effect(
  "cleans the client exactly once when interrupted during startup or session creation",
  () =>
    Effect.gen(function* () {
      for (const phase of ["start", "create"] as const) {
        let markPhaseReached: (() => void) | undefined;
        const phaseReached = new Promise<void>((resolve) => {
          markPhaseReached = resolve;
        });
        const lifecycleCalls: string[] = [];
        const textGeneration = yield* makeCopilotTextGeneration(
          decodeSettings({ enabled: true }),
          undefined,
          {
            createSessionTimeoutMs: 100,
            cleanupDeadlines: {
              clientStopMs: 100,
              forceStopMs: 100,
            },
            clientFactory: () => ({
              start: async () => {
                lifecycleCalls.push("start");
                if (phase === "start") {
                  markPhaseReached?.();
                  return neverPromise();
                }
              },
              stop: async () => {
                lifecycleCalls.push("stop");
                return [];
              },
              forceStop: async () => {
                lifecycleCalls.push("force-stop");
              },
              deleteSession: async () => {
                lifecycleCalls.push("delete");
              },
              createSession: async () => {
                lifecycleCalls.push("create");
                if (phase === "create") {
                  markPhaseReached?.();
                  return neverPromise();
                }
                return {
                  sessionId: "interrupted-start-session",
                  sendAndWait: async () => assistantMessage('{"title":"unused"}'),
                  disconnect: async () => {
                    lifecycleCalls.push("disconnect");
                  },
                };
              },
            }),
          },
        );

        const generationFiber = yield* textGeneration
          .generateThreadTitle({
            cwd: process.cwd(),
            message: `Interrupt during ${phase}`,
            modelSelection,
          })
          .pipe(Effect.forkChild);
        yield* Effect.promise(() => phaseReached);
        yield* Fiber.interrupt(generationFiber);
        const exit = yield* Fiber.await(generationFiber);

        NodeAssert.equal(Exit.isFailure(exit), true);
        if (Exit.isFailure(exit)) {
          NodeAssert.equal(Cause.hasInterruptsOnly(exit.cause), true);
        }
        NodeAssert.deepEqual(
          lifecycleCalls,
          phase === "start"
            ? ["start", "stop", "force-stop"]
            : ["start", "create", "stop", "force-stop"],
        );
      }
    }),
);

it.effect("finishes session cleanup before preserving send interruption", () =>
  Effect.gen(function* () {
    let markSendCalled: (() => void) | undefined;
    const sendCalled = new Promise<void>((resolve) => {
      markSendCalled = resolve;
    });
    let markDisconnectCalled: (() => void) | undefined;
    const disconnectCalled = new Promise<void>((resolve) => {
      markDisconnectCalled = resolve;
    });
    let releaseDisconnect: (() => void) | undefined;
    const disconnectReleased = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });
    const lifecycleCalls: string[] = [];
    const textGeneration = yield* makeCopilotTextGeneration(
      decodeSettings({ enabled: true }),
      undefined,
      {
        cleanupDeadlines: {
          disconnectMs: 100,
          deleteSessionMs: 100,
          clientStopMs: 100,
          forceStopMs: 100,
        },
        clientFactory: () => ({
          start: async () => {
            lifecycleCalls.push("start");
          },
          stop: async () => {
            lifecycleCalls.push("stop");
            return [];
          },
          forceStop: async () => {
            lifecycleCalls.push("force-stop");
          },
          deleteSession: async (sessionId) => {
            NodeAssert.equal(sessionId, "interrupted-send-session");
            lifecycleCalls.push("delete");
          },
          createSession: async () => {
            lifecycleCalls.push("create");
            return {
              sessionId: "interrupted-send-session",
              sendAndWait: async () => {
                lifecycleCalls.push("send");
                markSendCalled?.();
                return neverPromise();
              },
              disconnect: async () => {
                lifecycleCalls.push("disconnect");
                markDisconnectCalled?.();
                await disconnectReleased;
              },
            };
          },
        }),
      },
    );

    const generationFiber = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "Interrupt during send",
        modelSelection,
      })
      .pipe(Effect.forkChild);
    yield* Effect.promise(() => sendCalled);
    let interruptionFinished = false;
    const interruptFiber = yield* Fiber.interrupt(generationFiber).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          interruptionFinished = true;
        }),
      ),
      Effect.forkChild,
    );
    yield* Effect.promise(() => disconnectCalled);

    NodeAssert.equal(interruptionFinished, false);
    NodeAssert.deepEqual(lifecycleCalls, ["start", "create", "send", "disconnect"]);

    releaseDisconnect?.();
    yield* Fiber.join(interruptFiber);
    NodeAssert.equal(interruptionFinished, true);
    const exit = yield* Fiber.await(generationFiber);

    NodeAssert.equal(Exit.isFailure(exit), true);
    if (Exit.isFailure(exit)) {
      NodeAssert.equal(Cause.hasInterruptsOnly(exit.cause), true);
    }
    NodeAssert.deepEqual(lifecycleCalls, [
      "start",
      "create",
      "send",
      "disconnect",
      "delete",
      "stop",
      "force-stop",
    ]);
  }),
);

it.effect("fails malformed output while still disconnecting the session and client", () =>
  Effect.gen(function* () {
    let disconnected = false;
    let stopped = false;
    let deleted = false;
    const textGeneration = yield* makeCopilotTextGeneration(
      decodeSettings({ enabled: true }),
      undefined,
      {
        clientFactory: () => ({
          start: async () => {},
          stop: async () => {
            stopped = true;
            return [];
          },
          forceStop: async () => {},
          deleteSession: async (sessionId) => {
            NodeAssert.equal(sessionId, "malformed-session");
            deleted = true;
          },
          createSession: async () => ({
            sessionId: "malformed-session",
            sendAndWait: async () => assistantMessage("not json"),
            disconnect: async () => {
              disconnected = true;
            },
          }),
        }),
      },
    );

    const result = yield* textGeneration
      .generateBranchName({
        cwd: process.cwd(),
        message: "Add Copilot",
        modelSelection,
      })
      .pipe(Effect.result);

    NodeAssert.equal(Result.isFailure(result), true);
    NodeAssert.equal(disconnected, true);
    NodeAssert.equal(deleted, true);
    NodeAssert.equal(stopped, true);
  }),
);

it.effect("surfaces SDK timeout failures and still stops the client", () =>
  Effect.gen(function* () {
    let disconnected = false;
    let stopped = false;
    let deleted = false;
    const textGeneration = yield* makeCopilotTextGeneration(
      decodeSettings({ enabled: true }),
      undefined,
      {
        timeoutMs: 1,
        clientFactory: () => ({
          start: async () => {},
          stop: async () => {
            stopped = true;
            return [];
          },
          forceStop: async () => {},
          deleteSession: async (sessionId) => {
            NodeAssert.equal(sessionId, "timeout-session");
            deleted = true;
          },
          createSession: async () => ({
            sessionId: "timeout-session",
            sendAndWait: async () => {
              throw new Error("Timed out");
            },
            disconnect: async () => {
              disconnected = true;
            },
          }),
        }),
      },
    );

    const result = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "Add Copilot",
        modelSelection,
      })
      .pipe(Effect.result);

    NodeAssert.equal(Result.isFailure(result), true);
    NodeAssert.equal(disconnected, true);
    NodeAssert.equal(deleted, true);
    NodeAssert.equal(stopped, true);
  }),
);

it.effect("bounds a hanging session disconnect before deletion, stop, and force-stop", () =>
  Effect.gen(function* () {
    let markDisconnectCalled: (() => void) | undefined;
    const disconnectCalled = new Promise<void>((resolve) => {
      markDisconnectCalled = resolve;
    });
    const cleanupCalls: string[] = [];
    const textGeneration = yield* makeCopilotTextGeneration(
      decodeSettings({ enabled: true }),
      undefined,
      {
        cleanupDeadlines: {
          disconnectMs: 100,
          deleteSessionMs: 100,
          clientStopMs: 100,
          forceStopMs: 100,
        },
        clientFactory: () => ({
          start: async () => {},
          stop: async () => {
            cleanupCalls.push("stop");
            return [];
          },
          forceStop: async () => {
            cleanupCalls.push("force-stop");
          },
          deleteSession: async () => {
            cleanupCalls.push("delete");
          },
          createSession: async () => ({
            sessionId: "disconnect-hang-session",
            sendAndWait: async () => assistantMessage('{"title":"Bound cleanup"}'),
            disconnect: async () => {
              cleanupCalls.push("disconnect");
              markDisconnectCalled?.();
              return neverPromise();
            },
          }),
        }),
      },
    );

    const fiber = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "Bound cleanup",
        modelSelection,
      })
      .pipe(Effect.result, Effect.forkChild);
    yield* Effect.promise(() => disconnectCalled);
    yield* TestClock.adjust(100);
    const result = yield* Fiber.join(fiber);

    NodeAssert.equal(result._tag, "Failure");
    if (Result.isFailure(result)) {
      NodeAssert.equal(result.failure.detail, "GitHub Copilot text generation cleanup failed.");
    }
    NodeAssert.deepEqual(cleanupCalls, ["disconnect", "delete", "stop", "force-stop"]);
  }),
);

it.effect("bounds a hanging hidden-session deletion before stop and force-stop", () =>
  Effect.gen(function* () {
    let markDeleteCalled: (() => void) | undefined;
    const deleteCalled = new Promise<void>((resolve) => {
      markDeleteCalled = resolve;
    });
    const cleanupCalls: string[] = [];
    const textGeneration = yield* makeCopilotTextGeneration(
      decodeSettings({ enabled: true }),
      undefined,
      {
        cleanupDeadlines: {
          disconnectMs: 100,
          deleteSessionMs: 100,
          clientStopMs: 100,
          forceStopMs: 100,
        },
        clientFactory: () => ({
          start: async () => {},
          stop: async () => {
            cleanupCalls.push("stop");
            return [];
          },
          forceStop: async () => {
            cleanupCalls.push("force-stop");
          },
          deleteSession: async () => {
            cleanupCalls.push("delete");
            markDeleteCalled?.();
            return neverPromise();
          },
          createSession: async () => ({
            sessionId: "delete-hang-session",
            sendAndWait: async () => assistantMessage('{"title":"Bound deletion"}'),
            disconnect: async () => {
              cleanupCalls.push("disconnect");
            },
          }),
        }),
      },
    );

    const fiber = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "Bound deletion",
        modelSelection,
      })
      .pipe(Effect.result, Effect.forkChild);
    yield* Effect.promise(() => deleteCalled);
    yield* TestClock.adjust(100);
    const result = yield* Fiber.join(fiber);

    NodeAssert.equal(result._tag, "Failure");
    NodeAssert.deepEqual(cleanupCalls, ["disconnect", "delete", "stop", "force-stop"]);
  }),
);

it.effect("bounds a hanging client stop and falls back to force-stop", () =>
  Effect.gen(function* () {
    let markStopCalled: (() => void) | undefined;
    const stopCalled = new Promise<void>((resolve) => {
      markStopCalled = resolve;
    });
    const cleanupCalls: string[] = [];
    const textGeneration = yield* makeCopilotTextGeneration(
      decodeSettings({ enabled: true }),
      undefined,
      {
        cleanupDeadlines: {
          disconnectMs: 100,
          deleteSessionMs: 100,
          clientStopMs: 100,
          forceStopMs: 100,
        },
        clientFactory: () => ({
          start: async () => {},
          stop: async () => {
            cleanupCalls.push("stop");
            markStopCalled?.();
            return neverPromise();
          },
          forceStop: async () => {
            cleanupCalls.push("force-stop");
          },
          deleteSession: async () => {
            cleanupCalls.push("delete");
          },
          createSession: async () => ({
            sessionId: "stop-hang-session",
            sendAndWait: async () => assistantMessage('{"title":"Bound stop"}'),
            disconnect: async () => {
              cleanupCalls.push("disconnect");
            },
          }),
        }),
      },
    );

    const fiber = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "Bound stop",
        modelSelection,
      })
      .pipe(Effect.result, Effect.forkChild);
    yield* Effect.promise(() => stopCalled);
    yield* TestClock.adjust(100);
    const result = yield* Fiber.join(fiber);

    NodeAssert.equal(result._tag, "Failure");
    NodeAssert.deepEqual(cleanupCalls, ["disconnect", "delete", "stop", "force-stop"]);
  }),
);

it.effect("bounds force-stop when graceful client cleanup fails", () =>
  Effect.gen(function* () {
    let markForceStopCalled: (() => void) | undefined;
    const forceStopCalled = new Promise<void>((resolve) => {
      markForceStopCalled = resolve;
    });
    const cleanupCalls: string[] = [];
    const textGeneration = yield* makeCopilotTextGeneration(
      decodeSettings({ enabled: true }),
      undefined,
      {
        cleanupDeadlines: {
          disconnectMs: 100,
          deleteSessionMs: 100,
          clientStopMs: 100,
          forceStopMs: 50,
        },
        clientFactory: () => ({
          start: async () => {},
          stop: async () => {
            cleanupCalls.push("stop");
            return [new Error("stop failed")];
          },
          forceStop: async () => {
            cleanupCalls.push("force-stop");
            markForceStopCalled?.();
            return neverPromise();
          },
          deleteSession: async () => {
            cleanupCalls.push("delete");
          },
          createSession: async () => ({
            sessionId: "force-stop-hang-session",
            sendAndWait: async () => assistantMessage('{"title":"Bound force stop"}'),
            disconnect: async () => {
              cleanupCalls.push("disconnect");
            },
          }),
        }),
      },
    );

    const fiber = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "Bound force stop",
        modelSelection,
      })
      .pipe(Effect.result, Effect.forkChild);
    yield* Effect.promise(() => forceStopCalled);
    yield* TestClock.adjust(50);
    const result = yield* Fiber.join(fiber);

    NodeAssert.equal(result._tag, "Failure");
    NodeAssert.deepEqual(cleanupCalls, ["disconnect", "delete", "stop", "force-stop"]);
  }),
);

it.effect("preserves the generation timeout when cleanup also times out", () =>
  Effect.gen(function* () {
    const generationCause = new Error("Timed out");
    let markDisconnectCalled: (() => void) | undefined;
    const disconnectCalled = new Promise<void>((resolve) => {
      markDisconnectCalled = resolve;
    });
    let forceStops = 0;
    const textGeneration = yield* makeCopilotTextGeneration(
      decodeSettings({ enabled: true }),
      undefined,
      {
        cleanupDeadlines: {
          disconnectMs: 100,
          deleteSessionMs: 100,
          clientStopMs: 100,
          forceStopMs: 100,
        },
        clientFactory: () => ({
          start: async () => {},
          stop: async () => [],
          forceStop: async () => {
            forceStops += 1;
          },
          deleteSession: async () => {},
          createSession: async () => ({
            sessionId: "primary-error-session",
            sendAndWait: async () => {
              throw generationCause;
            },
            disconnect: async () => {
              markDisconnectCalled?.();
              return neverPromise();
            },
          }),
        }),
      },
    );

    const fiber = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "Preserve the primary error",
        modelSelection,
      })
      .pipe(Effect.result, Effect.forkChild);
    yield* Effect.promise(() => disconnectCalled);
    yield* TestClock.adjust(100);
    const result = yield* Fiber.join(fiber);

    NodeAssert.equal(result._tag, "Failure");
    if (Result.isFailure(result)) {
      NodeAssert.equal(
        result.failure.detail,
        "GitHub Copilot text generation failed. Cleanup also failed.",
      );
      NodeAssert.ok(result.failure.cause instanceof AggregateError);
      const primaryFailure = result.failure.cause.cause;
      NodeAssert.ok(isTextGenerationError(primaryFailure));
      if (isTextGenerationError(primaryFailure)) {
        NodeAssert.equal(primaryFailure.cause, generationCause);
      }
      NodeAssert.equal(result.failure.cause.errors[0], primaryFailure);
    }
    NodeAssert.equal(forceStops, 1);
  }),
);
