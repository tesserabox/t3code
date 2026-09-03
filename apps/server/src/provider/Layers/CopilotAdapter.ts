// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  type AssistantUsageData,
  CopilotClient,
  type CopilotClientOptions,
  type CopilotSession,
  type MessageOptions,
  type PermissionRequest,
  type PermissionRequestResult,
  type ResumeSessionConfig,
  type SessionConfig,
  type SessionEvent,
  type SkillsLoadedSkill,
} from "@github/copilot-sdk";
import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  ThreadId,
  TurnId,
  type CopilotSettings,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type {
  ProviderAdapterShape,
  ProviderThreadSnapshot,
  ProviderThreadTurnSnapshot,
} from "../Services/ProviderAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { resolveCopilotClientConfiguration } from "./copilotClientOptions.ts";

const PROVIDER = ProviderDriverKind.make("githubCopilot");
const LEGACY_PROVIDER = ProviderDriverKind.make("copilot");
const RESUME_CURSOR_VERSION = 1 as const;
const USER_INPUT_ID = "answer";
const MAX_DETAIL_CHARS = 2_000;
const MAX_STREAM_CHARS = 8_000;
const MAX_RAW_STRING_CHARS = 4_000;
const DEFAULT_EVENT_RPC_TIMEOUT_MS = 10_000;
const DEFAULT_EVENT_DRAIN_TIMEOUT_MS = 15_000;
const DEFAULT_DISCONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_CLIENT_STOP_TIMEOUT_MS = 10_000;
const DEFAULT_FORCE_STOP_TIMEOUT_MS = 5_000;
const SENSITIVE_ARGUMENT_KEY = /(?:authorization|cookie|credential|password|secret|token)/iu;

type CopilotSessionRpc = CopilotSession["rpc"];
type CopilotReasoningEffort = NonNullable<SessionConfig["reasoningEffort"]>;
type CopilotAdapterError =
  | ProviderAdapterValidationError
  | ProviderAdapterSessionNotFoundError
  | ProviderAdapterRequestError
  | ProviderAdapterProcessError;
type CopilotUserInputRequest = Parameters<NonNullable<SessionConfig["onUserInputRequest"]>>[0];
type CopilotUserInputResponse = Awaited<
  ReturnType<NonNullable<SessionConfig["onUserInputRequest"]>>
>;
type CopilotExitPlanRequest = Parameters<NonNullable<SessionConfig["onExitPlanModeRequest"]>>[0];
type CopilotTask = Awaited<ReturnType<CopilotSessionRpc["tasks"]["list"]>>["tasks"][number];
type CopilotRpcSkill = Awaited<ReturnType<CopilotSessionRpc["skills"]["list"]>>["skills"][number];

export interface CopilotSessionHandle {
  readonly sessionId: string;
  readonly send: (options: MessageOptions) => Promise<string>;
  readonly abort: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly getEvents: () => Promise<SessionEvent[]>;
  readonly setModel: CopilotSession["setModel"];
  readonly rpc: {
    readonly commands: Pick<CopilotSessionRpc["commands"], "respondToQueuedCommand">;
    readonly mode: Pick<CopilotSessionRpc["mode"], "set">;
    readonly model: Pick<CopilotSessionRpc["model"], "setReasoningEffort">;
    readonly plan: Pick<CopilotSessionRpc["plan"], "read">;
    readonly skills: Pick<CopilotSessionRpc["skills"], "list">;
    readonly tasks: Pick<CopilotSessionRpc["tasks"], "list">;
  };
}

export interface CopilotClientHandle {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<ReadonlyArray<Error>>;
  readonly forceStop: () => Promise<void>;
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
  readonly onSkillsChanged?: (input: {
    readonly threadId: ThreadId;
    readonly skills: ReadonlyArray<ServerProviderSkill>;
  }) => Effect.Effect<void>;
  readonly onSessionClosed?: (threadId: ThreadId) => Effect.Effect<void>;
  readonly deadlines?: {
    readonly eventRpcMs?: number;
    readonly eventDrainMs?: number;
    readonly disconnectMs?: number;
    readonly clientStopMs?: number;
    readonly forceStopMs?: number;
  };
}

interface PendingApproval {
  readonly request: PermissionRequest;
  readonly turnId: TurnId | undefined;
  readonly resolve: (result: PermissionRequestResult) => void;
}

interface PendingUserInput {
  readonly choices: ReadonlyArray<string>;
  readonly turnId: TurnId | undefined;
  readonly resolve: (result: CopilotUserInputResponse) => void;
}

interface CopilotToolState {
  readonly itemType:
    | "command_execution"
    | "file_change"
    | "mcp_tool_call"
    | "dynamic_tool_call"
    | "web_search";
  readonly toolName: string;
  readonly agentId: string | undefined;
  readonly data: Record<string, unknown>;
}

interface CopilotTaskState {
  readonly taskId: RuntimeTaskId;
  readonly taskType: string;
  readonly title: string;
  readonly role?: string;
  readonly model?: string;
  readonly toolUseId?: string;
  latestResponse?: string;
}

interface CopilotUsageTotals {
  readonly apiCalls: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly durationMs: number;
  readonly totalNanoAiu: number;
}

interface CopilotTurnUsage extends CopilotUsageTotals {
  readonly calls: ReadonlyArray<AssistantUsageData>;
  readonly models: Readonly<Record<string, CopilotUsageTotals>>;
}

interface CopilotSessionContext {
  session: ProviderSession;
  sdkSession: CopilotSessionHandle | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<ProviderThreadTurnSnapshot>;
  readonly tools: Map<string, CopilotToolState>;
  readonly tasks: Map<string, CopilotTaskState>;
  readonly taskIdByToolCallId: Map<string, string>;
  readonly terminalTaskIds: Set<string>;
  readonly seenEventIds: Set<string>;
  readonly eventSemaphore: Semaphore.Semaphore;
  activeTurnId: TurnId | undefined;
  activeTurnCompleted: boolean;
  lastPlanMarkdown: string | undefined;
  turnUsage: CopilotTurnUsage | undefined;
  omittedBinaryAssetWarningEmitted: boolean;
  resumeAlreadyInUse: boolean;
  exitEmitted: boolean;
  stopped: boolean;
}

interface CopilotSkillLike {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly userInvocable: boolean;
  readonly enabled: boolean;
  readonly path?: string;
}

function ownedString(value: string): string {
  return Array.from(value).join("");
}

