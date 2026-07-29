// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeAssert from "node:assert/strict";

import type {
  PermissionRequest,
  PermissionRequestResult,
  SessionConfig,
  SessionEvent,
} from "@github/copilot-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CopilotSettings,
  ApprovalRequestId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import {
  makeCopilotAdapter,
  type CopilotClientHandle,
  type CopilotSessionHandle,
} from "./CopilotAdapter.ts";

const decodeSettings = Schema.decodeSync(CopilotSettings);

function makeFakeRuntime() {
  let config: SessionConfig | undefined;
  let eventHandler: ((event: SessionEvent) => void) | undefined;
  const sent: Array<unknown> = [];
  const session: CopilotSessionHandle = {
    sessionId: "copilot-session-1",
    on: (() => () => {}) as CopilotSessionHandle["on"],
    send: async (input) => {
      sent.push(input);
      return "message-1";
    },
    abort: async () => {},
    disconnect: async () => {},
    getEvents: async () => [],
    rpc: {
      model: {
        getCurrent: async () => ({}),
        switchTo: async ({ modelId }: { readonly modelId: string }) => ({ modelId }),
        setReasoningEffort: async () => ({}),
        list: async () => ({ models: [] }),
      },
      mode: {
        get: async () => "interactive",
        set: async () => {},
      },
    } as unknown as CopilotSessionHandle["rpc"],
  };
  const client: CopilotClientHandle = {
    start: async () => {},
    stop: async () => [],
    createSession: async (nextConfig) => {
      config = nextConfig;
      eventHandler = nextConfig.onEvent;
      return session;
    },
    resumeSession: async (_sessionId, nextConfig) => {
      config = nextConfig;
      eventHandler = nextConfig.onEvent;
      return session;
    },
  };
  return {
    client,
    session,
    sent,
    getConfig: () => config,
    emit: (event: SessionEvent) => eventHandler?.(event),
  };
}

let eventSequence = 0;
const event = <T extends SessionEvent>(value: Omit<T, "id" | "parentId" | "timestamp">): T =>
  ({
    id: `copilot-event-${++eventSequence}`,
    parentId: null,
    timestamp: "2026-07-29T12:00:00.000Z",
    ...value,
  }) as T;

describe("CopilotAdapter", () => {
  it.effect("maps lifecycle events and bridges approvals and user input", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = makeFakeRuntime();
        const instanceId = ProviderInstanceId.make("copilot");
        const threadId = ThreadId.make("thread-copilot");
        const adapter = yield* makeCopilotAdapter(decodeSettings({}), {
          instanceId,
          clientFactory: () => fake.client,
        });
        const session = yield* adapter.startSession({
          threadId,
          providerInstanceId: instanceId,
          cwd: "/workspace/project",
          runtimeMode: "approval-required",
        });
        NodeAssert.deepEqual(session.resumeCursor, {
          schemaVersion: 1,
          sessionId: "copilot-session-1",
        });
        NodeAssert.ok(fake.getConfig()?.enableConfigDiscovery);

        yield* adapter.sendTurn({
          threadId,
          input: "hello",
          interactionMode: "default",
        });
        fake.emit(
          event({
            type: "assistant.message_delta",
            ephemeral: true,
            data: { messageId: "message-1", deltaContent: "Hello" },
          }),
        );
        fake.emit(
          event({
            type: "assistant.message",
            data: { messageId: "message-1", content: "Hello" },
          }),
        );
        fake.emit(
          event({
            type: "session.idle",
            ephemeral: true,
            data: {},
          }),
        );

        const lifecycle = yield* adapter.streamEvents.pipe(Stream.take(6), Stream.runCollect);
        NodeAssert.deepEqual(
          lifecycle.map((entry) => entry.type),
          [
            "session.started",
            "thread.started",
            "turn.started",
            "content.delta",
            "item.completed",
            "turn.completed",
          ],
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
          sessionId: fake.session.sessionId,
        });
        const approvalEvent = (yield* adapter.streamEvents.pipe(
          Stream.take(1),
          Stream.runCollect,
        ))[0];
        NodeAssert.equal(approvalEvent?.type, "request.opened");
        yield* adapter.respondToRequest(
          threadId,
          ApprovalRequestId.make(approvalEvent!.requestId!),
          "acceptForSession",
        );
        NodeAssert.deepEqual(yield* Effect.promise(() => Promise.resolve(permissionPromise!)), {
          kind: "approve-for-session",
          approval: { kind: "commands", commandIdentifiers: ["git"] },
        } satisfies PermissionRequestResult);

        const oneShotPermissionPromise = fake
          .getConfig()
          ?.onPermissionRequest?.(
            { ...permission, canOfferSessionApproval: false },
            { sessionId: fake.session.sessionId },
          );
        const oneShotApprovalEvent = (yield* adapter.streamEvents.pipe(
          Stream.filter((entry) => entry.type === "request.opened"),
          Stream.take(1),
          Stream.runCollect,
        ))[0];
        yield* adapter.respondToRequest(
          threadId,
          ApprovalRequestId.make(oneShotApprovalEvent!.requestId!),
          "acceptForSession",
        );
        NodeAssert.deepEqual(
          yield* Effect.promise(() => Promise.resolve(oneShotPermissionPromise!)),
          {
            kind: "approve-once",
          } satisfies PermissionRequestResult,
        );

        const inputPromise = fake
          .getConfig()
          ?.onUserInputRequest?.(
            { question: "Pick one", choices: ["A", "B"] },
            { sessionId: fake.session.sessionId },
          );
        const inputEvent = (yield* adapter.streamEvents.pipe(
          Stream.filter((entry) => entry.type === "user-input.requested"),
          Stream.take(1),
          Stream.runCollect,
        ))[0];
        NodeAssert.equal(inputEvent?.type, "user-input.requested");
        yield* adapter.respondToUserInput(
          threadId,
          ApprovalRequestId.make(inputEvent!.requestId!),
          { answer: "A" },
        );
        NodeAssert.deepEqual(yield* Effect.promise(() => Promise.resolve(inputPromise!)), {
          answer: "A",
          wasFreeform: true,
        });

        const exitPlanResult = yield* Effect.promise(() =>
          Promise.resolve(
            fake.getConfig()?.onExitPlanModeRequest?.(
              {
                summary: "Plan summary",
                planContent: "1. Implement safely",
                actions: [],
                recommendedAction: "implement",
              },
              { sessionId: fake.session.sessionId },
            ),
          ),
        );
        NodeAssert.deepEqual(exitPlanResult, { approved: false });
        const proposedPlanEvent = (yield* adapter.streamEvents.pipe(
          Stream.filter((entry) => entry.type === "turn.proposed.completed"),
          Stream.take(1),
          Stream.runCollect,
        ))[0];
        NodeAssert.equal(proposedPlanEvent?.type, "turn.proposed.completed");
        NodeAssert.equal(fake.sent.length, 1);
      }).pipe(
        Effect.provide(
          ServerConfig.layerTest(
            process.cwd(),
            NodePath.join(process.cwd(), ".copilot-adapter-test"),
          ).pipe(Layer.provideMerge(NodeServices.layer)),
        ),
        Effect.ensuring(
          Effect.sync(() =>
            NodeFS.rmSync(NodePath.join(process.cwd(), ".copilot-adapter-test"), {
              recursive: true,
              force: true,
            }),
          ),
        ),
      ),
    ),
  );
});
