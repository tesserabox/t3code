import * as NodeAssert from "node:assert/strict";

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
  it("maps runtime models, policy state, duplicates, and reasoning options", () => {
    const models = copilotModelsFromSdk(
      [
        model({
          id: "gpt-test",
          name: "GPT Test",
          supportedReasoningEfforts: ["low", "high"],
          defaultReasoningEffort: "high",
        }),
        model({ id: "gpt-test", name: "Duplicate" }),
        model({
          id: "disabled",
          name: "Disabled",
          policy: { state: "disabled", terms: "" },
        }),
      ],
      ["custom-model", "gpt-test"],
    );

    NodeAssert.deepEqual(
      models.map((entry) => entry.slug),
      ["gpt-test", "custom-model"],
    );
    NodeAssert.equal(models[0]?.isDefault, true);
    NodeAssert.deepEqual(models[0]?.capabilities?.optionDescriptors?.[0], {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High", isDefault: true },
      ],
      currentValue: "high",
    });
  });

  it.effect("reports SDK status, authentication, version, models, and cleanup", () =>
    Effect.gen(function* () {
      let stopped = false;
      const snapshot = yield* checkCopilotProviderStatus(
        decodeSettings({ enabled: true }),
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

      NodeAssert.equal(stopped, true);
      NodeAssert.equal(snapshot.status, "ready");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.version, "1.0.75");
      NodeAssert.equal(snapshot.auth.label, "octocat");
      NodeAssert.equal(snapshot.models[0]?.slug, "gpt-test");
    }),
  );

  it.effect("preserves the primary status failure when cleanup also fails", () =>
    Effect.gen(function* () {
      let stops = 0;
      const snapshot = yield* checkCopilotProviderStatus(
        decodeSettings({ enabled: true }),
        "/workspace/project",
        undefined,
        {
          clientFactory: () => ({
            start: async () => {},
            stop: async () => {
              stops += 1;
              throw new Error("stop failed");
            },
            getStatus: async () => {
              throw new Error("status failed");
            },
            getAuthStatus: async () => ({
              isAuthenticated: true,
              authType: "gh-cli",
            }),
            listModels: async () => [],
          }),
        },
      );

      NodeAssert.equal(stops, 1);
      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.match(snapshot.message ?? "", /status failed/u);
      NodeAssert.doesNotMatch(snapshot.message ?? "", /stop failed/u);
    }),
  );

  it.effect("reports cleanup failure when the status probe otherwise succeeds", () =>
    Effect.gen(function* () {
      let stops = 0;
      const snapshot = yield* checkCopilotProviderStatus(
        decodeSettings({ enabled: true }),
        "/workspace/project",
        undefined,
        {
          clientFactory: () => ({
            start: async () => {},
            stop: async () => {
              stops += 1;
              return [new Error("first stop failure"), new Error("second stop failure")];
            },
            getStatus: async () => ({ version: "1.0.75", protocolVersion: 1 }),
            getAuthStatus: async () => ({
              isAuthenticated: true,
              authType: "gh-cli",
            }),
            listModels: async () => [model({ id: "gpt-test", name: "GPT Test" })],
          }),
        },
      );

      NodeAssert.equal(stops, 1);
      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.match(snapshot.message ?? "", /first stop failure; second stop failure/u);
    }),
  );

  it.effect("distinguishes unauthenticated and startup failures", () =>
    Effect.gen(function* () {
      let missingStops = 0;
      const unauthenticated = yield* checkCopilotProviderStatus(
        decodeSettings({ enabled: true }),
        "/workspace/project",
        undefined,
        {
          clientFactory: () => ({
            start: async () => {},
            stop: async () => [],
            getStatus: async () => ({ version: "1.0.75", protocolVersion: 1 }),
            getAuthStatus: async () => ({
              isAuthenticated: false,
              statusMessage: "Sign in required",
            }),
            listModels: async () => {
              throw new Error("must not list models while signed out");
            },
          }),
        },
      );
      const missing = yield* checkCopilotProviderStatus(
        decodeSettings({ enabled: true }),
        "/workspace/project",
        undefined,
        {
          clientFactory: () => ({
            start: async () => {
              throw new Error("ENOENT");
            },
            stop: async () => {
              missingStops += 1;
              return [];
            },
            getStatus: async () => ({ version: "1.0.75", protocolVersion: 1 }),
            getAuthStatus: async () => ({ isAuthenticated: false }),
            listModels: async () => [],
          }),
        },
      );

      NodeAssert.equal(unauthenticated.installed, true);
      NodeAssert.equal(unauthenticated.auth.status, "unauthenticated");
      NodeAssert.equal(unauthenticated.message, "Sign in required");
      NodeAssert.equal(missing.installed, false);
      NodeAssert.match(missing.message ?? "", /ENOENT/u);
      NodeAssert.equal(missingStops, 1);
    }),
  );
});
