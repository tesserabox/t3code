import type { CopilotClient, ModelInfo } from "@github/copilot-sdk";
import {
  type CopilotSettings,
  type ModelCapabilities,
  type ServerProviderModel,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { createCopilotClient } from "./copilotClientOptions.ts";

const COPILOT_PRESENTATION = {
  displayName: "GitHub Copilot",
  badgeLabel: "Preview",
  showInteractionModeToggle: true,
} as const;
const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });

type CopilotProviderClient = Pick<
  CopilotClient,
  "start" | "stop" | "getStatus" | "getAuthStatus" | "listModels"
>;

export interface CopilotProviderCheckOptions {
  readonly clientFactory?: () => CopilotProviderClient;
  readonly skills?: ReadonlyArray<ServerProviderSkill>;
}

class CopilotProviderStatusError extends Data.TaggedError("CopilotProviderStatusError")<{
  readonly detail: string;
  readonly started: boolean;
  readonly cause: unknown;
}> {}

function reasoningEffortLabel(effort: string): string {
  if (effort === "xhigh") return "Extra High";
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function copilotModelCapabilities(model: ModelInfo): ModelCapabilities {
  const efforts = model.supportedReasoningEfforts ?? [];
  return createModelCapabilities({
    optionDescriptors:
      efforts.length === 0
        ? []
        : [
            buildSelectOptionDescriptor({
              id: "reasoningEffort",
              label: "Reasoning",
              options: efforts.map((effort) => ({
                value: effort,
                label: reasoningEffortLabel(effort),
                isDefault: effort === model.defaultReasoningEffort,
              })),
            }),
          ],
  });
}

export function copilotModelsFromSdk(
  models: ReadonlyArray<ModelInfo>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  const available: ServerProviderModel[] = [];
  for (const model of models) {
    const slug = model.id.trim();
    const name = model.name.trim();
    if (!slug || !name || seen.has(slug) || model.policy?.state === "disabled") {
      continue;
    }
    seen.add(slug);
    available.push({
      slug,
      name,
      isCustom: false,
      ...(available.length === 0 ? { isDefault: true } : {}),
      capabilities: copilotModelCapabilities(model),
    });
  }
  return providerModelsFromSettings(available, customModels, EMPTY_CAPABILITIES);
}

export const makePendingCopilotProvider = (
  settings: CopilotSettings,
  skills: ReadonlyArray<ServerProviderSkill> = [],
): Effect.Effect<ServerProviderDraft> =>
  DateTime.now.pipe(
    Effect.map((now) =>
      buildServerProvider({
        presentation: COPILOT_PRESENTATION,
        enabled: settings.enabled,
        checkedAt: DateTime.formatIso(now),
        models: copilotModelsFromSdk([], settings.customModels),
        skills,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: settings.enabled
            ? "Checking GitHub Copilot availability..."
            : "GitHub Copilot is disabled in T3 Code settings.",
        },
      }),
    ),
  );

export const checkCopilotProviderStatus = Effect.fn("checkCopilotProviderStatus")(function* (
  settings: CopilotSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  options: CopilotProviderCheckOptions = {},
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const skills = options.skills ?? [];
  if (!settings.enabled) {
    return yield* makePendingCopilotProvider(settings, skills);
  }

  const client =
    options.clientFactory?.() ??
    createCopilotClient({
      settings,
      cwd,
      ...(environment ? { environment } : {}),
    });
  const lifecycle: {
    started: boolean;
    cleanupFailure: CopilotProviderStatusError | undefined;
  } = {
    started: false,
    cleanupFailure: undefined,
  };
  const probe = Effect.tryPromise({
    try: async () => {
      await client.start();
      lifecycle.started = true;
      const [status, auth] = await Promise.all([client.getStatus(), client.getAuthStatus()]);
      const models = auth.isAuthenticated ? await client.listModels() : [];
      return { status, auth, models };
    },
    catch: (cause) =>
      new CopilotProviderStatusError({
        detail: cause instanceof Error ? cause.message : String(cause),
        started: lifecycle.started,
        cause,
      }),
  });
  const cleanup = Effect.fn("checkCopilotProviderStatus.cleanup")(function* () {
    const stopResult = yield* Effect.tryPromise({
      try: () => client.stop(),
      catch: (cause) =>
        new CopilotProviderStatusError({
          detail: `GitHub Copilot SDK cleanup failed: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          started: lifecycle.started,
          cause,
        }),
    }).pipe(Effect.result);
    if (Result.isFailure(stopResult)) {
      lifecycle.cleanupFailure = stopResult.failure;
      return;
    }
    if (stopResult.success.length === 0) return;

    const cause = new AggregateError(stopResult.success, "GitHub Copilot SDK cleanup failed.");
    const details = stopResult.success
      .map((error) => error.message.trim())
      .filter((detail) => detail.length > 0)
      .join("; ");
    lifecycle.cleanupFailure = new CopilotProviderStatusError({
      detail:
        details.length > 0
          ? `GitHub Copilot SDK cleanup failed: ${details}`
          : "GitHub Copilot SDK cleanup failed.",
      started: lifecycle.started,
      cause,
    });
  });
  const statusCheck = Effect.gen(function* () {
    const probeResult = yield* Effect.acquireUseRelease(
      Effect.void,
      () => probe,
      () => cleanup(),
    ).pipe(Effect.result);
    if (Result.isFailure(probeResult)) {
      const primaryFailure = probeResult.failure;
      if (!lifecycle.cleanupFailure) return yield* primaryFailure;
      return yield* new CopilotProviderStatusError({
        detail: primaryFailure.detail,
        started: primaryFailure.started,
        cause: new AggregateError(
          [primaryFailure, lifecycle.cleanupFailure],
          "GitHub Copilot status check and cleanup both failed.",
          { cause: primaryFailure },
        ),
      });
    }
    if (lifecycle.cleanupFailure) return yield* lifecycle.cleanupFailure;
    return probeResult.success;
  });

  return yield* statusCheck.pipe(
    Effect.map(({ auth, models, status }) =>
      buildServerProvider({
        presentation: COPILOT_PRESENTATION,
        enabled: true,
        checkedAt,
        models: copilotModelsFromSdk(models, settings.customModels),
        skills,
        probe: {
          installed: true,
          version: status.version,
          status: auth.isAuthenticated ? "ready" : "error",
          auth: auth.isAuthenticated
            ? {
                status: "authenticated",
                ...(auth.authType ? { type: auth.authType } : {}),
                ...(auth.login ? { label: auth.login } : {}),
              }
            : { status: "unauthenticated" },
          ...(!auth.isAuthenticated
            ? {
                message:
                  auth.statusMessage ??
                  "GitHub Copilot is not authenticated. Run `copilot login` or authenticate with GitHub CLI.",
              }
            : {}),
        },
      }),
    ),
    Effect.catchTag("CopilotProviderStatusError", (error) =>
      Effect.succeed(
        buildServerProvider({
          presentation: COPILOT_PRESENTATION,
          enabled: true,
          checkedAt,
          models: copilotModelsFromSdk([], settings.customModels),
          skills,
          probe: {
            installed: error.started,
            version: null,
            status: "error",
            auth: { status: "unknown" },
            message: error.started
              ? `GitHub Copilot status check failed: ${error.detail}`
              : `Unable to start the bundled Copilot CLI: ${error.detail}`,
          },
        }),
      ),
    ),
  );
});
