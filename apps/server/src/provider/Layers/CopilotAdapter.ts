// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  CopilotClient,
  type CopilotClientOptions,
  type CopilotSession,
  type MessageOptions,
  type PermissionRequest,
  type PermissionRequestResult,
  type ResumeSessionConfig,
  type SessionConfig,
  type SessionEvent,
} from "@github/copilot-sdk";
import {
  ApprovalRequestId,
  type CopilotSettings,
  EventId,
  ProviderDriverKind,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderInstanceId,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type ProviderUserInputAnswers,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { CopilotAdapterShape } from "../Services/CopilotAdapter.ts";
import type {
  ProviderThreadSnapshot,
  ProviderThreadTurnSnapshot,
} from "../Services/ProviderAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { expandCopilotHomePath, makeCopilotClientOptions } from "./copilotClientOptions.ts";

const PROVIDER = ProviderDriverKind.make("copilot");
const RESUME_CURSOR_VERSION = 1 as const;
const USER_INPUT_ID = "answer";
const nowIsoUnsafe = () => DateTime.formatIso(DateTime.nowUnsafe());
type CopilotUserInputRequest = Parameters<NonNullable<SessionConfig["onUserInputRequest"]>>[0];
type CopilotUserInputResponse = Awaited<
  ReturnType<NonNullable<SessionConfig["onUserInputRequest"]>>
>;

export interface CopilotSessionHandle {
  readonly sessionId: string;
  readonly on: CopilotSession["on"];
  readonly send: (options: MessageOptions) => Promise<string>;
  readonly abort: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly getEvents: () => Promise<SessionEvent[]>;
  readonly rpc: Pick<CopilotSession["rpc"], "model" | "mode">;
}

export interface CopilotClientHandle {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<ReadonlyArray<Error>>;
  readonly createSession: (config: SessionConfig) => Promise<CopilotSessionHandle>;
  readonly resumeSession: (
    sessionId: string,
    config: ResumeSessionConfig,
  ) => Promise<CopilotSessionHandle>;
}

export interface CopilotAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly clientFactory?: (options: CopilotClientOptions) => CopilotClientHandle;
}

interface PendingApproval {
  readonly request: PermissionRequest;
  readonly turnId: TurnId | undefined;
  readonly resolve: (result: PermissionRequestResult) => void;
}

interface PendingUserInput {
  readonly turnId: TurnId | undefined;
  readonly resolve: (result: CopilotUserInputResponse) => void;
}

interface CopilotSessionContext {
  session: ProviderSession;
  sdkSession: CopilotSessionHandle | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<ProviderThreadTurnSnapshot>;
  readonly toolNames: Map<string, string>;
  activeTurnId: TurnId | undefined;
  activeTurnCompleted: boolean;
  lastUsage: unknown;
}

function parseResumeCursor(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const cursor = value as { readonly schemaVersion?: unknown; readonly sessionId?: unknown };
  return cursor.schemaVersion === RESUME_CURSOR_VERSION &&
    typeof cursor.sessionId === "string" &&
    cursor.sessionId.trim().length > 0
    ? cursor.sessionId.trim()
    : undefined;
}

function resumeCursor(sessionId: string) {
  return { schemaVersion: RESUME_CURSOR_VERSION, sessionId };
}

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function requestType(request: PermissionRequest) {
  switch (request.kind) {
    case "shell":
      return "command_execution_approval" as const;
    case "read":
      return "file_read_approval" as const;
    case "write":
      return "file_change_approval" as const;
    case "mcp":
    case "custom-tool":
    case "extension-management":
    case "extension-permission-access":
    case "hook":
    case "memory":
    case "url":
      return "dynamic_tool_call" as const;
  }
}

function requestDetail(request: PermissionRequest): string {
  switch (request.kind) {
    case "shell":
      return request.fullCommandText;
    case "read":
      return request.path;
    case "write":
      return request.fileName;
    case "mcp":
      return `${request.serverName}: ${request.toolTitle}`;
    case "custom-tool":
      return request.toolDescription || request.toolName;
    case "hook":
      return request.hookMessage || request.toolName;
    case "memory":
      return request.fact;
    case "url":
      return request.url;
    case "extension-management":
      return request.extensionName
        ? `${request.operation}: ${request.extensionName}`
        : request.operation;
    case "extension-permission-access":
      return request.extensionName;
  }
}