function boundedText(value: string | undefined, maxChars = MAX_DETAIL_CHARS): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const bounded =
    trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, Math.max(0, maxChars - 1))}…`;
  return ownedString(bounded);
}

function boundedContentText(
  value: string | undefined,
  maxChars = MAX_DETAIL_CHARS,
): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const bounded =
    value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
  return ownedString(bounded);
}

function boundedStreamText(value: string, maxChars = MAX_STREAM_CHARS): string {
  const bounded =
    value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
  return ownedString(bounded);
}

const EMPTY_USAGE_TOTALS: CopilotUsageTotals = {
  apiCalls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  durationMs: 0,
  totalNanoAiu: 0,
};

function usageCount(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.trunc(value));
}

function addUsageTotals(
  current: CopilotUsageTotals,
  usage: AssistantUsageData,
): CopilotUsageTotals {
  return {
    apiCalls: current.apiCalls + 1,
    inputTokens: current.inputTokens + usageCount(usage.inputTokens),
    cachedInputTokens: current.cachedInputTokens + usageCount(usage.cacheReadTokens),
    cacheWriteTokens: current.cacheWriteTokens + usageCount(usage.cacheWriteTokens),
    outputTokens: current.outputTokens + usageCount(usage.outputTokens),
    reasoningOutputTokens: current.reasoningOutputTokens + usageCount(usage.reasoningTokens),
    durationMs: current.durationMs + usageCount(usage.duration),
    totalNanoAiu: current.totalNanoAiu + usageCount(usage.copilotUsage?.totalNanoAiu),
  };
}

function accumulateTurnUsage(
  current: CopilotTurnUsage | undefined,
  usage: AssistantUsageData,
): CopilotTurnUsage {
  const previous = current ?? { ...EMPTY_USAGE_TOTALS, calls: [], models: {} };
  const previousModel = previous.models[usage.model] ?? EMPTY_USAGE_TOTALS;
  return {
    ...addUsageTotals(previous, usage),
    calls: [...previous.calls, usage],
    models: {
      ...previous.models,
      [usage.model]: addUsageTotals(previousModel, usage),
    },
  };
}

function boundedJson(value: unknown): string {
  let serialized: string;
  try {
    serialized =
      JSON.stringify(value, (key, entry: unknown) => {
        if (SENSITIVE_ARGUMENT_KEY.test(key)) {
          return "[redacted]";
        }
        if (typeof entry === "string") {
          return boundedText(entry, MAX_RAW_STRING_CHARS) ?? "";
        }
        return entry;
      }) ?? String(value);
  } catch (cause) {
    return `[unserializable: ${cause instanceof Error ? cause.message : String(cause)}]`;
  }
  return boundedText(serialized, MAX_DETAIL_CHARS) ?? "";
}

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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

function requestArgs(request: PermissionRequest): Record<string, unknown> {
  switch (request.kind) {
    case "shell":
      return {
        command: boundedText(request.fullCommandText),
        commandIdentifiers: request.commands.map((command) => command.identifier),
        possiblePaths: request.possiblePaths.slice(0, 20),
        requestSandboxBypass: request.requestSandboxBypass === true,
      };
    case "read":
      return {
        path: request.path,
        requestSandboxBypass: request.requestSandboxBypass === true,
      };
    case "write":
      return {
        fileName: request.fileName,
        diff: boundedText(request.diff),
        requestSandboxBypass: request.requestSandboxBypass === true,
      };
    case "mcp":
      return {
        serverName: request.serverName,
        toolName: request.toolName,
        arguments: boundedJson(request.args),
      };
    case "custom-tool":
      return { toolName: request.toolName, arguments: boundedJson(request.args) };
    case "hook":
      return { toolName: request.toolName, arguments: boundedJson(request.toolArgs) };
    case "memory":
      return { action: request.action, subject: request.subject };
    case "url":
      return { url: request.url, requestSandboxBypass: request.requestSandboxBypass === true };
    case "extension-management":
      return { operation: request.operation, extensionName: request.extensionName };
    case "extension-permission-access":
      return {
        extensionName: request.extensionName,
        capabilities: request.capabilities.slice(0, 20),
      };
  }
}

function canApproveForSession(request: PermissionRequest): boolean {
  return (
    request.kind !== "hook" &&
    request.kind !== "url" &&
    (request.kind !== "shell" || request.canOfferSessionApproval) &&
    (request.kind !== "write" || request.canOfferSessionApproval)
  );
}

function canApproveAlways(request: PermissionRequest): boolean {
  return request.kind === "url"
    ? urlDomain(request.url) !== undefined
    : canApproveForSession(request);
}

function approvalOptions(request: PermissionRequest): ReadonlyArray<ProviderApprovalOption> {
  return [
    { decision: "accept", label: "Allow once" },
    ...(canApproveForSession(request)
      ? ([{ decision: "acceptForSession", label: "Allow for session" }] as const)
      : []),
    ...(canApproveAlways(request)
      ? ([{ decision: "acceptAlways", label: "Always allow" }] as const)
      : []),
    { decision: "decline", label: "Decline" },
  ];
}

function sessionApproval(request: PermissionRequest) {
  switch (request.kind) {
    case "shell":
      return {
        kind: "commands" as const,
        commandIdentifiers: request.commands.map((command) => command.identifier),
      };
    case "read":
      return { kind: "read" as const };
    case "write":
      return { kind: "write" as const };
    case "mcp":
      return {
        kind: "mcp" as const,
        serverName: request.serverName,
        toolName: request.toolName,
      };
    case "memory":
      return { kind: "memory" as const };
    case "custom-tool":
      return { kind: "custom-tool" as const, toolName: request.toolName };
    case "extension-management":
      return { kind: "extension-management" as const, operation: request.operation };
    case "extension-permission-access":
      return {
        kind: "extension-permission-access" as const,
        extensionName: request.extensionName,
      };
    case "hook":
    case "url":
      return undefined;
  }
}

function urlDomain(value: string): string | undefined {
  try {
    return new URL(value).hostname || undefined;
  } catch {
    return undefined;
  }
}

function isApprovalDecisionSupported(
  request: PermissionRequest,
  decision: ProviderApprovalDecision,
): boolean {
  if (decision === "acceptForSession") return canApproveForSession(request);
  if (decision === "acceptAlways") return canApproveAlways(request);
  return true;
}

function approvalResult(
  context: CopilotSessionContext,
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

  const approval = canApproveForSession(request) ? sessionApproval(request) : undefined;
  if (decision === "acceptForSession") {
    return approval
      ? { kind: "approve-for-session", approval }
      : { kind: "reject", feedback: "Session approval is not supported for this request." };
  }

  if (request.kind === "url") {
    const domain = urlDomain(request.url);
    return domain
      ? { kind: "approve-permanently", domain }
      : { kind: "reject", feedback: "Permanent approval requires a valid URL domain." };
  }
  const locationKey = context.session.cwd;
  return approval && locationKey
    ? { kind: "approve-for-location", approval, locationKey }
    : approval
      ? { kind: "approve-for-session", approval }
      : { kind: "reject", feedback: "Persistent approval is not supported for this request." };
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
      (request.kind === "mcp" && request.readOnly) ||
      (request.kind === "shell" &&
        !request.hasWriteFileRedirection &&
        request.commands.every((command) => command.readOnly)))
  ) {
    return { kind: "approve-once" };
  }
  return undefined;
}

function toolItemType(toolName: string, mcpServerName?: string): CopilotToolState["itemType"] {
  const normalized = toolName.toLowerCase();
  if (mcpServerName) return "mcp_tool_call";
  if (
    normalized.includes("shell") ||
    normalized.includes("bash") ||
    normalized.includes("powershell") ||
    normalized.includes("command")
  ) {
    return "command_execution";
  }
  if (normalized.includes("write") || normalized.includes("edit") || normalized.includes("patch")) {
    return "file_change";
  }
  if (normalized.includes("web") || normalized.includes("search")) {
    return "web_search";
  }
  return "dynamic_tool_call";
}

function toolCommand(argumentsValue: Record<string, unknown> | undefined): string | undefined {
  if (!argumentsValue) return undefined;
  for (const key of ["command", "cmd", "script"] as const) {
    const value = argumentsValue[key];
    if (typeof value === "string") return boundedText(value);
  }
  return undefined;
}

function toolPath(argumentsValue: Record<string, unknown> | undefined): string | undefined {
  if (!argumentsValue) return undefined;
  for (const key of ["path", "filePath", "filename"] as const) {
    const value = argumentsValue[key];
    if (typeof value === "string") return boundedText(value);
  }
  return undefined;
}

function toolStartData(event: Extract<SessionEvent, { type: "tool.execution_start" }>) {
  const command = toolCommand(event.data.arguments);
  const path = toolPath(event.data.arguments);
  return {
    toolCallId: event.data.toolCallId,
    toolName: event.data.toolName,
    ...(command ? { command } : {}),
    ...(path ? { path } : {}),
    ...(event.data.mcpServerName ? { server: event.data.mcpServerName } : {}),
    ...(event.data.arguments ? { arguments: boundedJson(event.data.arguments) } : {}),
  };
}

function toolResultData(event: Extract<SessionEvent, { type: "tool.execution_complete" }>) {
  const result = event.data.result;
  return {
    toolCallId: event.data.toolCallId,
    success: event.data.success,
    ...(result
      ? {
          result: {
            content: boundedText(result.detailedContent ?? result.content),
            ...(result.contents ? { structuredContentCount: result.contents.length } : {}),
            ...(result.binaryResultsForLlm
              ? { binaryResultCount: result.binaryResultsForLlm.length }
              : {}),
          },
        }
      : {}),
    ...(event.data.error ? { error: boundedText(event.data.error.message) } : {}),
  };
}

function sanitizedRawPayload(event: SessionEvent): unknown {
  switch (event.type) {
    case "tool.execution_start":
      return { ...event, data: toolStartData(event) };
    case "tool.execution_complete":
      return { ...event, data: toolResultData(event) };
    case "session.binary_asset":
      return {
        ...event,
        data: {
          assetId: event.data.assetId,
          byteLength: event.data.byteLength,
          mimeType: event.data.mimeType,
        },
      };
    default:
      return event;
  }
}

function taskStatus(status: CopilotTask["status"]) {
  switch (status) {
    case "running":
      return "running" as const;
    case "idle":
      return "idle" as const;
    case "completed":
      return "completed" as const;
    case "failed":
      return "failed" as const;
    case "cancelled":
      return "cancelled" as const;
  }
}

function copilotReasoningEffort(value: string | undefined): CopilotReasoningEffort | undefined {
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

export function copilotSkillsFromSdk(
  input: ReadonlyArray<CopilotSkillLike | SkillsLoadedSkill | CopilotRpcSkill>,
): ReadonlyArray<ServerProviderSkill> {
  const skillsByName = new Map<string, ServerProviderSkill>();
  for (const skill of input) {
    const name = skill.name.trim();
    if (!name || !skill.userInvocable || skillsByName.has(name)) {
      continue;
    }
    const description = boundedText(skill.description);
    const path = skill.path?.trim() || `copilot://skills/${encodeURIComponent(name)}`;
    skillsByName.set(name, {
      name,
      path,
      scope: skill.source,
      enabled: skill.enabled,
      ...(description ? { description, shortDescription: description } : {}),
      displayName: name,
    });
  }
  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function copilotInstanceSnapshotSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  return skills.filter(
    (skill) =>
      skill.scope === "personal-copilot" ||
      skill.scope === "personal-agents" ||
      skill.scope === "plugin" ||
      skill.scope === "builtin",
  );
}

