import { ProviderDriverKind, ProviderInstanceId, ServerSettings } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { migrateLegacyCopilotSettings } from "../../serverSettings.ts";
import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";

const decodeSettings = Schema.decodeUnknownSync(ServerSettings);

describe("Copilot provider instance hydration", () => {
  it("synthesizes the canonical githubCopilot default for new settings", () => {
    const config = deriveProviderInstanceConfigMap(decodeSettings({}));
    const copilot = config[ProviderInstanceId.make("githubCopilot")];

    expect(copilot?.driver).toBe(ProviderDriverKind.make("githubCopilot"));
    expect(copilot?.config).toMatchObject({ enabled: false });
  });

  it("preserves legacy instance ids while canonicalizing their driver", () => {
    const migrated = migrateLegacyCopilotSettings(
      decodeSettings({
        providers: {
          copilot: {
            enabled: true,
            homePath: "~/.copilot-work",
          },
        },
      }),
    );
    const legacyId = ProviderInstanceId.make("copilot");

    expect(migrated.providerInstances[legacyId]).toMatchObject({
      driver: ProviderDriverKind.make("githubCopilot"),
      enabled: true,
      config: { homePath: "~/.copilot-work" },
    });

    const hydrated = deriveProviderInstanceConfigMap(migrated);
    expect(hydrated[legacyId]?.driver).toBe(ProviderDriverKind.make("githubCopilot"));
    expect(hydrated[ProviderInstanceId.make("githubCopilot")]).toBeUndefined();
  });

  it("canonicalizes explicit legacy driver envelopes without changing their ids or config", () => {
    const legacyId = ProviderInstanceId.make("copilot_work");
    const hydrated = deriveProviderInstanceConfigMap(
      decodeSettings({
        providerInstances: {
          copilot_work: {
            driver: "copilot",
            displayName: "Copilot Work",
            config: { homePath: "~/.copilot-work", forkOwned: true },
          },
        },
      }),
    );

    expect(hydrated[legacyId]).toEqual({
      driver: ProviderDriverKind.make("githubCopilot"),
      displayName: "Copilot Work",
      config: { homePath: "~/.copilot-work", forkOwned: true },
    });
  });
});
