import { CopilotClient, type SessionConfig } from "@github/copilot-sdk";
import { type CopilotSettings, type ModelSelection, TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { createCopilotClient } from "../provider/Layers/copilotClientOptions.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const GENERATION_TIMEOUT_MS = 180_000;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse((fenced ?? text).trim());
}

function generationError(operation: string, detail: string, cause?: unknown) {
  return new TextGenerationError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

export const makeCopilotTextGeneration = Effect.fn("makeCopilotTextGeneration")(function (
  settings: CopilotSettings,
  environment?: NodeJS.ProcessEnv,
) {
  const runGeneration = Effect.fn("CopilotTextGeneration.runGeneration")(function* <
    S extends Schema.Top,
  >(input: {
    readonly operation: string;
    readonly cwd: string;
    readonly prompt: string;
    readonly modelSelection: ModelSelection;
    readonly outputSchema: S;
  }) {
    const client: CopilotClient = createCopilotClient({
      settings,
      cwd: input.cwd,
      ...(environment ? { environment } : {}),
    });
    const response = yield* Effect.tryPromise({
      try: async () => {
        await client.start();
        try {
          const sessionConfig: SessionConfig = {
            clientName: "t3-code-text-generation",
            workingDirectory: input.cwd,
            model: input.modelSelection.model,
            streaming: false,
            enableConfigDiscovery: false,
            enableSkills: false,
            availableTools: [],
            infiniteSessions: { enabled: false },
            onPermissionRequest: () => ({ kind: "reject" }),
          };
          const session = await client.createSession(sessionConfig);
          try {
            return await session.sendAndWait(
              { prompt: input.prompt, mode: "immediate", agentMode: "interactive" },
              GENERATION_TIMEOUT_MS,
            );
          } finally {
            await session.disconnect();
          }
        } finally {
          await client.stop();
        }
      },
      catch: (cause) =>
        generationError(input.operation, "GitHub Copilot text generation failed.", cause),
    });
    if (!response?.data.content) {
      return yield* generationError(
        input.operation,
        "GitHub Copilot returned no text generation result.",
      );
    }
    const parsed = yield* Effect.try({
      try: () => extractJson(response.data.content),
      catch: (cause) =>
        generationError(input.operation, "GitHub Copilot returned invalid JSON.", cause),
    });
    // oxlint-disable-next-line t3code/no-inline-schema-compile -- The prompt builder supplies the operation-specific schema.
    return yield* Schema.decodeUnknownEffect(input.outputSchema)(parsed).pipe(
      Effect.mapError((cause) =>
        generationError(input.operation, "GitHub Copilot returned an invalid result.", cause),
      ),
    );
  });

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("CopilotTextGeneration.generateCommitMessage")(function* (input) {
      const built = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runGeneration({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt: built.prompt,
        modelSelection: input.modelSelection,
        outputSchema: built.outputSchema,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("CopilotTextGeneration.generatePrContent")(function* (input) {
      const built = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });
      const generated = yield* runGeneration({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt: built.prompt,
        modelSelection: input.modelSelection,
        outputSchema: built.outputSchema,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("CopilotTextGeneration.generateBranchName")(function* (input) {
      const built = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runGeneration({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt: built.prompt,
        modelSelection: input.modelSelection,
        outputSchema: built.outputSchema,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("CopilotTextGeneration.generateThreadTitle")(function* (input) {
      const built = buildThreadTitlePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runGeneration({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt: built.prompt,
        modelSelection: input.modelSelection,
        outputSchema: built.outputSchema,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });

  return Effect.succeed({
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"]);
});
