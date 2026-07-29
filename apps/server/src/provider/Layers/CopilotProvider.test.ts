import type { ModelInfo } from "@github/copilot-sdk";
import { CopilotSettings } from "@t3tools/contracts";
import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { checkCopilotProviderStatus, copilotModelsFromSdk } from "./CopilotProvider.ts";

const decodeSettings = Schema.decodeSync(CopilotSettings);
const model = (input: Partial<ModelInfo> & Pick<ModelInfo, "id" | "name">): ModelInfo => ({
  capabilities: {
    supports: { vision: false, reasoningEffort: true },
    limits: { max_context_window_tokens: 128_000 },
  },
  ...input,
});

describe("CopilotProvider", () => {
  it("maps runtime models and their supported reasoning effort options", () => {
    const models = copilotModelsFromSdk(
      [
        model({
          id: "gpt-test",
          name: "GPT Test",
          supportedReasoningEfforts: ["low", "high"],
          defaultReasoningEffort: "high",
        }),
        model({
          id: "disabled",
          name: "Disabled",
          policy: { state: "disabled", terms: "" },
        }),
      ],
      ["custom-model"],
    );

    NodeAssert.deepEqual(
      models.map((entry) => entry.slug),
      ["gpt-test", "custom-model"],
    );
    NodeAssert.equal(models[0]?.capabilities?.optionDescriptors?.[0]?.id, "reasoningEffort");
  });

  it.effect("reports SDK status, authentication, version, and models", () =>
    Effect.gen(function* () {
      let stopped = false;
      const snapshot = yield* checkCopilotProviderStatus(
        decodeSettings({}),
        "/workspace/project",
        undefined,
        {
          clientFactory: () => ({
            start: async () => {},
            stop: async () => {
              stopped = true;
              return [];
            },
            getStatus: async () => ({ version: "1.0.75", protocolVersion: 1 }),
            getAuthStatus: async () => ({
              isAuthenticated: true,
              authType: "gh-cli",
              login: "octocat",
            }),
            listModels: async () => [model({ id: "gpt-test", name: "GPT Test" })],
          }),
        },
      );

      NodeAssert.ok(stopped);
      NodeAssert.equal(snapshot.status, "ready");
      NodeAssert.equal(snapshot.version, "1.0.75");
      NodeAssert.equal(snapshot.auth.label, "octocat");
      NodeAssert.equal(snapshot.models[0]?.slug, "gpt-test");
    }),
  );
});
import * as NodeAssert from "node:assert/strict";