export const makeCopilotAdapter = Effect.fn("makeCopilotAdapter")(function* (
  settings: CopilotSettings,
  options: CopilotAdapterLiveOptions = {},
) {
  const serverConfig = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const runtimeContext = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(runtimeContext);
  const boundInstanceId = options.instanceId ?? ProviderInstanceId.make(PROVIDER);
  const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, CopilotSessionContext>();
  const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
  const clientConfiguration = resolveCopilotClientConfiguration({
    settings,
    cwd: serverConfig.cwd,
    ...(options.environment ? { environment: options.environment } : {}),
  });
  const clientOptions = clientConfiguration.options;
  const client =
    options.clientFactory?.(clientOptions) ??
    (new CopilotClient(clientOptions) as CopilotClientHandle);
  let startPromise: Promise<void> | undefined;
  let forceStopPromise: Promise<void> | undefined;
  let clientUnavailableReason: string | undefined;
  const deadline = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback;
  const deadlines = {
    eventRpcMs: deadline(options.deadlines?.eventRpcMs, DEFAULT_EVENT_RPC_TIMEOUT_MS),
    eventDrainMs: deadline(options.deadlines?.eventDrainMs, DEFAULT_EVENT_DRAIN_TIMEOUT_MS),
    disconnectMs: deadline(options.deadlines?.disconnectMs, DEFAULT_DISCONNECT_TIMEOUT_MS),
    clientStopMs: deadline(options.deadlines?.clientStopMs, DEFAULT_CLIENT_STOP_TIMEOUT_MS),
    forceStopMs: deadline(options.deadlines?.forceStopMs, DEFAULT_FORCE_STOP_TIMEOUT_MS),
  };

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUUID = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to generate a Copilot runtime identifier.",
          cause,
        }),
    ),
  );
  const emit = (event: ProviderRuntimeEvent) =>
    PubSub.publish(runtimeEvents, event).pipe(Effect.asVoid);
  const forkLogged = <E>(effect: Effect.Effect<void, E>) => {
    runFork(
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logError("GitHub Copilot event processing failed.", { cause }),
        ),
      ),
    );
  };
  const ensureClientStarted = (): Promise<void> => {
    if (clientUnavailableReason) {
      return Promise.reject(new Error(clientUnavailableReason));
    }
    startPromise ??= client.start().catch((cause) => {
      startPromise = undefined;
      throw cause;
    });
    return startPromise;
  };
  const getThreadSemaphore = (threadId: string) =>
    SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
      const existing = Option.fromNullishOr(current.get(threadId));
      return Option.match(existing, {
        onNone: () =>
          Semaphore.make(1).pipe(
            Effect.map((semaphore) => {
              const next = new Map(current);
              next.set(threadId, semaphore);
              return [semaphore, next] as const;
            }),
          ),
        onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
      });
    });
  const withThreadLock = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));
  const makeSyntheticStamp = Effect.all({
    eventId: Effect.map(randomUUID, EventId.make),
    createdAt: nowIso,
  });

  const eventBase = (
    context: CopilotSessionContext,
    event: SessionEvent,
    fields?: {
      readonly turnId?: TurnId;
      readonly itemId?: string;
      readonly requestId?: ApprovalRequestId;
    },
  ) => ({
    eventId: EventId.make(event.id),
    provider: PROVIDER,
    providerInstanceId: boundInstanceId,
    threadId: context.session.threadId,
    createdAt: event.timestamp,
    ...((fields?.turnId ?? context.activeTurnId)
      ? { turnId: fields?.turnId ?? context.activeTurnId }
      : {}),
    ...(fields?.itemId ? { itemId: RuntimeItemId.make(fields.itemId) } : {}),
    ...(fields?.requestId ? { requestId: RuntimeRequestId.make(fields.requestId) } : {}),
    raw: {
      source: "copilot.sdk.session-event" as const,
      messageType: event.type,
      payload: sanitizedRawPayload(event),
    },
  });

  const syntheticBase = Effect.fn("CopilotAdapter.syntheticBase")(function* (
    context: CopilotSessionContext,
    messageType: string,
    payload: unknown,
    fields?: {
      readonly turnId?: TurnId;
      readonly itemId?: string;
      readonly requestId?: ApprovalRequestId;
    },
  ) {
    const stamp = yield* makeSyntheticStamp;
    return {
      ...stamp,
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: context.session.threadId,
      ...((fields?.turnId ?? context.activeTurnId)
        ? { turnId: fields?.turnId ?? context.activeTurnId }
        : {}),
      ...(fields?.itemId ? { itemId: RuntimeItemId.make(fields.itemId) } : {}),
      ...(fields?.requestId ? { requestId: RuntimeRequestId.make(fields.requestId) } : {}),
      raw: {
        source: "copilot.sdk.synthetic" as const,
        messageType,
        payload,
      },
    };
  });

  const updateSession = (
    context: CopilotSessionContext,
    patch: Partial<ProviderSession>,
    clear?: "activeTurnId" | "lastError",
  ) =>
    Effect.gen(function* () {
      const updatedAt = yield* nowIso;
      const next: ProviderSession & Record<string, unknown> = {
        ...context.session,
        ...patch,
        updatedAt,
      };
      if (clear) delete next[clear];
      context.session = next;
    });

  const writeNative = (context: CopilotSessionContext, event: SessionEvent) =>
    options.nativeEventLogger
      ? options.nativeEventLogger.write(
          {
            observedAt: event.timestamp,
            event: sanitizedRawPayload(event),
          },
          context.session.threadId,
        )
      : Effect.void;

  const requireContext = (
    threadId: ThreadId,
  ): Effect.Effect<CopilotSessionContext, ProviderAdapterSessionNotFoundError> => {
    const context = sessions.get(threadId);
    return context && !context.stopped
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

  const runSdkRequest = <A>(
    method: string,
    request: () => Promise<A>,
    timeoutMs = deadlines.eventRpcMs,
  ): Effect.Effect<A, ProviderAdapterRequestError> =>
    Effect.tryPromise({
      try: request,
      catch: (cause) => toRequestError(method, cause),
    }).pipe(
      Effect.timeoutOption(timeoutMs),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              toRequestError(
                method,
                new Error(`GitHub Copilot SDK request timed out after ${timeoutMs}ms.`),
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const forceStopClient = Effect.fn("CopilotAdapter.forceStopClient")(function* (reason: string) {
    clientUnavailableReason ??= reason;
    startPromise = undefined;
    forceStopPromise ??= Promise.resolve().then(() => client.forceStop());
    const forceStopExit = yield* Effect.tryPromise({
      try: () => forceStopPromise!,
      catch: (cause) => toRequestError("client.forceStop", cause),
    }).pipe(Effect.timeoutOption(deadlines.forceStopMs), Effect.exit);
    if (Exit.isFailure(forceStopExit)) {
      yield* Effect.logError("GitHub Copilot client force-stop failed.", {
        reason,
        cause: forceStopExit.cause,
      });
    } else if (Option.isNone(forceStopExit.value)) {
      yield* Effect.logError("GitHub Copilot client force-stop timed out.", {
        reason,
        timeoutMs: deadlines.forceStopMs,
      });
    }
  });

  const completeTurn = Effect.fn("CopilotAdapter.completeTurn")(function* (
    context: CopilotSessionContext,
    state: "completed" | "failed" | "interrupted",
    event: SessionEvent,
    errorMessage?: string,
    synthetic?: {
      readonly messageType: string;
      readonly payload: unknown;
    },
  ) {
    const turnId = context.activeTurnId;
    if (!turnId || context.activeTurnCompleted) return;
    context.activeTurnCompleted = true;
    const base = synthetic
      ? yield* syntheticBase(context, synthetic.messageType, synthetic.payload, { turnId })
      : eventBase(context, event, { turnId });
    yield* emit({
      ...base,
      type: "turn.completed",
      payload: {
        state,
        ...(context.turnUsage !== undefined
          ? {
              usage: {
                apiCalls: context.turnUsage.apiCalls,
                inputTokens: context.turnUsage.inputTokens,
                cachedInputTokens: context.turnUsage.cachedInputTokens,
                cacheWriteTokens: context.turnUsage.cacheWriteTokens,
                outputTokens: context.turnUsage.outputTokens,
                reasoningOutputTokens: context.turnUsage.reasoningOutputTokens,
                durationMs: context.turnUsage.durationMs,
                totalNanoAiu: context.turnUsage.totalNanoAiu,
                calls: context.turnUsage.calls,
              },
              modelUsage: context.turnUsage.models,
            }
          : {}),
        ...(errorMessage ? { errorMessage } : {}),
      },
    });
    context.activeTurnId = undefined;
    yield* updateSession(
      context,
      {
        status: state === "failed" ? "error" : "ready",
        ...(errorMessage ? { lastError: errorMessage } : {}),
      },
      "activeTurnId",
    );
  });

  const emitPlan = Effect.fn("CopilotAdapter.emitPlan")(function* (
    context: CopilotSessionContext,
    planMarkdown: string,
    messageType: string,
    rawPayload: unknown,
  ) {
    const bounded = boundedText(planMarkdown, 120_000);
    if (!bounded || bounded === context.lastPlanMarkdown) return;
    context.lastPlanMarkdown = bounded;
    yield* emit({
      ...(yield* syntheticBase(context, messageType, rawPayload)),
      type: "turn.proposed.completed",
      payload: { planMarkdown: bounded },
    });
  });

  const publishSkills = Effect.fn("CopilotAdapter.publishSkills")(function* (
    context: CopilotSessionContext,
    input: ReadonlyArray<CopilotSkillLike | SkillsLoadedSkill | CopilotRpcSkill>,
  ) {
    const skills = copilotSkillsFromSdk(input);
    if (options.onSkillsChanged) {
      yield* options.onSkillsChanged({
        threadId: context.session.threadId,
        skills: copilotInstanceSnapshotSkills(skills),
      });
    }
    if (context.stopped) return;
    if (input.some((skill) => skill.userInvocable && !skill.path)) {
      yield* emit({
        ...(yield* syntheticBase(
          context,
          "skills.path.synthetic",
          "One or more Copilot skills did not expose a filesystem path.",
        )),
        type: "runtime.warning",
        payload: {
          message: "Some Copilot skills use synthetic paths because the SDK did not expose one.",
        },
      });
    }
  });

  const taskLinkage = (task: CopilotTaskState) => ({
    taskType: task.taskType,
    title: task.title,
    ...(task.role ? { role: task.role } : {}),
    ...(task.model ? { model: task.model } : {}),
    ...(task.toolUseId ? { toolUseId: task.toolUseId } : {}),
  });

  const emitTaskStarted = Effect.fn("CopilotAdapter.emitTaskStarted")(function* (
    context: CopilotSessionContext,
    task: CopilotTaskState,
    createdAt?: string,
  ) {
    if (context.tasks.has(task.taskId)) return;
    context.tasks.set(task.taskId, task);
    const stamp = yield* makeSyntheticStamp;
    yield* emit({
      ...stamp,
      ...(createdAt ? { createdAt } : {}),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: context.session.threadId,
      ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
      type: "task.started",
      payload: {
        taskId: task.taskId,
        description: task.title,
        ...taskLinkage(task),
      },
    });
  });

  const emitTaskCompleted = Effect.fn("CopilotAdapter.emitTaskCompleted")(function* (
    context: CopilotSessionContext,
    input: {
      readonly taskId: string;
      readonly status: "completed" | "failed" | "stopped";
      readonly summary?: string;
      readonly fallback: CopilotTaskState;
      readonly typedUsage?: {
        readonly totalTokens: number;
        readonly toolUses?: number;
        readonly durationMs?: number;
      };
      readonly createdAt?: string;
    },
  ) {
    if (context.terminalTaskIds.has(input.taskId)) return;
    const task = context.tasks.get(input.taskId) ?? input.fallback;
    yield* emitTaskStarted(context, task, input.createdAt);
    context.terminalTaskIds.add(input.taskId);
    const stamp = yield* makeSyntheticStamp;
    const summary = boundedText(input.summary);
    yield* emit({
      ...stamp,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: context.session.threadId,
      ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
      type: "task.completed",
      payload: {
        taskId: task.taskId,
        status: input.status,
        ...(summary ? { summary } : {}),
        ...(input.typedUsage ? { typedUsage: input.typedUsage } : {}),
        ...taskLinkage(task),
      },
    });
  });

  const refreshTasks = Effect.fn("CopilotAdapter.refreshTasks")(function* (
    context: CopilotSessionContext,
  ) {
    const sdkSession = context.sdkSession;
    if (!sdkSession) return;
    const listed = yield* runSdkRequest("tasks.list", () => sdkSession.rpc.tasks.list());
    if (context.stopped) return;
    const listedIds = new Set<string>();
    for (const task of listed.tasks) {
      listedIds.add(task.id);
      const latestResponse =
        task.type === "agent" ? boundedContentText(task.latestResponse) : undefined;
      const state: CopilotTaskState =
        task.type === "agent"
          ? {
              taskId: RuntimeTaskId.make(task.id),
              taskType: task.agentType,
              title: boundedText(task.description) ?? task.agentType,
              role: task.agentType,
              ...((task.resolvedModel ?? task.model)
                ? { model: task.resolvedModel ?? task.model }
                : {}),
              toolUseId: task.toolCallId,
              ...(latestResponse ? { latestResponse } : {}),
            }
          : {
              taskId: RuntimeTaskId.make(task.id),
              taskType: "shell",
              title: boundedText(task.description) ?? "Background shell",
            };
      yield* emitTaskStarted(context, state, task.startedAt);
      const status = taskStatus(task.status);
      if (status === "completed" || status === "failed" || status === "cancelled") {
        const summary =
          task.type === "agent"
            ? (task.result ?? task.latestResponse ?? task.error)
            : task.description;
        yield* emitTaskCompleted(context, {
          taskId: task.id,
          status: status === "completed" ? "completed" : status === "failed" ? "failed" : "stopped",
          ...(summary ? { summary } : {}),
          fallback: state,
          ...(task.completedAt ? { createdAt: task.completedAt } : {}),
        });
      } else {
        const stamp = yield* makeSyntheticStamp;
        yield* emit({
          ...stamp,
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: context.session.threadId,
          ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
          type: "task.updated",
          payload: {
            taskId: state.taskId,
            status,
            ...(task.type === "agent" && task.latestResponse
              ? { description: boundedText(task.latestResponse) }
              : {}),
            ...taskLinkage(state),
          },
        });
      }
    }
    for (const [taskId, task] of context.tasks) {
      if (!listedIds.has(taskId) && !context.terminalTaskIds.has(taskId)) {
        yield* emitTaskCompleted(context, {
          taskId,
          status: "stopped",
          fallback: task,
        });
      }
    }
  });

  const handleEvent = Effect.fn("CopilotAdapter.handleEvent")(function* (
    context: CopilotSessionContext,
    event: SessionEvent,
  ) {
    if (context.stopped) return;
    if (context.seenEventIds.has(event.id)) return;
    context.seenEventIds.add(event.id);
    yield* writeNative(context, event);
    const turnId = context.activeTurnId;
    const turn = turnId ? context.turns.find((entry) => entry.id === turnId) : undefined;
    if (turn) {
      (turn.items as Array<unknown>).push(sanitizedRawPayload(event));
    }

    switch (event.type) {
      case "assistant.message_start":
        if (event.agentId) return;
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.messageId }),
          type: "item.started",
          payload: {
            itemType: "assistant_message",
            status: "inProgress",
          },
        });
        return;
      case "assistant.message_delta":
        if (event.agentId) return;
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.messageId }),
          type: "content.delta",
          payload: {
            streamKind: "assistant_text",
            delta: boundedStreamText(event.data.deltaContent),
          },
        });
        return;
      case "assistant.message": {
        if (event.agentId) {
          const task =
            context.tasks.get(event.agentId) ??
            ({
              taskId: RuntimeTaskId.make(event.agentId),
              taskType: "subagent",
              title: "Copilot subagent",
            } satisfies CopilotTaskState);
          yield* emitTaskStarted(context, task, event.timestamp);
          const summary = boundedContentText(event.data.content);
          if (summary) {
            const trackedTask = context.tasks.get(event.agentId);
            if (trackedTask) {
              trackedTask.latestResponse = summary;
            }
            yield* emit({
              ...eventBase(context, event),
              type: "task.progress",
              payload: {
                taskId: task.taskId,
                description: task.title,
                summary,
                ...taskLinkage(task),
              },
            });
          }
          return;
        }
        const detail = boundedContentText(event.data.content, 120_000);
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.messageId }),
          type: "item.completed",
          payload: {
            itemType: "assistant_message",
            status: "completed",
            ...(detail ? { detail } : {}),
            data: {
              messageId: event.data.messageId,
              ...(event.data.model ? { model: event.data.model } : {}),
            },
          },
        });
        return;
      }
      case "assistant.reasoning_delta":
        if (event.agentId) return;
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.reasoningId }),
          type: "content.delta",
          payload: {
            streamKind: "reasoning_text",
            delta: boundedStreamText(event.data.deltaContent),
          },
        });
        return;
      case "assistant.reasoning": {
        if (event.agentId) return;
        const detail = boundedContentText(event.data.content, 120_000);
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.reasoningId }),
          type: "item.completed",
          payload: {
            itemType: "reasoning",
            status: "completed",
            ...(detail ? { detail } : {}),
          },
        });
        return;
      }
      case "assistant.intent": {
        if (event.agentId) {
          const task = context.tasks.get(event.agentId);
          if (task) {
            yield* emit({
              ...eventBase(context, event),
              type: "task.progress",
              payload: {
                taskId: task.taskId,
                description: boundedText(event.data.intent) ?? task.title,
                ...taskLinkage(task),
              },
            });
          }
        } else {
          yield* emit({
            ...eventBase(context, event),
            type: "tool.progress",
            payload: { summary: boundedText(event.data.intent) },
          });
        }
        return;
      }
      case "assistant.server_tool_progress": {
        const itemId = `copilot-server-tool-${event.data.outputIndex}`;
        yield* emit({
          ...eventBase(context, event, { itemId }),
          type: event.data.status === "completed" ? "item.completed" : "item.updated",
          payload: {
            itemType: "web_search",
            status: event.data.status === "completed" ? "completed" : "inProgress",
            title: "Web search",
            detail: boundedText(event.data.status),
            ...(event.agentId ? { agentId: event.agentId } : {}),
          },
        });
        return;
      }
      case "tool.execution_start": {
        const state: CopilotToolState = {
          itemType: toolItemType(event.data.toolName, event.data.mcpServerName),
          toolName: event.data.toolName,
          agentId: event.agentId,
          data: toolStartData(event),
        };
        context.tools.set(event.data.toolCallId, state);
        const detail =
          toolCommand(event.data.arguments) ??
          toolPath(event.data.arguments) ??
          boundedText(event.data.toolDescription?.description);
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.toolCallId }),
          type: "item.started",
          payload: {
            itemType: state.itemType,
            status: "inProgress",
            title: event.data.toolName,
            ...(detail ? { detail } : {}),
            data: state.data,
            ...(event.agentId ? { agentId: event.agentId } : {}),
            ...(event.data.parentToolCallId
              ? { parentToolUseId: event.data.parentToolCallId }
              : {}),
          },
        });
        return;
      }
      case "tool.execution_partial_result": {
        const tool = context.tools.get(event.data.toolCallId);
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.toolCallId }),
          type: "content.delta",
          payload: {
            streamKind: tool?.itemType === "command_execution" ? "command_output" : "unknown",
            delta: boundedStreamText(event.data.partialOutput),
          },
        });
        return;
      }
      case "tool.execution_progress": {
        const tool = context.tools.get(event.data.toolCallId);
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.toolCallId }),
          type: "item.updated",
          payload: {
            itemType: tool?.itemType ?? "dynamic_tool_call",
            status: "inProgress",
            ...(boundedText(event.data.progressMessage)
              ? { detail: boundedText(event.data.progressMessage) }
              : {}),
            ...(tool?.agentId ? { agentId: tool.agentId } : {}),
          },
        });
        return;
      }
      case "tool.execution_complete": {
        const tool = context.tools.get(event.data.toolCallId);
        context.tools.delete(event.data.toolCallId);
        const detail = boundedText(
          event.data.error?.message ??
            event.data.result?.detailedContent ??
            event.data.result?.content,
        );
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.toolCallId }),
          type: "item.completed",
          payload: {
            itemType: tool?.itemType ?? "dynamic_tool_call",
            status: event.data.success ? "completed" : "failed",
            title: tool?.toolName ?? "Copilot tool",
            ...(detail ? { detail } : {}),
            data: {
              ...tool?.data,
              ...toolResultData(event),
            },
            ...(tool?.agentId ? { agentId: tool.agentId } : {}),
            ...(event.data.parentToolCallId
              ? { parentToolUseId: event.data.parentToolCallId }
              : {}),
          },
        });
        return;
      }
      case "assistant.usage":
        if (!event.agentId) {
          context.turnUsage = accumulateTurnUsage(context.turnUsage, event.data);
        }
        return;
      case "session.usage_info":
        yield* emit({
          ...eventBase(context, event),
          type: "thread.token-usage.updated",
          payload: {
            usage: {
              usedTokens: Math.max(0, Math.trunc(event.data.currentTokens)),
              maxTokens: Math.max(1, Math.trunc(event.data.tokenLimit)),
              compactsAutomatically: true,
            },
          },
        });
        return;
      case "assistant.turn_end":
        if (!event.agentId) {
          yield* completeTurn(context, "completed", event);
        }
        return;
      case "session.idle":
        yield* completeTurn(context, event.data.aborted ? "interrupted" : "completed", event);
        return;
      case "abort":
        yield* completeTurn(context, "interrupted", event);
        return;
      case "session.error":
        yield* emit({
          ...eventBase(context, event),
          type: "runtime.error",
          payload: {
            message: event.data.message,
            class:
              event.data.errorType === "authentication" || event.data.errorType === "authorization"
                ? "permission_error"
                : "provider_error",
            detail: {
              errorType: event.data.errorType,
              ...(event.data.errorCode ? { errorCode: event.data.errorCode } : {}),
            },
          },
        });
        if (!event.agentId) {
          yield* completeTurn(context, "failed", event, event.data.message);
        }
        return;
      case "session.shutdown": {
        const isError = event.data.shutdownType === "error";
        if (context.activeTurnId && !context.activeTurnCompleted) {
          yield* completeTurn(
            context,
            isError ? "failed" : "interrupted",
            event,
            isError ? (event.data.errorReason ?? "Copilot runtime shut down.") : undefined,
            {
              messageType: "session.shutdown.turn",
              payload: sanitizedRawPayload(event),
            },
          );
        }
        yield* closeContextSerialized(context, {
          disconnect: false,
          event,
          reason: event.data.errorReason ?? "Copilot runtime shut down.",
          exitKind: isError ? "error" : "graceful",
          recoverable: isError,
        });
        return;
      }
      case "session.title_changed":
        yield* emit({
          ...eventBase(context, event),
          type: "thread.metadata.updated",
          payload: { name: event.data.title },
        });
        return;
      case "session.model_change":
        yield* updateSession(context, { model: event.data.newModel });
        if (event.data.cause && event.data.previousModel) {
          yield* emit({
            ...eventBase(context, event),
            type: "model.rerouted",
            payload: {
              fromModel: event.data.previousModel,
              toModel: event.data.newModel,
              reason: event.data.cause,
            },
          });
        }
        return;
      case "session.plan_changed": {
        const sdkSession = context.sdkSession;
        if (!sdkSession) return;
        const plan = yield* runSdkRequest("plan.read", () => sdkSession.rpc.plan.read());
        if (context.stopped) return;
        if (plan.exists && plan.content) {
          yield* emitPlan(context, plan.content, event.type, event.data);
        }
        return;
      }
      case "session.compaction_start":
        return;
      case "session.compaction_complete": {
        if (event.data.success) {
          yield* emit({
            ...eventBase(context, event),
            type: "thread.state.changed",
            payload: {
              state: "compacted",
              detail: {
                kind: "compaction",
                ...(event.data.messagesRemoved !== undefined
                  ? { messagesRemoved: event.data.messagesRemoved }
                  : {}),
                ...(event.data.postCompactionTokens !== undefined
                  ? { postCompactionTokens: event.data.postCompactionTokens }
                  : {}),
              },
            },
          });
        } else {
          yield* emit({
            ...eventBase(context, event),
            type: "runtime.warning",
            payload: {
              message: "Copilot context compaction failed.",
              ...(boundedText(event.data.error) ? { detail: event.data.error } : {}),
            },
          });
        }
        return;
      }
      case "session.truncation":
        yield* emit({
          ...eventBase(context, event),
          type: "thread.state.changed",
          payload: {
            state: "compacted",
            detail: {
              kind: "truncation",
              tokensRemoved: event.data.tokensRemovedDuringTruncation,
              messagesRemoved: event.data.messagesRemovedDuringTruncation,
              tokenLimit: event.data.tokenLimit,
            },
          },
        });
        return;
      case "subagent.started": {
        const taskId = event.agentId ?? event.data.toolCallId;
        context.taskIdByToolCallId.set(event.data.toolCallId, taskId);
        yield* emitTaskStarted(
          context,
          {
            taskId: RuntimeTaskId.make(taskId),
            taskType: event.data.agentName,
            title: boundedText(event.data.agentDisplayName) ?? event.data.agentName,
            role: event.data.agentName,
            ...(event.data.model ? { model: event.data.model } : {}),
            toolUseId: event.data.toolCallId,
          },
          event.timestamp,
        );
        return;
      }
      case "subagent.completed":
      case "subagent.failed": {
        const taskId =
          event.agentId ??
          context.taskIdByToolCallId.get(event.data.toolCallId) ??
          event.data.toolCallId;
        const totalTokens =
          event.data.totalTokens !== undefined
            ? Math.max(0, Math.trunc(event.data.totalTokens))
            : undefined;
        yield* emitTaskCompleted(context, {
          taskId,
          status: event.type === "subagent.completed" ? "completed" : "failed",
          summary:
            event.type === "subagent.failed"
              ? event.data.error
              : context.tasks.get(taskId)?.latestResponse,
          fallback: {
            taskId: RuntimeTaskId.make(taskId),
            taskType: event.data.agentName,
            title: event.data.agentDisplayName,
            role: event.data.agentName,
            ...(event.data.model ? { model: event.data.model } : {}),
            toolUseId: event.data.toolCallId,
          },
          ...(totalTokens !== undefined
            ? {
                typedUsage: {
                  totalTokens,
                  ...(event.data.totalToolCalls !== undefined
                    ? { toolUses: Math.max(0, Math.trunc(event.data.totalToolCalls)) }
                    : {}),
                  ...(event.data.durationMs !== undefined
                    ? { durationMs: Math.max(0, Math.trunc(event.data.durationMs)) }
                    : {}),
                },
              }
            : {}),
          createdAt: event.timestamp,
        });
        return;
      }
      case "system.notification": {
        const notification = event.data.kind;
        if (notification.type === "agent_completed") {
          const task = context.tasks.get(notification.agentId);
          yield* emitTaskCompleted(context, {
            taskId: notification.agentId,
            status: notification.status === "completed" ? "completed" : "failed",
            summary:
              notification.status === "completed" ? task?.latestResponse : notification.description,
            fallback: {
              taskId: RuntimeTaskId.make(notification.agentId),
              taskType: notification.agentType,
              title: notification.description ?? notification.agentType,
              role: notification.agentType,
            },
            createdAt: event.timestamp,
          });
        } else if (notification.type === "agent_idle") {
          const task =
            context.tasks.get(notification.agentId) ??
            ({
              taskId: RuntimeTaskId.make(notification.agentId),
              taskType: notification.agentType,
              title: notification.description ?? notification.agentType,
              role: notification.agentType,
            } satisfies CopilotTaskState);
          yield* emitTaskStarted(context, task, event.timestamp);
          yield* emit({
            ...eventBase(context, event),
            type: "task.updated",
            payload: { taskId: task.taskId, status: "idle", ...taskLinkage(task) },
          });
        } else if (
          notification.type === "shell_completed" ||
          notification.type === "shell_detached_completed"
        ) {
          yield* emitTaskCompleted(context, {
            taskId: notification.shellId,
            status:
              notification.type === "shell_completed" && notification.exitCode !== undefined
                ? notification.exitCode === 0
                  ? "completed"
                  : "failed"
                : "completed",
            summary: notification.description,
            fallback: {
              taskId: RuntimeTaskId.make(notification.shellId),
              taskType: "shell",
              title: notification.description ?? "Background shell",
            },
            createdAt: event.timestamp,
          });
        }
        return;
      }
      case "session.background_tasks_changed":
        yield* refreshTasks(context).pipe(
          Effect.catchTag("ProviderAdapterRequestError", (error) =>
            emit({
              ...eventBase(context, event),
              type: "runtime.warning",
              payload: {
                message: "Copilot background task refresh failed.",
                detail: error.detail,
              },
            }),
          ),
        );
        return;
      case "session.task_complete":
        if (event.data.summary) {
          yield* emit({
            ...eventBase(context, event),
            type: "tool.summary",
            payload: { summary: boundedText(event.data.summary) ?? event.data.summary },
          });
        }
        return;
      case "hook.start":
        yield* emit({
          ...eventBase(context, event),
          type: "hook.started",
          payload: {
            hookId: event.data.hookInvocationId,
            hookName: event.data.hookType,
            hookEvent: event.data.hookType,
          },
        });
        return;
      case "hook.progress":
        yield* emit({
          ...eventBase(context, event),
          type: "hook.progress",
          payload: {
            hookId: event.data.hookInvocationId,
            output: boundedText(event.data.message),
          },
        });
        return;
      case "hook.end":
        yield* emit({
          ...eventBase(context, event),
          type: "hook.completed",
          payload: {
            hookId: event.data.hookInvocationId,
            outcome: event.data.success ? "success" : "error",
            ...(event.data.error?.message ? { output: boundedText(event.data.error.message) } : {}),
          },
        });
        return;
      case "command.queued":
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.requestId }),
          type: "item.started",
          payload: {
            itemType: "dynamic_tool_call",
            status: "inProgress",
            title: "Copilot command",
            detail: boundedText(event.data.command),
          },
        });
        const sdkSession = context.sdkSession;
        if (!sdkSession) return;
        yield* runSdkRequest("commands.respondToQueuedCommand", () =>
          sdkSession.rpc.commands.respondToQueuedCommand({
            requestId: event.data.requestId,
            result: { handled: false },
          }),
        );
        return;
      case "command.execute":
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.requestId }),
          type: "item.started",
          payload: {
            itemType: "dynamic_tool_call",
            status: "inProgress",
            title: `/${event.data.commandName}`,
            detail: boundedText(event.data.args),
          },
        });
        return;
      case "command.completed":
        yield* emit({
          ...eventBase(context, event, { itemId: event.data.requestId }),
          type: "item.completed",
          payload: {
            itemType: "dynamic_tool_call",
            status: "completed",
            title: "Copilot command",
          },
        });
        return;
      case "session.skills_loaded":
        yield* publishSkills(context, event.data.skills);
        return;
      case "session.mcp_servers_loaded":
      case "session.mcp_server_status_changed":
        yield* emit({
          ...eventBase(context, event),
          type: "mcp.status.updated",
          payload: { status: event.data },
        });
        return;
      case "mcp.oauth_completed":
        yield* emit({
          ...eventBase(context, event),
          type: "mcp.oauth.completed",
          payload: { success: event.data.outcome === "token" },
        });
        return;
      case "session.warning":
        yield* emit({
          ...eventBase(context, event),
          type: "runtime.warning",
          payload: { message: event.data.message },
        });
        return;
      case "session.binary_asset":
        if (!context.omittedBinaryAssetWarningEmitted) {
          context.omittedBinaryAssetWarningEmitted = true;
          yield* emit({
            ...eventBase(context, event),
            type: "runtime.warning",
            payload: {
              message:
                "Copilot binary tool results are retained by the native session but are not rendered in T3 Code yet.",
              detail: {
                assetId: event.data.assetId,
                byteLength: event.data.byteLength,
                mimeType: event.data.mimeType,
              },
            },
          });
        }
        return;
      case "session.start":
      case "session.resume":
      case "assistant.turn_start":
      case "assistant.turn_retry":
      case "assistant.idle":
      case "assistant.streaming_delta":
      case "assistant.tool_call_delta":
      case "permission.requested":
      case "permission.completed":
      case "user_input.requested":
      case "user_input.completed":
      case "exit_plan_mode.requested":
      case "exit_plan_mode.completed":
        return;
      default:
        yield* Effect.logDebug("Unhandled GitHub Copilot SDK event.", {
          eventType: event.type,
        });
    }
  });

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
      forkLogged(
        syntheticBase(context, "permission.requested", requestArgs(request), {
          requestId,
        }).pipe(
          Effect.flatMap((base) =>
            emit({
              ...base,
              type: "request.opened",
              payload: {
                requestType: requestType(request),
                detail: boundedText(requestDetail(request)),
                options: approvalOptions(request),
                args: requestArgs(request),
              },
            }),
          ),
        ),
      );
    });
  };

  const handleUserInput = (
    context: CopilotSessionContext,
    request: CopilotUserInputRequest,
  ): Promise<CopilotUserInputResponse> =>
    new Promise((resolve) => {
      const requestId = ApprovalRequestId.make(NodeCrypto.randomUUID());
      const choices = request.choices ?? [];
      context.pendingUserInputs.set(requestId, {
        choices,
        turnId: context.activeTurnId,
        resolve,
      });
      forkLogged(
        Effect.gen(function* () {
          const choiceOptions =
            choices.length > 0
              ? choices.map((choice) => ({ label: choice, description: choice }))
              : [
                  {
                    label: "Respond",
                    description: "Type your response in the composer.",
                  },
                ];
          yield* emit({
            ...(yield* syntheticBase(
              context,
              "user_input.requested",
              { question: request.question, choices },
              { requestId },
            )),
            type: "user-input.requested",
            payload: {
              questions: [
                {
                  id: USER_INPUT_ID,
                  header: "Question",
                  question: request.question,
                  options: choiceOptions,
                },
              ],
            },
          });
        }),
      );
    });

  const handleExitPlanMode = (context: CopilotSessionContext, request: CopilotExitPlanRequest) => {
    forkLogged(
      emitPlan(
        context,
        request.planContent ?? request.summary,
        "exit_plan_mode.requested",
        request,
      ),
    );
    return Promise.resolve({ approved: false });
  };

  const finalizeContextState = Effect.fn("CopilotAdapter.finalizeContextState")(function* (
    context: CopilotSessionContext,
  ) {
    if (context.stopped) return;
    context.stopped = true;
    sessions.delete(context.session.threadId);
    context.activeTurnId = undefined;
    context.activeTurnCompleted = true;
    context.tools.clear();
    for (const pending of context.pendingApprovals.values()) {
      pending.resolve({ kind: "user-not-available" });
    }
    for (const pending of context.pendingUserInputs.values()) {
      pending.resolve({ answer: "", wasFreeform: true });
    }
    context.pendingApprovals.clear();
    context.pendingUserInputs.clear();
    if (options.onSessionClosed) {
      yield* options.onSessionClosed(context.session.threadId);
    }
    yield* updateSession(context, { status: "closed" }, "activeTurnId");
  });

  const emitContextExited = Effect.fn("CopilotAdapter.emitContextExited")(function* (
    context: CopilotSessionContext,
    input: {
      readonly event?: SessionEvent;
      readonly sessionId?: string;
      readonly reason: string;
      readonly exitKind: "graceful" | "error";
      readonly recoverable?: boolean;
    },
  ) {
    if (context.exitEmitted) return;
    context.exitEmitted = true;
    const base = input.event
      ? eventBase(context, input.event)
      : yield* syntheticBase(context, "session.stopped", {
          sessionId: input.sessionId,
        });
    yield* emit({
      ...base,
      type: "session.exited",
      payload: {
        exitKind: input.exitKind,
        reason: input.reason,
        ...(input.recoverable !== undefined ? { recoverable: input.recoverable } : {}),
      },
    });
  });

  const closeContextSerialized = Effect.fn("CopilotAdapter.closeContextSerialized")(function* (
    context: CopilotSessionContext,
    input: {
      readonly disconnect: boolean;
      readonly event?: SessionEvent;
      readonly reason: string;
      readonly exitKind: "graceful" | "error";
      readonly recoverable?: boolean;
    },
  ) {
    const sdkSession = context.sdkSession;
    yield* finalizeContextState(context);
    const disconnectExit =
      input.disconnect && sdkSession
        ? yield* runSdkRequest(
            "session.disconnect",
            () => sdkSession.disconnect(),
            deadlines.disconnectMs,
          ).pipe(Effect.exit)
        : Exit.void;
    context.sdkSession = undefined;
    yield* emitContextExited(context, {
      ...(input.event ? { event: input.event } : {}),
      ...(sdkSession ? { sessionId: sdkSession.sessionId } : {}),
      reason: Exit.isFailure(disconnectExit)
        ? "Failed to disconnect the Copilot session."
        : input.reason,
      exitKind: Exit.isFailure(disconnectExit) ? "error" : input.exitKind,
      ...(Exit.isFailure(disconnectExit)
        ? { recoverable: true }
        : input.recoverable !== undefined
          ? { recoverable: input.recoverable }
          : {}),
    });
    return disconnectExit;
  });

  const forceStopAndCloseSessions = Effect.fn("CopilotAdapter.forceStopAndCloseSessions")(
    function* (reason: string, initiatingContext?: CopilotSessionContext) {
      const contexts = new Set<CopilotSessionContext>(sessions.values());
      if (initiatingContext) contexts.add(initiatingContext);
      for (const context of contexts) {
        yield* finalizeContextState(context);
        context.sdkSession = undefined;
      }
      yield* forceStopClient(reason);
      for (const context of contexts) {
        yield* emitContextExited(context, {
          reason,
          exitKind: "error",
          recoverable: true,
        });
      }
    },
  );

  const stopContext = Effect.fn("CopilotAdapter.stopContext")(function* (
    context: CopilotSessionContext,
  ) {
    const closeResult = yield* context.eventSemaphore
      .withPermit(
        closeContextSerialized(context, {
          disconnect: true,
          reason: "Session stopped",
          exitKind: "graceful",
        }),
      )
      .pipe(Effect.timeoutOption(deadlines.eventDrainMs));
    if (Option.isNone(closeResult)) {
      const detail = `Timed out draining Copilot session events after ${deadlines.eventDrainMs}ms.`;
      yield* forceStopAndCloseSessions(detail, context);
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "session.stop",
        detail,
      });
    }
    if (Exit.isFailure(closeResult.value)) {
      yield* forceStopAndCloseSessions(
        "Copilot session disconnect failed; the shared client was force-stopped.",
        context,
      );
      return yield* Effect.failCause(closeResult.value.cause);
    }
  });

  const startSession: ProviderAdapterShape<CopilotAdapterError>["startSession"] = (input) =>
    withThreadLock(
      input.threadId,
      Effect.gen(function* () {
        if (
          input.provider !== undefined &&
          input.provider !== PROVIDER &&
          input.provider !== LEGACY_PROVIDER
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
          });
        }
        if (input.providerInstanceId && input.providerInstanceId !== boundInstanceId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Provider instance '${input.providerInstanceId}' does not match '${boundInstanceId}'.`,
          });
        }
        const existing = sessions.get(input.threadId);
        if (existing && !existing.stopped) {
          yield* stopContext(existing);
        }

        const cwd = input.cwd?.trim() || serverConfig.cwd;
        const modelSelection =
          input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
        if (input.modelSelection && !modelSelection) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Model selection targets '${input.modelSelection.instanceId}', not '${boundInstanceId}'.`,
          });
        }
        const effortValue = getModelSelectionStringOptionValue(modelSelection, "reasoningEffort");
        const reasoningEffort = copilotReasoningEffort(effortValue);
        if (effortValue && !reasoningEffort) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Unsupported Copilot reasoning effort '${effortValue}'.`,
          });
        }
        const createdAt = yield* nowIso;
        const eventSemaphore = yield* Semaphore.make(1);
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
          tools: new Map(),
          tasks: new Map(),
          taskIdByToolCallId: new Map(),
          terminalTaskIds: new Set(),
          seenEventIds: new Set(),
          eventSemaphore,
          activeTurnId: undefined,
          activeTurnCompleted: false,
          lastPlanMarkdown: undefined,
          turnUsage: undefined,
          omittedBinaryAssetWarningEmitted: false,
          resumeAlreadyInUse: false,
          exitEmitted: false,
          stopped: false,
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

        const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
        const config: SessionConfig = {
          clientName: "t3-code",
          workingDirectory: cwd,
          streaming: true,
          enableConfigDiscovery: settings.enableConfigDiscovery,
          skipCustomInstructions: !settings.enableConfigDiscovery,
          enableSkills: true,
          configDirectory: clientConfiguration.effectiveHome,
          ...(modelSelection?.model ? { model: modelSelection.model } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(mcpSession
            ? {
                mcpServers: {
                  "t3-code": {
                    type: "http",
                    url: mcpSession.endpoint,
                    headers: { Authorization: mcpSession.authorizationHeader },
                  },
                },
              }
            : {}),
          onPermissionRequest: (request) => handlePermission(context, request),
          onUserInputRequest: (request) => handleUserInput(context, request),
          onExitPlanModeRequest: (request) => handleExitPlanMode(context, request),
          includeSubAgentStreamingEvents: false,
          onEvent: (event) => {
            if (event.type === "session.resume" && event.data.alreadyInUse === true) {
              context.resumeAlreadyInUse = true;
            }
            forkLogged(context.eventSemaphore.withPermit(handleEvent(context, event)));
          },
        };
        const previousSessionId = parseResumeCursor(input.resumeCursor);
        const sdkSession = yield* context.eventSemaphore.withPermit(
          Effect.gen(function* () {
            const createdSession = yield* Effect.tryPromise({
              try: () =>
                previousSessionId
                  ? client.resumeSession(previousSessionId, {
                      ...config,
                      continuePendingWork: false,
                    })
                  : client.createSession(config),
              catch: (cause) => toRequestError("session.start", cause),
            });
            if (previousSessionId && context.resumeAlreadyInUse) {
              context.stopped = true;
              const disconnectExit = yield* runSdkRequest(
                "session.disconnectAfterOwnershipConflict",
                () => createdSession.disconnect(),
                deadlines.disconnectMs,
              ).pipe(Effect.exit);
              if (Exit.isFailure(disconnectExit)) {
                yield* forceStopAndCloseSessions(
                  `Copilot session '${previousSessionId}' reported another active owner and the conflict cleanup did not finish.`,
                );
              }
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "startSession",
                issue: `Copilot session '${previousSessionId}' is already in use by another client.`,
              });
            }
            context.sdkSession = createdSession;
            context.session = {
              ...context.session,
              status: "ready",
              resumeCursor: resumeCursor(createdSession.sessionId),
              updatedAt: yield* nowIso,
            };
            sessions.set(input.threadId, context);
            yield* emit({
              ...(yield* syntheticBase(context, "session.started", {
                nativeSessionId: createdSession.sessionId,
                resumed: previousSessionId !== undefined,
              })),
              type: "session.started",
              payload: {
                message: "GitHub Copilot session ready",
                resume: context.session.resumeCursor,
              },
            });
            yield* emit({
              ...(yield* syntheticBase(context, "thread.started", {
                nativeSessionId: createdSession.sessionId,
              })),
              type: "thread.started",
              payload: { providerThreadId: createdSession.sessionId },
            });
            return createdSession;
          }),
        );

        yield* runSdkRequest("skills.list", () => sdkSession.rpc.skills.list()).pipe(
          Effect.flatMap((listed) => publishSkills(context, listed.skills)),
          Effect.catchTag("ProviderAdapterRequestError", (error) =>
            syntheticBase(context, "skills.list.failed", {
              detail: error.detail,
            }).pipe(
              Effect.flatMap((base) =>
                emit({
                  ...base,
                  type: "runtime.warning",
                  payload: {
                    message: "Copilot skill discovery failed.",
                    detail: error.detail,
                  },
                }),
              ),
            ),
          ),
        );
        return context.session;
      }),
    );

  const sendTurn: ProviderAdapterShape<CopilotAdapterError>["sendTurn"] = (input) =>
    withThreadLock(
      input.threadId,
      Effect.gen(function* () {
        const context = yield* requireContext(input.threadId);
        const sdkSession = context.sdkSession;
        if (!sdkSession) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId: input.threadId,
          });
        }
        if (context.activeTurnId && !context.activeTurnCompleted) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "A Copilot turn is already active for this thread.",
          });
        }
        const modelSelection =
          input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
        if (input.modelSelection && !modelSelection) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Model selection targets '${input.modelSelection.instanceId}', not '${boundInstanceId}'.`,
          });
        }
        const effortValue = getModelSelectionStringOptionValue(modelSelection, "reasoningEffort");
        const reasoningEffort = copilotReasoningEffort(effortValue);
        if (effortValue && !reasoningEffort) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Unsupported Copilot reasoning effort '${effortValue}'.`,
          });
        }
        if (modelSelection?.model) {
          yield* Effect.tryPromise({
            try: () =>
              sdkSession.setModel(
                modelSelection.model,
                reasoningEffort ? { reasoningEffort } : undefined,
              ),
            catch: (cause) => toRequestError("session.setModel", cause),
          });
        } else if (reasoningEffort) {
          yield* Effect.tryPromise({
            try: () => sdkSession.rpc.model.setReasoningEffort({ reasoningEffort }),
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

        const attachments: NonNullable<MessageOptions["attachments"]> = [];
        for (const attachment of input.attachments ?? []) {
          const path = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment,
          });
          if (!path) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: `Attachment '${attachment.name}' could not be resolved.`,
            });
          }
          attachments.push({ type: "file", path, displayName: attachment.name });
        }
        const prompt = input.input ?? (attachments.length > 0 ? "Review the attached file." : "");
        if (!prompt) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "A prompt or attachment is required.",
          });
        }

        const turnUuid = yield* randomUUID;
        const turnId = TurnId.make(`copilot-turn-${turnUuid}`);
        context.activeTurnId = turnId;
        context.activeTurnCompleted = false;
        context.lastPlanMarkdown = undefined;
        context.turnUsage = undefined;
        context.turns.push({ id: turnId, items: [] });
        yield* updateSession(context, {
          status: "running",
          activeTurnId: turnId,
          ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        });
        const startedAt = yield* nowIso;
        yield* emit({
          eventId: EventId.make(yield* randomUUID),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          createdAt: startedAt,
          turnId,
          type: "turn.started",
          payload: {
            ...(modelSelection?.model ? { model: modelSelection.model } : {}),
            ...(reasoningEffort ? { effort: reasoningEffort } : {}),
          },
          raw: {
            source: "copilot.sdk.synthetic",
            messageType: "session.send",
            payload: { submittedAt: startedAt },
          },
        });

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
            Effect.gen(function* () {
              context.activeTurnId = undefined;
              context.activeTurnCompleted = true;
              yield* updateSession(
                context,
                { status: "ready", lastError: error.detail },
                "activeTurnId",
              );
              yield* emit({
                eventId: EventId.make(yield* randomUUID),
                provider: PROVIDER,
                providerInstanceId: boundInstanceId,
                threadId: input.threadId,
                createdAt: yield* nowIso,
                turnId,
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
      }),
    );

  const interruptTurn: ProviderAdapterShape<CopilotAdapterError>["interruptTurn"] = (
    threadId,
    turnId,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireContext(threadId);
      const sdkSession = context.sdkSession;
      if (!sdkSession) return;
      yield* Effect.tryPromise({
        try: () => sdkSession.abort(),
        catch: (cause) => toRequestError("session.abort", cause),
      });
      const activeTurnId = turnId ?? context.activeTurnId;
      if (activeTurnId) {
        yield* emit({
          ...(yield* syntheticBase(
            context,
            "session.abort",
            { reason: "Interrupted by user" },
            { turnId: activeTurnId },
          )),
          type: "turn.aborted",
          payload: { reason: "Interrupted by user" },
        });
        context.activeTurnId = undefined;
        context.activeTurnCompleted = true;
        yield* updateSession(context, { status: "ready" }, "activeTurnId");
      }
    });

  const respondToRequest: ProviderAdapterShape<CopilotAdapterError>["respondToRequest"] = (
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
      if (!isApprovalDecisionSupported(pending.request, decision)) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "respondToRequest",
          issue: `Approval decision '${decision}' is not supported for this request.`,
        });
      }
      context.pendingApprovals.delete(requestId);
      pending.resolve(approvalResult(context, pending.request, decision));
      yield* emit({
        ...(yield* syntheticBase(
          context,
          "permission.resolved",
          { decision },
          {
            requestId,
            ...(pending.turnId ? { turnId: pending.turnId } : {}),
          },
        )),
        type: "request.resolved",
        payload: { requestType: requestType(pending.request), decision },
      });
    });

  const respondToUserInput: ProviderAdapterShape<CopilotAdapterError>["respondToUserInput"] = (
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
      pending.resolve({
        answer,
        wasFreeform: !pending.choices.includes(answer),
      });
      yield* emit({
        ...(yield* syntheticBase(
          context,
          "user_input.resolved",
          { answer },
          {
            requestId,
            ...(pending.turnId ? { turnId: pending.turnId } : {}),
          },
        )),
        type: "user-input.resolved",
        payload: { answers: answers as ProviderUserInputAnswers },
      });
    });

  const readThread: ProviderAdapterShape<CopilotAdapterError>["readThread"] = (threadId) =>
    requireContext(threadId).pipe(
      Effect.map(
        (context): ProviderThreadSnapshot => ({
          threadId,
          turns: context.turns,
        }),
      ),
    );

  const rollbackThread: ProviderAdapterShape<CopilotAdapterError>["rollbackThread"] = (
    threadId,
    numTurns,
  ) =>
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

  const stopSession: ProviderAdapterShape<CopilotAdapterError>["stopSession"] = (threadId) =>
    withThreadLock(
      threadId,
      Effect.gen(function* () {
        const context = yield* requireContext(threadId);
        yield* stopContext(context);
      }),
    );

  const stopAll = Effect.fn("CopilotAdapter.stopAll")(function* () {
    yield* Effect.forEach([...sessions.values()], stopContext, {
      concurrency: "unbounded",
      discard: true,
    });
  });

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* stopAll().pipe(Effect.ignoreCause({ log: true }));
      if (startPromise && !clientUnavailableReason) {
        const stopExit = yield* Effect.tryPromise({
          try: () => client.stop(),
          catch: (cause) => toRequestError("client.stop", cause),
        }).pipe(Effect.timeoutOption(deadlines.clientStopMs), Effect.exit);
        if (Exit.isFailure(stopExit)) {
          yield* forceStopAndCloseSessions(
            "GitHub Copilot client graceful cleanup failed during adapter teardown.",
          );
        } else if (Option.isNone(stopExit.value)) {
          yield* forceStopAndCloseSessions(
            `GitHub Copilot client cleanup timed out after ${deadlines.clientStopMs}ms.`,
          );
        } else if (stopExit.value.value.length > 0) {
          yield* Effect.logWarning("GitHub Copilot client cleanup reported errors.", {
            errors: stopExit.value.value.map((error) => error.message),
          });
          yield* forceStopAndCloseSessions(
            "GitHub Copilot client cleanup reported errors during adapter teardown.",
          );
        }
      }
      yield* PubSub.shutdown(runtimeEvents);
    }).pipe(Effect.ignoreCause({ log: true })),
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
    listSessions: () =>
      Effect.sync(() =>
        [...sessions.values()]
          .filter((context) => !context.stopped)
          .map((context) => context.session),
      ),
    hasSession: (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return context !== undefined && !context.stopped;
      }),
    readThread,
    rollbackThread,
    stopAll,
    get streamEvents() {
      return Stream.fromPubSub(runtimeEvents);
    },
  } satisfies ProviderAdapterShape<CopilotAdapterError>;
});
