/**
 * CopilotDriver — `ProviderDriver` for the GitHub Copilot SDK runtime.
 *
 * Follows the same pattern as ClaudeDriver: a plain value whose `create()`
 * returns one `ProviderInstance` bundling `snapshot` / `adapter` /
 * `textGeneration` closures captured over the per-instance `CopilotSettings`.
 *
 * @module CopilotDriver
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  CopilotSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeCopilotTextGeneration } from "../../textGeneration/CopilotTextGeneration.ts";
import { makeCopilotAdapter, type CopilotAdapterLiveOptions } from "../Layers/CopilotAdapter.ts";
import { checkCopilotProviderStatus } from "../Layers/CopilotProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import { ProviderDriverError } from "../Errors.ts";
import {
  type ProviderDriver,
  type ProviderInstance,
  defaultProviderContinuationIdentity,
} from "../ProviderDriver.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { buildServerProvider } from "../providerSnapshot.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";

const DRIVER_KIND = ProviderDriverKind.make("copilot");
const SNAPSHOT_REFRESH_INTERVAL = "120 seconds";

const COPILOT_PRESENTATION = {
  displayName: "GitHub Copilot",
} as const;

const makePendingCopilotProvider = (): ServerProviderDraft =>
  buildServerProvider({
    presentation: COPILOT_PRESENTATION,
    enabled: false,
    checkedAt: DateTime.formatIso(DateTime.nowUnsafe()),
    models: [],
    probe: {
      installed: false,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: "Checking GitHub Copilot availability...",
    },
  });

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export type CopilotDriverEnv = ServerConfig | ServerSettingsService | ProviderEventLoggers;

export const CopilotDriver: ProviderDriver<CopilotSettings, CopilotDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "GitHub Copilot",
    supportsMultipleInstances: false,
  },
  configSchema: CopilotSettings,
  defaultConfig: (): CopilotSettings => Schema.decodeSync(CopilotSettings)({}),
  create: ({ instanceId, displayName, accentColor, enabled, config }) =>
    Effect.gen(function* () {
      const eventLoggers = yield* ProviderEventLoggers;
      const fallbackContinuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const effectiveConfig = { ...config, enabled } satisfies CopilotSettings;
      const continuationGroupKey = `copilot:${instanceId}`;
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey,
      });

      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: DRIVER_KIND,
        packageName: "@github/copilot-sdk",
      });

      const adapterOptions: CopilotAdapterLiveOptions = {
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      };
      const adapter = yield* makeCopilotAdapter(adapterOptions);
      const textGeneration = yield* makeCopilotTextGeneration;

      const checkProvider = checkCopilotProviderStatus(effectiveConfig).pipe(
        Effect.map(stampIdentity),
      );

      const snapshot = yield* makeManagedServerProvider<CopilotSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: () => Effect.succeed(stampIdentity(makePendingCopilotProvider())),
        checkProvider,
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Copilot snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity: {
          ...fallbackContinuationIdentity,
          continuationKey: continuationGroupKey,
        },
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
