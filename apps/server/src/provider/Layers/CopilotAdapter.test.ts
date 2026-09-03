// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type {
  PermissionRequest,
  PermissionRequestResult,
  SessionConfig,
  SessionEvent,
} from "@github/copilot-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ApprovalRequestId,
  CopilotSettings,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { afterEach, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  makeCopilotAdapter,
  type CopilotClientHandle,
  type CopilotSessionHandle,
} from "./CopilotAdapter.ts";

const decodeSettings = Schema.decodeSync(CopilotSettings);
const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const INSTANCE_ID = ProviderInstanceId.make("githubCopilot");
const TEST_STATE_DIR = NodePath.join(process.cwd(), ".test-artifacts", "copilot-adapter");
const neverPromise = <A>(): Promise<A> => new Promise(() => {});

function sessionEvent<T extends SessionEvent>(
  value: Omit<T, "id" | "parentId" | "timestamp">,
  sequence: number,
): T {
  return {
    id: `copilot-event-${sequence}`,
    parentId: null,
    timestamp: `2026-07-29T12:00:${String(sequence).padStart(2, "0")}.000Z`,
    ...value,
  } as T;
}

function makeFakeRuntime(input?: {
  readonly resumeSessionId?: string;
  readonly resumeAlreadyInUse?: boolean;
  readonly tasks?: Awaited<ReturnType<CopilotSessionHandle["rpc"]["tasks"]["list"]>>["tasks"];
  readonly skills?: Awaited<ReturnType<CopilotSessionHandle["rpc"]["skills"]["list"]>>["skills"];
  readonly tasksList?: CopilotSessionHandle["rpc"]["tasks"]["list"];
  readonly planRead?: CopilotSessionHandle["rpc"]["plan"]["read"];
  readonly queuedCommandResponse?: CopilotSessionHandle["rpc"]["commands"]["respondToQueuedCommand"];
  readonly disconnect?: CopilotSessionHandle["disconnect"];
  readonly stop?: CopilotClientHandle["stop"];
  readonly forceStop?: CopilotClientHandle["forceStop"];
}) {
  let config: SessionConfig | undefined;
  let created = 0;
  let resumed = 0;
  let disconnected = 0;
  let stopped = 0;
  let forceStopped = 0;
  let tasksListCalls = 0;
  let queuedCommandResponses = 0;
  const sent: Array<Parameters<CopilotSessionHandle["send"]>[0]> = [];
  const session: CopilotSessionHandle = {
    sessionId: input?.resumeSessionId ?? "copilot-session-1",
    send: async (message) => {
      sent.push(message);
      return "message-1";
    },
    abort: async () => {},
    disconnect: async () => {
      disconnected += 1;
      await input?.disconnect?.();
    },
    getEvents: async () => [],
    setModel: async () => {},
    rpc: {
      commands: {
        respondToQueuedCommand: async (request) => {
          queuedCommandResponses += 1;
          if (input?.queuedCommandResponse) {
            return input.queuedCommandResponse(request);
          }
          return { success: true };
        },
      },
      mode: { set: async () => {} },
      model: {
        setReasoningEffort: async ({ reasoningEffort }) => ({ reasoningEffort }),
      },
      plan: {
        read: input?.planRead ?? (async () => ({ exists: false, content: null, path: null })),
      },
      skills: { list: async () => ({ skills: input?.skills ?? [] }) },
      tasks: {
        list: async () => {
          tasksListCalls += 1;
          return input?.tasksList ? input.tasksList() : { tasks: input?.tasks ?? [] };
        },
      },
    },
  };
  const client: CopilotClientHandle = {
    start: async () => {},
    stop: async () => {
      stopped += 1;
      return input?.stop ? input.stop() : [];
    },
    forceStop: async () => {
      forceStopped += 1;
      await input?.forceStop?.();
    },
    createSession: async (nextConfig) => {
      created += 1;
      config = nextConfig;
      return session;
    },
    resumeSession: async (_sessionId, nextConfig) => {
      resumed += 1;
      config = nextConfig;
      if (input?.resumeAlreadyInUse) {
        nextConfig.onEvent?.(
          sessionEvent(
            {
              type: "session.resume",
              data: {
                alreadyInUse: true,
                eventCount: 1,
                resumeTime: "2026-07-29T12:00:00.000Z",
              },
            },
            99,
          ),
        );
      }
      return session;
    },
  };
  return {
    client,
    sent,
    emit: (event: SessionEvent) => config?.onEvent?.(event),
    getConfig: () => config,
    counts: () => ({
      created,
      resumed,
      disconnected,
      stopped,
      forceStopped,
      tasksListCalls,
      queuedCommandResponses,
    }),
  };
}

function collectUntil(
  adapter: { readonly streamEvents: Stream.Stream<ProviderRuntimeEvent> },
  predicate: (event: ProviderRuntimeEvent) => boolean,
) {
  return Effect.gen(function* () {
    const events: ProviderRuntimeEvent[] = [];
    const done = yield* Deferred.make<void>();
    const fiber = yield* adapter.streamEvents.pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => events.push(event)).pipe(
          Effect.andThen(predicate(event) ? Deferred.succeed(done, undefined) : Effect.void),
        ),
      ),
      Effect.forkChild,
    );
    yield* Effect.yieldNow;
    return {
      events,
      fiber,
      awaitDone: Deferred.await(done),
    };
  });
}

