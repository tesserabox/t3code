import {
  CopilotSettings,
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderSkill,
  type ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeCopilotTextGeneration } from "../../textGeneration/CopilotTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeCopilotAdapter } from "../Layers/CopilotAdapter.ts";
import {
  checkCopilotProviderStatus,
  makePendingCopilotProvider,
} from "../Layers/CopilotProvider.ts";
import {
  copilotContinuationGroupKey,
  resolveCopilotClientConfiguration,
} from "../Layers/copilotClientOptions.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const DRIVER_KIND = ProviderDriverKind.make("githubCopilot");
const decodeCopilotSettings = Schema.decodeSync(CopilotSettings);

export function mergeCopilotSessionSkills(
  skillsBySession: ReadonlyMap<ThreadId, ReadonlyArray<ServerProviderSkill>>,
): ReadonlyArray<ServerProviderSkill> {
  const byName = new Map<string, ServerProviderSkill>();
  for (const skills of skillsBySession.values()) {
    for (const skill of skills) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export type CopilotDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | Crypto.Crypto
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

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

export const CopilotDriver: ProviderDriver<CopilotSettings, CopilotDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "GitHub Copilot",
    supportsMultipleInstances: true,
  },
  configSchema: CopilotSettings,
  defaultConfig: (): CopilotSettings => decodeCopilotSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig;
      const serverSettings = yield* ServerSettingsService;
      const eventLoggers = yield* ProviderEventLoggers;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const effectiveConfig = { ...config, enabled } satisfies CopilotSettings;
      const fallbackContinuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const copilotClientConfiguration = resolveCopilotClientConfiguration({
        settings: effectiveConfig,
        cwd: serverConfig.cwd,
        environment: processEnv,
      });
      const continuationGroupKey = copilotContinuationGroupKey(
        copilotClientConfiguration.effectiveHome,
      );
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey,
      });
      const skillsBySessionRef = yield* Ref.make<
        ReadonlyMap<ThreadId, ReadonlyArray<ServerProviderSkill>>
      >(new Map());
      const skillsChanges = yield* Effect.acquireRelease(
        PubSub.unbounded<ReadonlyArray<ServerProviderSkill>>(),
        PubSub.shutdown,
      );
      const skillsSemaphore = yield* Semaphore.make(1);
      const publishSkills = (input: {
        readonly threadId: ThreadId;
        readonly skills: ReadonlyArray<ServerProviderSkill>;
      }) =>
        skillsSemaphore.withPermit(
          Ref.modify(skillsBySessionRef, (current) => {
            const next = new Map(current);
            next.delete(input.threadId);
            next.set(input.threadId, input.skills);
            return [mergeCopilotSessionSkills(next), next] as const;
          }).pipe(
            Effect.flatMap((skills) => PubSub.publish(skillsChanges, skills)),
            Effect.asVoid,
          ),
        );
      const removeSkills = (threadId: ThreadId) =>
        skillsSemaphore.withPermit(
          Ref.modify(skillsBySessionRef, (current) => {
            if (!current.has(threadId)) return [null, current] as const;
            const next = new Map(current);
            next.delete(threadId);
            return [mergeCopilotSessionSkills(next), next] as const;
          }).pipe(
            Effect.flatMap((skills) =>
              skills === null ? Effect.void : PubSub.publish(skillsChanges, skills),
            ),
            Effect.asVoid,
          ),
        );

      const adapter = yield* makeCopilotAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
        onSkillsChanged: publishSkills,
        onSessionClosed: removeSkills,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });
      const textGeneration = yield* makeCopilotTextGeneration(effectiveConfig, processEnv);
      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: DRIVER_KIND,
        packageName: "@github/copilot-sdk",
      });
      const checkProvider = Ref.get(skillsBySessionRef).pipe(
        Effect.flatMap((skillsBySession) =>
          checkCopilotProviderStatus(effectiveConfig, serverConfig.cwd, processEnv, {
            skills: mergeCopilotSessionSkills(skillsBySession),
          }),
        ),
        Effect.map(stampIdentity),
      );
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<CopilotSettings>>({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          Ref.get(skillsBySessionRef).pipe(
            Effect.flatMap((skillsBySession) =>
              makePendingCopilotProvider(
                settings.provider,
                mergeCopilotSessionSkills(skillsBySession),
              ),
            ),
            Effect.map(stampIdentity),
          ),
        checkProvider,
        enrichSnapshot: ({ snapshot: baseSnapshot, getSnapshot, publishSnapshot }) =>
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(skillsChanges);
              const initialSkills = yield* Ref.get(skillsBySessionRef);
              yield* publishSnapshot({
                ...baseSnapshot,
                skills: [...mergeCopilotSessionSkills(initialSkills)],
              });
              yield* Stream.fromSubscription(subscription).pipe(
                Stream.runForEach((skills) =>
                  getSnapshot.pipe(
                    Effect.flatMap((current) =>
                      publishSnapshot({
                        ...current,
                        skills: [...skills],
                      }),
                    ),
                  ),
                ),
              );
            }),
          ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build GitHub Copilot snapshot: ${cause.message ?? String(cause)}`,
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