function approvalResult(
  request: PermissionRequest,
  decision: ProviderApprovalDecision,
): PermissionRequestResult {
  if (decision === "cancel") {
    return { kind: "user-not-available" };
  }
  if (decision === "decline") {
    return { kind: "reject" };
  }
  if (decision === "accept") {
    return { kind: "approve-once" };
  }
  if ((request.kind === "shell" || request.kind === "write") && !request.canOfferSessionApproval) {
    return { kind: "approve-once" };
  }

  switch (request.kind) {
    case "shell":
      return {
        kind: "approve-for-session",
        approval: {
          kind: "commands",
          commandIdentifiers: request.commands.map((command) => command.identifier),
        },
      };
    case "read":
      return { kind: "approve-for-session", approval: { kind: "read" } };
    case "write":
      return { kind: "approve-for-session", approval: { kind: "write" } };
    case "mcp":
      return {
        kind: "approve-for-session",
        approval: { kind: "mcp", serverName: request.serverName, toolName: request.toolName },
      };
    case "memory":
      return { kind: "approve-for-session", approval: { kind: "memory" } };
    case "custom-tool":
      return {
        kind: "approve-for-session",
        approval: { kind: "custom-tool", toolName: request.toolName },
      };
    case "extension-management":
      return {
        kind: "approve-for-session",
        approval: { kind: "extension-management" },
      };
    case "extension-permission-access":
      return {
        kind: "approve-for-session",
        approval: {
          kind: "extension-permission-access",
          extensionName: request.extensionName,
        },
      };
    case "hook":
    case "url":
      return { kind: "approve-once" };
  }
}

function automaticPermissionResult(
  runtimeMode: ProviderSession["runtimeMode"],
  request: PermissionRequest,
): PermissionRequestResult | undefined {
  if (runtimeMode === "full-access") {
    return { kind: "approve-once" };
  }
  if ("requestSandboxBypass" in request && request.requestSandboxBypass) {
    return undefined;
  }
  if (
    runtimeMode === "auto-accept-edits" &&
    (request.kind === "read" || request.kind === "write")
  ) {
    return { kind: "approve-once" };
  }
  if (
    runtimeMode === "auto" &&
    (request.kind === "read" ||
      (request.kind === "shell" &&
        !request.hasWriteFileRedirection &&
        request.commands.every((command) => command.readOnly)))
  ) {
    return { kind: "approve-once" };
  }
  return undefined;
}

function toolItemType(toolName: string, mcpServerName?: string) {
  const normalized = toolName.toLowerCase();
  if (mcpServerName) return "mcp_tool_call" as const;
  if (
    normalized.includes("shell") ||
    normalized.includes("bash") ||
    normalized.includes("powershell")
  ) {
    return "command_execution" as const;
  }
  if (normalized.includes("write") || normalized.includes("edit") || normalized.includes("patch")) {
    return "file_change" as const;
  }
  if (normalized.includes("web") || normalized.includes("search")) {
    return "web_search" as const;
  }
  return "dynamic_tool_call" as const;
}