const testLayer = ServerConfig.layerTest(process.cwd(), TEST_STATE_DIR).pipe(
  Layer.provideMerge(NodeServices.layer),
);

afterEach(() => {
  McpProviderSession.clearAllMcpProviderSessions();
  NodeFS.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
});

describe("CopilotAdapter", () => {
  it.effect("creates a native session and timestamps turn.started at send", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = makeFakeRuntime();
        const serverConfig = yield* ServerConfig;
        const adapter = yield* makeCopilotAdapter(
          decodeSettings({ enabled: true, enableConfigDiscovery: false }),
          {
            instanceId: INSTANCE_ID,
            clientFactory: () => fake.client,
          },
        );
        const collected = yield* collectUntil(adapter, (event) => event.type === "turn.completed");

        const threadId = ThreadId.make("thread-copilot");
        McpProviderSession.setMcpProviderSession({
          environmentId: EnvironmentId.make("local"),
          threadId,
          providerSessionId: "t3-session",
          providerInstanceId: INSTANCE_ID,
          endpoint: "http://127.0.0.1:3000/mcp",
          authorizationHeader: "Bearer test",
        });
        NodeFS.writeFileSync(
          NodePath.join(serverConfig.attachmentsDir, "attachment-1.txt"),
          "notes",
        );
        const session = yield* adapter.startSession({
          threadId,
          providerInstanceId: INSTANCE_ID,
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        NodeAssert.deepEqual(session.resumeCursor, {
          schemaVersion: 1,
          sessionId: "copilot-session-1",
        });
        NodeAssert.equal(fake.getConfig()?.enableConfigDiscovery, false);
        NodeAssert.equal(fake.getConfig()?.skipCustomInstructions, true);

        const started = yield* adapter.sendTurn({
          threadId: session.threadId,
          input: "hello",
          attachments: [
            {
              type: "file",
              id: "attachment-1",
              name: "notes.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
            },
          ],
          interactionMode: "default",
        });

        fake.emit(
          sessionEvent(
            {
              type: "assistant.turn_start",
              data: { turnId: "native-turn-1", model: "gpt-test" },
            },
            1,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "assistant.message_delta",
              ephemeral: true,
              data: { messageId: "message-1", deltaContent: "Hello" },
            },
            2,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "assistant.message",
              data: { messageId: "message-1", content: "Hello", turnId: "native-turn-1" },
            },
            3,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "assistant.turn_end",
              data: { turnId: "native-turn-1", model: "gpt-test" },
            },
            4,
          ),
        );
        yield* collected.awaitDone;
        yield* Fiber.interrupt(collected.fiber);

        const turnStarted = collected.events.find(
          (event) => event.type === "turn.started" && event.turnId === started.turnId,
        );
        NodeAssert.ok(turnStarted);
        NodeAssert.equal(turnStarted.raw?.messageType, "session.send");
        NodeAssert.deepEqual(
          collected.events.map((event) => event.type),
          [
            "session.started",
            "thread.started",
            "turn.started",
            "content.delta",
            "item.completed",
            "turn.completed",
          ],
        );
        NodeAssert.notEqual(
          turnStarted.createdAt,
          sessionEvent(
            {
              type: "assistant.turn_start",
              data: { turnId: "native-turn-1", model: "gpt-test" },
            },
            1,
          ).timestamp,
        );
        NodeAssert.equal(fake.sent.length, 1);
        NodeAssert.equal(fake.sent[0]?.attachments?.[0]?.type, "file");
        NodeAssert.deepEqual(fake.getConfig()?.mcpServers?.["t3-code"], {
          type: "http",
          url: "http://127.0.0.1:3000/mcp",
          headers: { Authorization: "Bearer test" },
        });
        NodeAssert.equal(fake.counts().created, 1);
      }).pipe(Effect.provide(testLayer)),
    ),
  );

  it.effect("resumes by native session id and disconnects on stop", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = makeFakeRuntime({ resumeSessionId: "native-resume-id" });
        const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
          instanceId: INSTANCE_ID,
          clientFactory: () => fake.client,
        });
        const threadId = ThreadId.make("thread-copilot-resume");
        const session = yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("copilot"),
          providerInstanceId: INSTANCE_ID,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          resumeCursor: { schemaVersion: 1, sessionId: "native-resume-id" },
        });

        NodeAssert.equal(session.provider, "githubCopilot");
        NodeAssert.equal(fake.counts().resumed, 1);
        yield* adapter.stopSession(threadId);
        NodeAssert.equal(fake.counts().disconnected, 1);
        NodeAssert.equal(yield* adapter.hasSession(threadId), false);
      }).pipe(Effect.provide(testLayer)),
    ),
  );

  it.effect("rejects a resume claim already owned by another SDK client", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = makeFakeRuntime({
          resumeSessionId: "owned-native-session",
          resumeAlreadyInUse: true,
        });
        const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
          instanceId: INSTANCE_ID,
          clientFactory: () => fake.client,
        });
        const threadId = ThreadId.make("thread-copilot-owned-resume");
        const result = yield* adapter
          .startSession({
            threadId,
            providerInstanceId: INSTANCE_ID,
            cwd: process.cwd(),
            runtimeMode: "full-access",
            resumeCursor: { schemaVersion: 1, sessionId: "owned-native-session" },
          })
          .pipe(Effect.result);

        NodeAssert.equal(result._tag, "Failure");
        if (result._tag === "Failure") {
          NodeAssert.match(result.failure.message, /already in use by another client/u);
        }
        NodeAssert.deepEqual(fake.counts(), {
          created: 0,
          resumed: 1,
          disconnected: 1,
          stopped: 0,
          forceStopped: 0,
          tasksListCalls: 0,
          queuedCommandResponses: 0,
        });
        NodeAssert.equal(yield* adapter.hasSession(threadId), false);
      }).pipe(Effect.provide(testLayer)),
    ),
  );

  it.effect("bridges approvals, user input, and proposed plans", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = makeFakeRuntime();
        const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
          instanceId: INSTANCE_ID,
          clientFactory: () => fake.client,
        });
        const threadId = ThreadId.make("thread-copilot-input");
        yield* adapter.startSession({
          threadId,
          providerInstanceId: INSTANCE_ID,
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });

        const permissionEvents = yield* collectUntil(
          adapter,
          (event) => event.type === "request.opened",
        );
        const permission: PermissionRequest = {
          kind: "shell",
          canOfferSessionApproval: true,
          commands: [{ identifier: "git", readOnly: true }],
          fullCommandText: "git status",
          hasWriteFileRedirection: false,
          intention: "Inspect status",
          possiblePaths: [],
          possibleUrls: [],
        };
        const permissionPromise = fake.getConfig()?.onPermissionRequest?.(permission, {
          sessionId: "copilot-session-1",
        });
        yield* permissionEvents.awaitDone;
        const approvalEvent = permissionEvents.events.find(
          (event) => event.type === "request.opened",
        );
        NodeAssert.ok(approvalEvent?.requestId);
        yield* adapter.respondToRequest(
          threadId,
          ApprovalRequestId.make(approvalEvent.requestId),
          "acceptForSession",
        );
        NodeAssert.deepEqual(yield* Effect.promise(() => Promise.resolve(permissionPromise)), {
          kind: "approve-for-session",
          approval: { kind: "commands", commandIdentifiers: ["git"] },
        } satisfies PermissionRequestResult);
        yield* Fiber.interrupt(permissionEvents.fiber);

        const oneShotEvents = yield* collectUntil(
          adapter,
          (event) => event.type === "request.opened",
        );
        const oneShotPromise = fake
          .getConfig()
          ?.onPermissionRequest?.(
            { ...permission, canOfferSessionApproval: false },
            { sessionId: "copilot-session-1" },
          );
        yield* oneShotEvents.awaitDone;
        const oneShotEvent = oneShotEvents.events.find((event) => event.type === "request.opened");
        NodeAssert.ok(oneShotEvent?.requestId);
        if (oneShotEvent?.type === "request.opened") {
          NodeAssert.deepEqual(
            oneShotEvent.payload.options?.map((option) => option.decision),
            ["accept", "decline"],
          );
        }
        const unsupported = yield* adapter
          .respondToRequest(
            threadId,
            ApprovalRequestId.make(oneShotEvent.requestId),
            "acceptAlways",
          )
          .pipe(Effect.result);
        NodeAssert.equal(unsupported._tag, "Failure");
        yield* adapter.respondToRequest(
          threadId,
          ApprovalRequestId.make(oneShotEvent.requestId),
          "accept",
        );
        NodeAssert.deepEqual(yield* Effect.promise(() => Promise.resolve(oneShotPromise)), {
          kind: "approve-once",
        } satisfies PermissionRequestResult);
        yield* Fiber.interrupt(oneShotEvents.fiber);

        const inputEvents = yield* collectUntil(
          adapter,
          (event) => event.type === "user-input.requested",
        );
        const inputPromise = fake
          .getConfig()
          ?.onUserInputRequest?.({ question: "What next?" }, { sessionId: "copilot-session-1" });
        yield* inputEvents.awaitDone;
        const inputEvent = inputEvents.events.find(
          (event) => event.type === "user-input.requested",
        );
        NodeAssert.ok(inputEvent?.requestId);
        if (inputEvent?.type === "user-input.requested") {
          NodeAssert.equal(inputEvent.payload.questions[0]?.options.length, 1);
        }
        yield* adapter.respondToUserInput(threadId, ApprovalRequestId.make(inputEvent.requestId), {
          answer: "Continue",
        });
        NodeAssert.deepEqual(yield* Effect.promise(() => Promise.resolve(inputPromise)), {
          answer: "Continue",
          wasFreeform: true,
        });
        yield* Fiber.interrupt(inputEvents.fiber);

        const planEvents = yield* collectUntil(
          adapter,
          (event) => event.type === "turn.proposed.completed",
        );
        const planResult = fake.getConfig()?.onExitPlanModeRequest?.(
          {
            summary: "Plan summary",
            planContent: "1. Implement safely",
            actions: [],
            recommendedAction: "implement",
          },
          { sessionId: "copilot-session-1" },
        );
        yield* planEvents.awaitDone;
        NodeAssert.deepEqual(yield* Effect.promise(() => Promise.resolve(planResult)), {
          approved: false,
        });
        NodeAssert.equal(
          planEvents.events.find((event) => event.type === "turn.proposed.completed")?.payload
            .planMarkdown,
          "1. Implement safely",
        );
        yield* Fiber.interrupt(planEvents.fiber);
      }).pipe(Effect.provide(testLayer)),
    ),
  );

  it.effect(
    "preserves stream whitespace and keeps subagent messages out of the root transcript",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fake = makeFakeRuntime();
          const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
            instanceId: INSTANCE_ID,
            clientFactory: () => fake.client,
          });
          const threadId = ThreadId.make("thread-copilot-streaming");
          const collected = yield* collectUntil(
            adapter,
            (event) => event.type === "turn.completed",
          );
          yield* adapter.startSession({
            threadId,
            providerInstanceId: INSTANCE_ID,
            cwd: process.cwd(),
            runtimeMode: "full-access",
          });
          yield* adapter.sendTurn({ threadId, input: "stream" });

          fake.emit(
            sessionEvent(
              {
                type: "subagent.started",
                agentId: "agent-stream",
                data: {
                  agentDescription: "Explore",
                  agentDisplayName: "Explorer",
                  agentName: "explore",
                  toolCallId: "agent-stream-tool",
                },
              },
              30,
            ),
          );
          fake.emit(
            sessionEvent(
              {
                type: "assistant.message_delta",
                agentId: "agent-stream",
                ephemeral: true,
                data: { messageId: "agent-message", deltaContent: "must not reach root" },
              },
              31,
            ),
          );
          fake.emit(
            sessionEvent(
              {
                type: "assistant.message",
                agentId: "agent-stream",
                data: { messageId: "agent-message", content: "Agent result" },
              },
              32,
            ),
          );
          fake.emit(
            sessionEvent(
              {
                type: "subagent.completed",
                agentId: "agent-stream",
                data: {
                  agentDisplayName: "Explorer",
                  agentName: "explore",
                  toolCallId: "agent-stream-tool",
                },
              },
              33,
            ),
          );
          fake.emit(
            sessionEvent(
              {
                type: "assistant.message_delta",
                ephemeral: true,
                data: { messageId: "root-message", deltaContent: "  * item\n\n" },
              },
              34,
            ),
          );
          fake.emit(
            sessionEvent(
              {
                type: "assistant.reasoning_delta",
                ephemeral: true,
                data: { reasoningId: "root-reasoning", deltaContent: "\n  indented" },
              },
              35,
            ),
          );
          fake.emit(
            sessionEvent(
              {
                type: "assistant.message",
                data: { messageId: "root-message", content: "Root answer" },
              },
              36,
            ),
          );
          fake.emit(
            sessionEvent(
              {
                type: "assistant.turn_end",
                data: { turnId: "native-stream-turn", model: "gpt-test" },
              },
              37,
            ),
          );
          yield* collected.awaitDone;
          yield* Fiber.interrupt(collected.fiber);

          const deltas = collected.events.filter((event) => event.type === "content.delta");
          NodeAssert.deepEqual(
            deltas.map((event) => event.payload.delta),
            ["  * item\n\n", "\n  indented"],
          );
          NodeAssert.equal(
            collected.events.some(
              (event) =>
                event.type === "item.completed" &&
                event.itemId === "agent-message" &&
                event.payload.itemType === "assistant_message",
            ),
            false,
          );
          const agentProgress = collected.events.find(
            (event) => event.type === "task.progress" && event.payload.taskId === "agent-stream",
          );
          NodeAssert.equal(
            agentProgress?.type === "task.progress" ? agentProgress.payload.summary : undefined,
            "Agent result",
          );
          const agentCompletion = collected.events.find(
            (event) => event.type === "task.completed" && event.payload.taskId === "agent-stream",
          );
          NodeAssert.equal(
            agentCompletion?.type === "task.completed"
              ? agentCompletion.payload.summary
              : undefined,
            "Agent result",
          );
        }).pipe(Effect.provide(testLayer)),
      ),
  );

  it.effect("accumulates per-turn usage and permits identical plans on later turns", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = makeFakeRuntime();
        const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
          instanceId: INSTANCE_ID,
          clientFactory: () => fake.client,
        });
        const threadId = ThreadId.make("thread-copilot-usage");
        yield* adapter.startSession({
          threadId,
          providerInstanceId: INSTANCE_ID,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        const firstTurnEvents = yield* collectUntil(
          adapter,
          (event) => event.type === "turn.completed",
        );
        yield* adapter.sendTurn({ threadId, input: "first" });
        fake.getConfig()?.onExitPlanModeRequest?.(
          {
            summary: "Same plan",
            planContent: "1. Same plan",
            actions: [],
            recommendedAction: "implement",
          },
          { sessionId: "copilot-session-1" },
        );
        yield* Effect.yieldNow;
        fake.emit(
          sessionEvent(
            {
              type: "assistant.usage",
              data: {
                model: "gpt-a",
                inputTokens: 10,
                cacheReadTokens: 2,
                cacheWriteTokens: 3,
                outputTokens: 4,
                reasoningTokens: 1,
                duration: 100,
                copilotUsage: { totalNanoAiu: 20 },
              },
            },
            40,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "assistant.usage",
              data: {
                model: "gpt-b",
                inputTokens: 5,
                outputTokens: 5,
                duration: 50,
                copilotUsage: { totalNanoAiu: 10 },
              },
            },
            41,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "assistant.turn_end",
              data: { turnId: "native-usage-turn-1", model: "gpt-b" },
            },
            42,
          ),
        );
        yield* firstTurnEvents.awaitDone;
        yield* Fiber.interrupt(firstTurnEvents.fiber);
        const firstCompletion = firstTurnEvents.events.find(
          (event) => event.type === "turn.completed",
        );
        if (firstCompletion?.type !== "turn.completed") {
          throw new Error("expected first turn completion");
        }
        const { calls, ...usageTotals } = firstCompletion.payload.usage as {
          readonly calls: ReadonlyArray<unknown>;
          readonly apiCalls: number;
          readonly inputTokens: number;
          readonly cachedInputTokens: number;
          readonly cacheWriteTokens: number;
          readonly outputTokens: number;
          readonly reasoningOutputTokens: number;
          readonly durationMs: number;
          readonly totalNanoAiu: number;
        };
        NodeAssert.equal(calls.length, 2);
        NodeAssert.deepEqual(usageTotals, {
          apiCalls: 2,
          inputTokens: 15,
          cachedInputTokens: 2,
          cacheWriteTokens: 3,
          outputTokens: 9,
          reasoningOutputTokens: 1,
          durationMs: 150,
          totalNanoAiu: 30,
        });
        NodeAssert.deepEqual(Object.keys(firstCompletion.payload.modelUsage ?? {}).sort(), [
          "gpt-a",
          "gpt-b",
        ]);

        const secondPlanEvents = yield* collectUntil(
          adapter,
          (event) => event.type === "turn.proposed.completed",
        );
        yield* adapter.sendTurn({ threadId, input: "second" });
        fake.getConfig()?.onExitPlanModeRequest?.(
          {
            summary: "Same plan",
            planContent: "1. Same plan",
            actions: [],
            recommendedAction: "implement",
          },
          { sessionId: "copilot-session-1" },
        );
        yield* secondPlanEvents.awaitDone;
        yield* Fiber.interrupt(secondPlanEvents.fiber);

        NodeAssert.equal(
          firstTurnEvents.events.filter((event) => event.type === "turn.proposed.completed").length,
          1,
        );
        NodeAssert.equal(
          secondPlanEvents.events.filter((event) => event.type === "turn.proposed.completed")
            .length,
          1,
        );
      }).pipe(Effect.provide(testLayer)),
    ),
  );

  it.effect("serializes explicit stop behind event handling and discards late events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const skillHandlingStarted = yield* Deferred.make<void>();
        const releaseSkillHandling = yield* Deferred.make<void>();
        const fake = makeFakeRuntime();
        const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
          instanceId: INSTANCE_ID,
          clientFactory: () => fake.client,
          onSkillsChanged: ({ skills }) =>
            skills.length === 0
              ? Effect.void
              : Deferred.succeed(skillHandlingStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseSkillHandling)),
                ),
        });
        const threadId = ThreadId.make("thread-copilot-stop-serialized");
        yield* adapter.startSession({
          threadId,
          providerInstanceId: INSTANCE_ID,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        const collected = yield* collectUntil(adapter, (event) => event.type === "session.exited");
        fake.emit(
          sessionEvent(
            {
              type: "session.skills_loaded",
              ephemeral: true,
              data: {
                skills: [
                  {
                    name: "personal",
                    description: "Personal skill",
                    enabled: true,
                    source: "personal-copilot",
                    userInvocable: true,
                    path: "/skills/personal/SKILL.md",
                  },
                ],
              },
            },
            45,
          ),
        );
        yield* Deferred.await(skillHandlingStarted);
        const stopFiber = yield* adapter.stopSession(threadId).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        NodeAssert.equal(fake.counts().disconnected, 0);
        yield* Deferred.succeed(releaseSkillHandling, undefined);
        yield* Fiber.join(stopFiber);
        yield* collected.awaitDone;

        fake.emit(
          sessionEvent(
            {
              type: "assistant.message",
              data: { messageId: "late-message", content: "Must stay discarded" },
            },
            46,
          ),
        );
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(collected.fiber);
        NodeAssert.equal(fake.counts().disconnected, 1);
        NodeAssert.equal(
          collected.events.some((event) => event.itemId === "late-message"),
          false,
        );
      }).pipe(Effect.provide(testLayer)),
    ),
  );

  it.effect("bounds event RPC drain time while preserving graceful disconnect", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let markTasksListCalled: (() => void) | undefined;
        const tasksListCalled = new Promise<void>((resolve) => {
          markTasksListCalled = resolve;
        });
        const fake = makeFakeRuntime({
          tasksList: async () => {
            markTasksListCalled?.();
            return neverPromise();
          },
        });
        const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
          instanceId: INSTANCE_ID,
          clientFactory: () => fake.client,
          deadlines: {
            eventRpcMs: 100,
            eventDrainMs: 200,
            disconnectMs: 100,
          },
        });
        const threadId = ThreadId.make("thread-copilot-bounded-event");
        yield* adapter.startSession({
          threadId,
          providerInstanceId: INSTANCE_ID,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        fake.emit(
          sessionEvent(
            {
              type: "session.background_tasks_changed",
              ephemeral: true,
              data: {},
            },
            60,
          ),
        );
        yield* Effect.promise(() => tasksListCalled);
        const stopFiber = yield* adapter
          .stopSession(threadId)
          .pipe(Effect.result, Effect.forkChild);
        yield* TestClock.adjust(100);
        const stopResult = yield* Fiber.join(stopFiber);

        NodeAssert.equal(stopResult._tag, "Success");
        NodeAssert.equal(fake.counts().tasksListCalls, 1);
        NodeAssert.equal(fake.counts().disconnected, 1);
        NodeAssert.equal(fake.counts().forceStopped, 0);
      }).pipe(Effect.provide(testLayer)),
    ),
  );

  it.effect("force-stops when the event semaphore cannot drain by its deadline", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const skillHandlingStarted = yield* Deferred.make<void>();
        const releaseSkillHandling = yield* Deferred.make<void>();
        const fake = makeFakeRuntime();
        const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
          instanceId: INSTANCE_ID,
          clientFactory: () => fake.client,
          onSkillsChanged: ({ skills }) =>
            skills.length === 0
              ? Effect.void
              : Deferred.succeed(skillHandlingStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseSkillHandling)),
                ),
          deadlines: {
            eventDrainMs: 100,
            disconnectMs: 100,
            forceStopMs: 100,
          },
        });
        const threadId = ThreadId.make("thread-copilot-event-drain-timeout");
        yield* adapter.startSession({
          threadId,
          providerInstanceId: INSTANCE_ID,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        fake.emit(
          sessionEvent(
            {
              type: "session.skills_loaded",
              ephemeral: true,
              data: {
                skills: [
                  {
                    name: "personal",
                    description: "Personal skill",
                    enabled: true,
                    source: "personal-copilot",
                    userInvocable: true,
                    path: "/skills/personal/SKILL.md",
                  },
                ],
              },
            },
            61,
          ),
        );
        yield* Deferred.await(skillHandlingStarted);
        const stopFiber = yield* adapter
          .stopSession(threadId)
          .pipe(Effect.result, Effect.forkChild);
        yield* TestClock.adjust(100);
        const stopResult = yield* Fiber.join(stopFiber);

        NodeAssert.equal(stopResult._tag, "Failure");
        NodeAssert.equal(fake.counts().disconnected, 0);
        NodeAssert.equal(fake.counts().forceStopped, 1);
        NodeAssert.equal(yield* adapter.hasSession(threadId), false);
        yield* Deferred.succeed(releaseSkillHandling, undefined);
        yield* Effect.yieldNow;
      }).pipe(Effect.provide(testLayer)),
    ),
  );

  it.effect("force-stops the shared client when session disconnect misses its deadline", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let markDisconnectCalled: (() => void) | undefined;
        const disconnectCalled = new Promise<void>((resolve) => {
          markDisconnectCalled = resolve;
        });
        const fake = makeFakeRuntime({
          disconnect: async () => {
            markDisconnectCalled?.();
            return neverPromise();
          },
        });
        const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
          instanceId: INSTANCE_ID,
          clientFactory: () => fake.client,
          deadlines: {
            eventDrainMs: 200,
            disconnectMs: 100,
            forceStopMs: 100,
          },
        });
        const firstThreadId = ThreadId.make("thread-copilot-disconnect-timeout");
        const secondThreadId = ThreadId.make("thread-copilot-force-stop-sibling");
        for (const threadId of [firstThreadId, secondThreadId]) {
          yield* adapter.startSession({
            threadId,
            providerInstanceId: INSTANCE_ID,
            cwd: process.cwd(),
            runtimeMode: "full-access",
          });
        }

        const stopFiber = yield* adapter
          .stopSession(firstThreadId)
          .pipe(Effect.result, Effect.forkChild);
        yield* Effect.promise(() => disconnectCalled);
        yield* TestClock.adjust(100);
        const stopResult = yield* Fiber.join(stopFiber);

        NodeAssert.equal(stopResult._tag, "Failure");
        NodeAssert.equal(fake.counts().forceStopped, 1);
        NodeAssert.equal(yield* adapter.hasSession(firstThreadId), false);
        NodeAssert.equal(yield* adapter.hasSession(secondThreadId), false);
      }).pipe(Effect.provide(testLayer)),
    ),
  );

  it.effect("bounds finalizer stop and force-stop deadlines", () =>
    Effect.gen(function* () {
      let markStopCalled: (() => void) | undefined;
      const stopCalled = new Promise<void>((resolve) => {
        markStopCalled = resolve;
      });
      let markForceStopCalled: (() => void) | undefined;
      const forceStopCalled = new Promise<void>((resolve) => {
        markForceStopCalled = resolve;
      });
      const fake = makeFakeRuntime({
        stop: async () => {
          markStopCalled?.();
          return neverPromise();
        },
        forceStop: async () => {
          markForceStopCalled?.();
          return neverPromise();
        },
      });
      const scopedAdapter = Effect.scoped(
        Effect.gen(function* () {
          const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
            instanceId: INSTANCE_ID,
            clientFactory: () => fake.client,
            deadlines: {
              disconnectMs: 100,
              eventDrainMs: 200,
              clientStopMs: 100,
              forceStopMs: 50,
            },
          });
          yield* adapter.startSession({
            threadId: ThreadId.make("thread-copilot-finalizer-timeout"),
            providerInstanceId: INSTANCE_ID,
            cwd: process.cwd(),
            runtimeMode: "full-access",
          });
        }).pipe(Effect.provide(testLayer)),
      );
      const scopeFiber = yield* scopedAdapter.pipe(Effect.forkChild);
      yield* Effect.promise(() => stopCalled);
      yield* TestClock.adjust(100);
      yield* Effect.promise(() => forceStopCalled);
      yield* TestClock.adjust(50);
      yield* Fiber.join(scopeFiber);

      NodeAssert.equal(fake.counts().disconnected, 1);
      NodeAssert.equal(fake.counts().stopped, 1);
      NodeAssert.equal(fake.counts().forceStopped, 1);
    }),
  );

  it.effect("treats native shutdown as terminal and cannot resurrect the session", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = makeFakeRuntime();
        const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
          instanceId: INSTANCE_ID,
          clientFactory: () => fake.client,
        });
        const threadId = ThreadId.make("thread-copilot-shutdown");
        yield* adapter.startSession({
          threadId,
          providerInstanceId: INSTANCE_ID,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({ threadId, input: "work" });
        const collected = yield* collectUntil(adapter, (event) => event.type === "session.exited");
        fake.emit(
          sessionEvent(
            {
              type: "session.shutdown",
              data: {
                codeChanges: { filesModified: [], linesAdded: 0, linesRemoved: 0 },
                errorReason: "runtime crashed",
                modelMetrics: {},
                sessionStartTime: 0,
                shutdownType: "error",
                totalApiDurationMs: 0,
              },
            },
            50,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "assistant.message",
              data: { messageId: "post-shutdown", content: "Must stay discarded" },
            },
            51,
          ),
        );
        yield* collected.awaitDone;
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(collected.fiber);

        NodeAssert.equal(yield* adapter.hasSession(threadId), false);
        NodeAssert.equal(fake.counts().disconnected, 0);
        NodeAssert.equal(
          collected.events.some(
            (event) =>
              event.type === "turn.completed" &&
              event.payload.state === "failed" &&
              event.payload.errorMessage === "runtime crashed",
          ),
          true,
        );
        NodeAssert.equal(
          collected.events.some((event) => event.itemId === "post-shutdown"),
          false,
        );
        NodeAssert.equal(
          new Set(collected.events.map((event) => event.eventId)).size,
          collected.events.length,
        );
        const sendAfterShutdown = yield* adapter
          .sendTurn({ threadId, input: "again" })
          .pipe(Effect.result);
        NodeAssert.equal(sendAfterShutdown._tag, "Failure");
      }).pipe(Effect.provide(testLayer)),
    ),
  );

  it.effect("normalizes tools, usage, tasks, compaction, skills, MCP, and commands", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const discoveredSkills: Array<ReadonlyArray<ServerProviderSkill>> = [];
        const fake = makeFakeRuntime({
          tasks: [
            {
              type: "agent",
              id: "roster-agent",
              toolCallId: "roster-tool",
              description: "Inspect the repository",
              status: "running",
              startedAt: "2026-07-29T12:00:00.000Z",
              agentType: "explore",
              prompt: "Inspect the repository",
            },
          ],
        });
        const adapter = yield* makeCopilotAdapter(decodeSettings({ enabled: true }), {
          instanceId: INSTANCE_ID,
          clientFactory: () => fake.client,
          onSkillsChanged: ({ skills }) =>
            Effect.sync(() => {
              discoveredSkills.push(skills);
            }),
        });
        const threadId = ThreadId.make("thread-copilot-events");
        yield* adapter.startSession({
          threadId,
          providerInstanceId: INSTANCE_ID,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        const collected = yield* collectUntil(
          adapter,
          (event) => event.type === "item.completed" && event.itemId === "command-1",
        );

        fake.emit(
          sessionEvent(
            {
              type: "tool.execution_start",
              data: {
                toolCallId: "tool-1",
                toolName: "edit_file",
                arguments: { path: "src/a.ts", apiToken: "secret-value" },
              },
            },
            10,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "tool.execution_complete",
              data: {
                toolCallId: "tool-1",
                success: true,
                result: {
                  content: "done",
                  detailedContent: "x".repeat(4_000),
                  binaryResultsForLlm: [
                    {
                      type: "image",
                      data: "base64-secret",
                      mimeType: "image/png",
                    },
                  ],
                },
              },
            },
            11,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "session.usage_info",
              ephemeral: true,
              data: { currentTokens: 123, messagesLength: 4, tokenLimit: 10_000 },
            },
            12,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "subagent.started",
              agentId: "agent-1",
              data: {
                agentDescription: "Review code",
                agentDisplayName: "Reviewer",
                agentName: "explore",
                toolCallId: "agent-tool-1",
              },
            },
            13,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "subagent.completed",
              agentId: "agent-1",
              data: {
                agentDisplayName: "Reviewer",
                agentName: "explore",
                toolCallId: "agent-tool-1",
                totalTokens: 200,
                totalToolCalls: 3,
              },
            },
            14,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "session.compaction_start",
              data: { model: "gpt-test" },
            },
            15,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "session.compaction_complete",
              data: { success: true, messagesRemoved: 2, postCompactionTokens: 50 },
            },
            16,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "session.truncation",
              data: {
                messagesRemovedDuringTruncation: 1,
                performedBy: "BasicTruncator",
                postTruncationMessagesLength: 3,
                postTruncationTokensInMessages: 30,
                preTruncationMessagesLength: 4,
                preTruncationTokensInMessages: 60,
                tokenLimit: 10_000,
                tokensRemovedDuringTruncation: 30,
              },
            },
            17,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "session.skills_loaded",
              ephemeral: true,
              data: {
                skills: [
                  {
                    name: "review",
                    description: "Review changes",
                    enabled: true,
                    source: "project",
                    userInvocable: true,
                  },
                  {
                    name: "personal-review",
                    description: "Review personal changes",
                    enabled: true,
                    source: "personal-copilot",
                    userInvocable: true,
                  },
                ],
              },
            },
            18,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "session.background_tasks_changed",
              ephemeral: true,
              data: {},
            },
            19,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "session.mcp_servers_loaded",
              ephemeral: true,
              data: { servers: [{ name: "t3-code", status: "connected" }] },
            },
            20,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "command.queued",
              ephemeral: true,
              data: { command: "/help", requestId: "command-1" },
            },
            21,
          ),
        );
        fake.emit(
          sessionEvent(
            {
              type: "command.completed",
              ephemeral: true,
              data: { requestId: "command-1" },
            },
            22,
          ),
        );
        yield* collected.awaitDone;
        yield* Fiber.interrupt(collected.fiber);

        const toolStart = collected.events.find((event) => event.type === "item.started");
        const toolComplete = collected.events.find(
          (event) => event.type === "item.completed" && event.itemId === "tool-1",
        );
        NodeAssert.equal(toolStart?.type, "item.started");
        if (toolStart?.type === "item.started") {
          const encoded = encodeUnknownJson(toolStart.payload.data);
          NodeAssert.match(encoded, /\[redacted\]/u);
          NodeAssert.doesNotMatch(encoded, /secret-value/u);
        }
        if (toolComplete?.type === "item.completed") {
          NodeAssert.ok((toolComplete.payload.detail?.length ?? 0) <= 2_000);
          NodeAssert.doesNotMatch(encodeUnknownJson(toolComplete.payload.data), /base64-secret/u);
        }
        NodeAssert.ok(
          collected.events.some((event) => event.type === "thread.token-usage.updated"),
        );
        NodeAssert.ok(collected.events.some((event) => event.type === "task.started"));
        NodeAssert.ok(
          collected.events.some(
            (event) => event.type === "task.started" && event.payload.taskId === "roster-agent",
          ),
        );
        NodeAssert.ok(collected.events.some((event) => event.type === "task.completed"));
        NodeAssert.ok(
          collected.events.some(
            (event) => event.type === "thread.state.changed" && event.payload.state === "compacted",
          ),
        );
        NodeAssert.equal(
          collected.events.filter(
            (event) => event.type === "thread.state.changed" && event.payload.state === "compacted",
          ).length,
          2,
        );
        NodeAssert.ok(collected.events.some((event) => event.type === "mcp.status.updated"));
        NodeAssert.equal(fake.counts().queuedCommandResponses, 1);
        NodeAssert.deepEqual(
          discoveredSkills.at(-1)?.map((skill) => skill.name),
          ["personal-review"],
        );
        NodeAssert.equal(discoveredSkills.at(-1)?.[0]?.scope, "personal-copilot");
      }).pipe(Effect.provide(testLayer)),
    ),
  );
});
