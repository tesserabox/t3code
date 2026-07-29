import type { CopilotSettings, ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { CopilotClient, ModelInfo } from "@github/copilot-sdk";
import * as Data from "effect/Data";
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

export interface CopilotProviderCheckOptions {
  readonly clientFactory?: () => Pick<
    CopilotClient,
    "start" | "stop" | "getStatus" | "getAuthStatus" | "listModels"
  >;
}

class CopilotProviderStatusError extends Data.TaggedError("CopilotProviderStatusError")<{
  readonly detail: string;
  readonly cause: unknown;
}> {}

export function copilotModelCapabilities(model: ModelInfo): ModelCapabilities {
  const efforts = model.supportedReasoningEfforts ?? [];
  return efforts.length === 0
    ? {}
    : {
        optionDescriptors: [
          buildSelectOptionDescriptor({
            id: "reasoningEffort",
            label: "Reasoning effort",
            options: efforts.map((effort) => ({
              value: effort,
              label:
                effort === "xhigh"
                  ? "Extra High"
                  : effort.charAt(0).toUpperCase() + effort.slice(1),
              isDefault: effort === model.defaultReasoningEffort,
            })),
          }),
        ],
      };
}

export function copilotModelsFromSdk(
  models: ReadonlyArray<ModelInfo>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  const available = models
    .filter((model) => model.policy?.state !== "disabled")
    .map(
      (model, index): ServerProviderModel => ({
        slug: model.id,
        name: model.name,
        isCustom: false,
        ...(index === 0 ? { isDefault: true } : {}),
        capabilities: copilotModelCapabilities(model),
      }),
    );
  return providerModelsFromSettings(available, customModels, {});
}

export const makePendingCopilotProvider = (
  settings: CopilotSettings,
): Effect.Effect<ServerProviderDraft> =>
  DateTime.now.pipe(
    Effect.map((now) =>
      buildServerProvider({
        presentation: COPILOT_PRESENTATION,
        enabled: settings.enabled,
        checkedAt: DateTime.formatIso(now),
        models: copilotModelsFromSdk([], settings.customModels),
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Checking GitHub Copilot availability...",
        },
      }),
    ),
  );

export const checkCopilotProviderStatus = Effect.fn("checkCopilotProviderStatus")(function* (
  settings: CopilotSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  options?: CopilotProviderCheckOptions,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) {
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: false,
      checkedAt,
      models: copilotModelsFromSdk([], settings.customModels),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "GitHub Copilot is disabled.",
      },
    });
  }

  const client =
    options?.clientFactory?.() ??
    createCopilotClient({
      settings,
      cwd,
      ...(environment ? { environment } : {}),
    });
  return yield* Effect.tryPromise({
    try: async () => {
      await client.start();
      try {
        const [status, auth] = await Promise.all([client.getStatus(), client.getAuthStatus()]);
        const models = auth.isAuthenticated ? await client.listModels() : [];
        return { status, auth, models };
      } finally {
        await client.stop();
      }
    },
    catch: (cause) =>
      new CopilotProviderStatusError({
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  }).pipe(
    Effect.map(({ auth, models, status }) =>
      buildServerProvider({
        presentation: COPILOT_PRESENTATION,
        enabled: true,
        checkedAt,
        models: copilotModelsFromSdk(models, settings.customModels),
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
          probe: {
            installed: false,
            version: null,
            status: "error",
            auth: { status: "unknown" },
            message: `Unable to start the bundled Copilot CLI: ${error.detail}`,
          },
        }),
      ),
    ),
  );
});