export const makeCopilotAdapter = Effect.fn("makeCopilotAdapter")(function* (
  settings: CopilotSettings,
  options: CopilotAdapterLiveOptions = {},
) {
  const serverConfig = yield* ServerConfig;
  const runtimeContext = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(runtimeContext);
  const boundInstanceId = options.instanceId ?? ProviderInstanceId.make(PROVIDER);
  const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, CopilotSessionContext>();
  const clientOptions = makeCopilotClientOptions({
    settings,
    cwd: serverConfig.cwd,
    ...(options.environment ? { environment: options.environment } : {}),
  });
  const client =
    options.clientFactory?.(clientOptions) ??
    (new CopilotClient(clientOptions) as CopilotClientHandle);
  let startPromise: Promise<void> | undefined;

  const ensureClientStarted = (): Promise<void> => {
    startPromise ??= client.start().catch((cause) => {
      startPromise = undefined;
      throw cause;
    });
    return startPromise;
  };

  const emit = (event: ProviderRuntimeEvent): void => {
    runFork(Queue.offer(runtimeEvents, event));
  };

  const writeNative = (threadId: ThreadId, event: SessionEvent): void => {
    if (!options.nativeEventLogger) return;
    runFork(options.nativeEventLogger.write({ observedAt: nowIsoUnsafe(), event }, threadId));
  };

  const eventBase = (
    context: CopilotSessionContext,
    event?: SessionEvent,
    fields?: {
      readonly turnId?: TurnId;
      readonly itemId?: string;
      readonly requestId?: ApprovalRequestId;
    },
  ) => ({
    eventId: EventId.make(event?.id ?? NodeCrypto.randomUUID()),
    provider: PROVIDER,
    providerInstanceId: boundInstanceId,
    threadId: context.session.threadId,
    createdAt: event?.timestamp ?? nowIsoUnsafe(),
    ...((fields?.turnId ?? context.activeTurnId)
      ? { turnId: fields?.turnId ?? context.activeTurnId }
      : {}),
    ...(fields?.itemId ? { itemId: RuntimeItemId.make(fields.itemId) } : {}),
    ...(fields?.requestId ? { requestId: RuntimeRequestId.make(fields.requestId) } : {}),
    ...(event
      ? {
          raw: {
            source: "copilot.sdk.session-event" as const,
            messageType: event.type,
            payload: event,
          },
        }
      : {}),
  });

  const updateSession = (
    context: CopilotSessionContext,
    patch: Partial<ProviderSession>,
    clear?: "activeTurnId" | "lastError",
  ) => {
    const next = {
      ...context.session,
      ...patch,
      updatedAt: nowIsoUnsafe(),
    } as ProviderSession & Record<string, unknown>;
    if (clear) delete next[clear];
    context.session = next;
  };

  const completeTurn = (
    context: CopilotSessionContext,
    state: "completed" | "failed" | "interrupted",
    event: SessionEvent,
    errorMessage?: string,
  ): void => {
    const turnId = context.activeTurnId;
    if (!turnId || context.activeTurnCompleted) return;
    context.activeTurnCompleted = true;
    emit({
      ...eventBase(context, event, { turnId }),
      type: "turn.completed",
      payload: {
        state,
        ...(context.lastUsage !== undefined ? { usage: context.lastUsage } : {}),
        ...(errorMessage ? { errorMessage } : {}),
      },
    });
    context.activeTurnId = undefined;
    updateSession(
      context,
      {
        status: state === "failed" ? "error" : "ready",
        ...(errorMessage ? { lastError: errorMessage } : {}),
      },
      "activeTurnId",
    );
  };

  const handleEvent = (context: CopilotSessionContext, event: SessionEvent): void => {
    writeNative(context.session.threadId, event);
    const turnId = context.activeTurnId;
    const turn = turnId ? context.turns.find((entry) => entry.id === turnId) : undefined;
    if (turn) {
      (turn.items as Array<unknown>).push(event);
    }

    switch (event.type) {
      case "assistant.message_start":
        if (event.agentId) break;
        emit({
          ...eventBase(context, event, { itemId: event.data.messageId }),
          type: "item.started",
          payload: { itemType: "assistant_message", status: "inProgress" },
        });
        break;
      case "assistant.message_delta":
        if (event.agentId) break;
        emit({
          ...eventBase(context, event, { itemId: event.data.messageId }),
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: event.data.deltaContent },
        });
        break;
      case "assistant.message":
        if (event.agentId) break;
        emit({
          ...eventBase(context, event, { itemId: event.data.messageId }),
          type: "item.completed",
          payload: {
            itemType: "assistant_message",
            status: "completed",
            ...(event.data.content.trim() ? { detail: event.data.content } : {}),
            data: event.data,
          },
        });
        break;
      case "assistant.reasoning_delta":
        if (event.agentId) break;
        emit({
          ...eventBase(context, event, { itemId: event.data.reasoningId }),
          type: "content.delta",
          payload: { streamKind: "reasoning_text", delta: event.data.deltaContent },
        });
        break;
      case "assistant.reasoning":
        if (event.agentId) break;
        emit({
          ...eventBase(context, event, { itemId: event.data.reasoningId }),
          type: "item.completed",
          payload: {
            itemType: "reasoning",
            status: "completed",
            data: event.data,
          },
        });
        break;
      case "tool.execution_start": {
        context.toolNames.set(event.data.toolCallId, event.data.toolName);
        emit({
          ...eventBase(context, event, { itemId: event.data.toolCallId }),
          type: "item.started",
          payload: {
            itemType: toolItemType(event.data.toolName, event.data.mcpServerName),
            status: "inProgress",
            title: event.data.toolName,
            data: event.data,
          },
        });
        break;
      }
      case "tool.execution_partial_result": {
        const toolName = context.toolNames.get(event.data.toolCallId) ?? "tool";
        emit({
          ...eventBase(context, event, { itemId: event.data.toolCallId }),
          type: "content.delta",
          payload: {
            streamKind:
              toolItemType(toolName) === "command_execution" ? "command_output" : "unknown",
            delta: event.data.partialOutput,
          },
        });
        break;
      }
      case "tool.execution_progress":
        emit({
          ...eventBase(context, event, { itemId: event.data.toolCallId }),
          type: "item.updated",
          payload: {
            itemType: toolItemType(context.toolNames.get(event.data.toolCallId) ?? "tool"),
            status: "inProgress",
            detail: event.data.progressMessage,
          },
        });
        break;
      case "tool.execution_complete": {
        const toolName = context.toolNames.get(event.data.toolCallId) ?? "tool";
        context.toolNames.delete(event.data.toolCallId);
        emit({
          ...eventBase(context, event, { itemId: event.data.toolCallId }),
          type: "item.completed",
          payload: {
            itemType: toolItemType(toolName),
            status: event.data.success ? "completed" : "failed",
            title: toolName,
            ...(event.data.error?.message ? { detail: event.data.error.message } : {}),
            data: event.data,
          },
        });
        break;
      }
      case "assistant.usage":
        context.lastUsage = event.data;
        break;
      case "session.idle":
        completeTurn(context, "completed", event);
        break;
      case "abort":
        completeTurn(context, "interrupted", event);
        break;
      case "session.error":
        emit({
          ...eventBase(context, event),
          type: "runtime.error",
          payload: {
            message: event.data.message,
            class:
              event.data.errorType === "authentication" ? "permission_error" : "provider_error",
            detail: event.data,
          },
        });
        completeTurn(context, "failed", event, event.data.message);
        break;
      case "session.title_changed":
        emit({
          ...eventBase(context, event),
          type: "thread.metadata.updated",
          payload: { name: event.data.title },
        });
        break;
      case "session.model_change":
        updateSession(context, { model: event.data.newModel });
        break;
      case "session.mcp_servers_loaded":
      case "session.mcp_server_status_changed":
        emit({
          ...eventBase(context, event),
          type: "mcp.status.updated",
          payload: { status: event.data },
        });
        break;
      case "mcp.oauth_completed":
        emit({
          ...eventBase(context, event),
          type: "mcp.oauth.completed",
          payload: {
            success: event.data.success,
            ...(event.data.serverName ? { name: event.data.serverName } : {}),
            ...(event.data.error ? { error: event.data.error } : {}),
          },
        });
        break;
      case "session.warning":
        emit({
          ...eventBase(context, event),
          type: "runtime.warning",
          payload: { message: event.data.message, detail: event.data },
        });
        break;
      default:
        break;
    }
  };

  const handlePermission = (
    context: CopilotSessionContext,
    request: PermissionRequest,
  ): Promise<PermissionRequestResult> => {
    const automaticResult = automaticPermissionResult(context.session.runtimeMode, request);
    if (automaticResult) {
      return Promise.resolve(automaticResult);
    }
    return new Promise((resolve) => {
      const requestId = ApprovalRequestId.make(NodeCrypto.randomUUID());
      context.pendingApprovals.set(requestId, {
        request,
        turnId: context.activeTurnId,
        resolve,
      });
      emit({
        ...eventBase(context, undefined, { requestId }),
        type: "request.opened",
        payload: {
          requestType: requestType(request),
          detail: requestDetail(request),
          args: request,
        },
        raw: {
          source: "copilot.sdk.synthetic",
          messageType: "permission.requested",
          payload: request,
        },
      });
    });
  };

  const handleUserInput = (
    context: CopilotSessionContext,
    request: CopilotUserInputRequest,
  ): Promise<CopilotUserInputResponse> =>
    new Promise((resolve) => {
      const requestId = ApprovalRequestId.make(NodeCrypto.randomUUID());
      context.pendingUserInputs.set(requestId, {
        turnId: context.activeTurnId,
        resolve,
      });
      emit({
        ...eventBase(context, undefined, { requestId }),
        type: "user-input.requested",
        payload: {
          questions: [
            {
              id: USER_INPUT_ID,
              header: "Question",
              question: request.question,
              options: (request.choices ?? []).map((choice: string) => ({
                label: choice,
                description: choice,
              })),
            },
          ],
        },
        raw: {
          source: "copilot.sdk.synthetic",
          messageType: "user_input.requested",
          payload: request,
        },
      });
    });

  const requireContext = (
    threadId: ThreadId,
  ): Effect.Effect<CopilotSessionContext, ProviderAdapterSessionNotFoundError> => {
    const context = sessions.get(threadId);
    return context
      ? Effect.succeed(context)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };

  const toRequestError = (method: string, cause: unknown) =>
    new ProviderAdapterRequestError({
      provider: PROVIDER,
      method,
      detail: errorDetail(cause),
      cause,
    });

  const stopContext = Effect.fn("CopilotAdapter.stopContext")(function* (
    context: CopilotSessionContext,
  ) {
    sessions.delete(context.session.threadId);
    for (const pending of context.pendingApprovals.values()) {
      pending.resolve({ kind: "user-not-available" });
    }
    for (const pending of context.pendingUserInputs.values()) {
      pending.resolve({ answer: "", wasFreeform: true });
    }
    context.pendingApprovals.clear();
    context.pendingUserInputs.clear();
    if (context.sdkSession) {
      yield* Effect.tryPromise({
        try: () => context.sdkSession!.disconnect(),
        catch: (cause) => toRequestError("session.disconnect", cause),
      });
    }
    updateSession(context, { status: "closed" }, "activeTurnId");
    emit({
      ...eventBase(context),
      type: "session.exited",
      payload: { exitKind: "graceful", reason: "Session stopped" },
    });
  });

  const startSession: CopilotAdapterShape["startSession"] = Effect.fn(
    "CopilotAdapter.startSession",
  )(function* (input) {
    if (input.providerInstanceId && input.providerInstanceId !== boundInstanceId) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "startSession",
        issue: `Provider instance '${input.providerInstanceId}' does not match '${boundInstanceId}'.`,
      });
    }
    const existing = sessions.get(input.threadId);
    if (existing) {
      yield* stopContext(existing);
    }

    const cwd = input.cwd ?? serverConfig.cwd;
    const modelSelection =
      input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
    const effort = getModelSelectionStringOptionValue(modelSelection, "reasoningEffort");
    const reasoningEffort = effort as NonNullable<SessionConfig["reasoningEffort"]> | undefined;
    const configDirectory = expandCopilotHomePath(settings.homePath);
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const context: CopilotSessionContext = {
      session: {
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        status: "connecting",
        runtimeMode: input.runtimeMode,
        cwd,
        ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        threadId: input.threadId,
        createdAt,
        updatedAt: createdAt,
      },
      sdkSession: undefined,
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      turns: [],
      toolNames: new Map(),
      activeTurnId: undefined,
      activeTurnCompleted: false,
      lastUsage: undefined,
    };

    yield* Effect.tryPromise({
      try: ensureClientStarted,
      catch: (cause) =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail: errorDetail(cause),
          cause,
        }),
    });

    const config: SessionConfig = {
      clientName: "t3-code",
      workingDirectory: cwd,
      streaming: true,
      enableConfigDiscovery: settings.enableConfigDiscovery,
      enableSkills: true,
      ...(configDirectory ? { configDirectory } : {}),
      ...(modelSelection?.model ? { model: modelSelection.model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      onPermissionRequest: (request) => handlePermission(context, request),
      onUserInputRequest: (request) => handleUserInput(context, request),
      onExitPlanModeRequest: (request) => {
        emit({
          ...eventBase(context),
          type: "turn.proposed.completed",
          payload: { planMarkdown: request.planContent ?? request.summary },
          raw: {
            source: "copilot.sdk.synthetic",
            messageType: "exit_plan_mode.requested",
            payload: request,
          },
        });
        return Promise.resolve({ approved: false });
      },
      includeSubAgentStreamingEvents: false,
      onEvent: (event) => handleEvent(context, event),
    };
    const sdkSession = yield* Effect.tryPromise({
      try: () => {
        const previousSessionId = parseResumeCursor(input.resumeCursor);
        return previousSessionId
          ? client.resumeSession(previousSessionId, {
              ...config,
              continuePendingWork: false,
            })
          : client.createSession(config);
      },
      catch: (cause) => toRequestError("session.start", cause),
    });
    context.sdkSession = sdkSession;
    context.session = {
      ...context.session,
      status: "ready",
      resumeCursor: resumeCursor(sdkSession.sessionId),
      updatedAt: nowIsoUnsafe(),
    };
    sessions.set(input.threadId, context);
    emit({
      ...eventBase(context),
      type: "session.started",
      payload: {
        message: "GitHub Copilot session ready",
        resume: context.session.resumeCursor,
      },
    });
    emit({
      ...eventBase(context),
      type: "thread.started",
      payload: { providerThreadId: sdkSession.sessionId },
    });
    return context.session;
  });

  const sendTurn: CopilotAdapterShape["sendTurn"] = Effect.fn("CopilotAdapter.sendTurn")(
    function* (input) {
      const context = yield* requireContext(input.threadId);
      const sdkSession = context.sdkSession;
      if (!sdkSession) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId: input.threadId,
        });
      }
      const modelSelection =
        input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
      const effort = getModelSelectionStringOptionValue(modelSelection, "reasoningEffort");
      if (modelSelection?.model) {
        yield* Effect.tryPromise({
          try: () =>
            sdkSession.rpc.model.switchTo({
              modelId: modelSelection.model,
              ...(effort ? { reasoningEffort: effort } : {}),
            }),
          catch: (cause) => toRequestError("model.switchTo", cause),
        });
      } else if (effort) {
        yield* Effect.tryPromise({
          try: () => sdkSession.rpc.model.setReasoningEffort({ reasoningEffort: effort }),
          catch: (cause) => toRequestError("model.setReasoningEffort", cause),
        });
      }
      if (input.interactionMode) {
        yield* Effect.tryPromise({
          try: () =>
            sdkSession.rpc.mode.set({
              mode: input.interactionMode === "plan" ? "plan" : "interactive",
            }),
          catch: (cause) => toRequestError("mode.set", cause),
        });
      }

      const attachments = (input.attachments ?? []).flatMap((attachment) => {
        const path = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        return path ? [{ type: "file" as const, path, displayName: attachment.name }] : [];
      });
      const prompt = input.input ?? (attachments.length > 0 ? "Review the attached file." : "");
      if (!prompt) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "A prompt or attachment is required.",
        });
      }

      const activeTurnId = context.activeTurnCompleted ? undefined : context.activeTurnId;
      const turnId = activeTurnId ?? TurnId.make(`copilot-turn-${NodeCrypto.randomUUID()}`);
      if (!activeTurnId) {
        context.activeTurnId = turnId;
        context.activeTurnCompleted = false;
        context.lastUsage = undefined;
        context.turns.push({ id: turnId, items: [] });
        updateSession(context, {
          status: "running",
          activeTurnId: turnId,
          ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        });
        emit({
          ...eventBase(context, undefined, { turnId }),
          type: "turn.started",
          payload: {
            ...(modelSelection?.model ? { model: modelSelection.model } : {}),
            ...(effort ? { effort } : {}),
          },
        });
      }

      yield* Effect.tryPromise({
        try: () =>
          sdkSession.send({
            prompt,
            ...(attachments.length > 0 ? { attachments } : {}),
            mode: "immediate",
            ...(input.interactionMode
              ? { agentMode: input.interactionMode === "plan" ? "plan" : "interactive" }
              : {}),
          }),
        catch: (cause) => toRequestError("session.send", cause),
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            context.activeTurnId = undefined;
            updateSession(context, { status: "ready", lastError: error.detail }, "activeTurnId");
            emit({
              ...eventBase(context, undefined, { turnId }),
              type: "turn.aborted",
              payload: { reason: error.detail },
            });
          }),
        ),
      );
      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: context.session.resumeCursor,
      };
    },
  );

  const interruptTurn: CopilotAdapterShape["interruptTurn"] = (threadId, turnId) =>
    Effect.gen(function* () {
      const context = yield* requireContext(threadId);
      if (!context.sdkSession) return;
      yield* Effect.tryPromise({
        try: () => context.sdkSession!.abort(),
        catch: (cause) => toRequestError("session.abort", cause),
      });
      const activeTurnId = turnId ?? context.activeTurnId;
      if (activeTurnId) {
        emit({
          ...eventBase(context, undefined, { turnId: activeTurnId }),
          type: "turn.aborted",
          payload: { reason: "Interrupted by user" },
        });
      }
    });

  const respondToRequest: CopilotAdapterShape["respondToRequest"] = (
    threadId,
    requestId,
    decision,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireContext(threadId);
      const pending = context.pendingApprovals.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "respondToRequest",
          issue: `Unknown approval request '${requestId}'.`,
        });
      }
      context.pendingApprovals.delete(requestId);
      pending.resolve(approvalResult(pending.request, decision));
      emit({
        ...eventBase(context, undefined, {
          requestId,
          ...(pending.turnId ? { turnId: pending.turnId } : {}),
        }),
        type: "request.resolved",
        payload: { requestType: requestType(pending.request), decision },
      });
    });

  const respondToUserInput: CopilotAdapterShape["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireContext(threadId);
      const pending = context.pendingUserInputs.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "respondToUserInput",
          issue: `Unknown user-input request '${requestId}'.`,
        });
      }
      context.pendingUserInputs.delete(requestId);
      const value = answers[USER_INPUT_ID];
      const answer = Array.isArray(value)
        ? value.map(String).join(", ")
        : typeof value === "string"
          ? value
          : String(value ?? "");
      pending.resolve({ answer, wasFreeform: true });
      emit({
        ...eventBase(context, undefined, {
          requestId,
          ...(pending.turnId ? { turnId: pending.turnId } : {}),
        }),
        type: "user-input.resolved",
        payload: { answers: answers as ProviderUserInputAnswers },
      });
    });

  const readThread: CopilotAdapterShape["readThread"] = (threadId) =>
    requireContext(threadId).pipe(
      Effect.map(
        (context): ProviderThreadSnapshot => ({
          threadId,
          turns: context.turns,
        }),
      ),
    );

  const rollbackThread: CopilotAdapterShape["rollbackThread"] = (threadId, numTurns) =>
    Effect.gen(function* () {
      yield* requireContext(threadId);
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        });
      }
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "thread/rollback",
        detail: "The Copilot SDK does not expose a supported conversation rollback API.",
      });
    });

  const stopSession: CopilotAdapterShape["stopSession"] = (threadId) =>
    requireContext(threadId).pipe(Effect.flatMap(stopContext));

  const stopAll = Effect.fn("CopilotAdapter.stopAll")(function* () {
    yield* Effect.forEach([...sessions.values()], stopContext, {
      concurrency: "unbounded",
      discard: true,
    });
  });

  yield* Effect.addFinalizer(() =>
    stopAll().pipe(
      Effect.catch(() => Effect.void),
      Effect.andThen(Effect.promise(() => client.stop().catch(() => [])).pipe(Effect.asVoid)),
      Effect.ensuring(Queue.shutdown(runtimeEvents)),
    ),
  );

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions: () => Effect.sync(() => [...sessions.values()].map((context) => context.session)),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread,
    rollbackThread,
    stopAll,
    get streamEvents() {
      return Stream.fromQueue(runtimeEvents);
    },
  } satisfies CopilotAdapterShape;
});
