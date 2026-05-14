/**
 * CopilotTextGeneration – Text generation layer using the Copilot SDK.
 *
 * Implements the TextGenerationShape contract by creating a one-shot
 * Copilot SDK session, sending the prompt, collecting the response,
 * and parsing JSON output.
 *
 * @module CopilotTextGeneration
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { TextGenerationError } from "@t3tools/contracts";
import {
  type BranchNameGenerationInput,
  type TextGenerationShape,
  type ThreadTitleGenerationResult,
  TextGeneration,
} from "./TextGeneration.ts";
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
import { resolveBundledCopilotCliPath } from "../provider/Layers/copilotCliPath.ts";

function normalizeCliError(
  operation: string,
  cause: unknown,
  fallback: string,
): TextGenerationError {
  const detail = cause instanceof Error ? cause.message : fallback;
  return new TextGenerationError({ operation: `CopilotTextGeneration.${operation}`, detail });
}

function extractJsonFromResponse(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];
  return text.trim();
}

async function runCopilotGeneration(
  prompt: string,
  model: string | undefined,
  cliPath: string | undefined,
): Promise<string> {
  const { CopilotClient } = await import("@github/copilot-sdk");
  const clientOptions: Record<string, unknown> = { logLevel: "error" };
  if (cliPath) clientOptions.cliPath = cliPath;
  const client = new CopilotClient(clientOptions as any);
  await client.start();

  try {
    const session = await client.createSession({
      ...(model ? { model } : { model: undefined }),
      streaming: false,
    } as any);

    let response = "";
    session.on((event) => {
      if (event.type === "assistant.message") response += (event as any).data?.content ?? "";
      if (event.type === "assistant.message_delta") response += (event as any).data?.delta ?? "";
    });

    await session.send({ prompt, mode: "immediate" });
    await new Promise<void>((resolve) => {
      session.on((event) => {
        if (event.type === "session.idle" || event.type === "abort") {
          // @effect-diagnostics-next-line effect/globalTimers:off
          setTimeout(resolve, 500);
        }
      });
      // @effect-diagnostics-next-line effect/globalTimers:off
      setTimeout(resolve, 30000);
    });

    await session.destroy().catch(() => {});
    return response;
  } finally {
    await client.stop().catch(() => {});
  }
}

export const makeCopilotTextGeneration = Effect.gen(function* () {
    const cliPath = resolveBundledCopilotCliPath();

    const runGeneration = (
      operation: string,
      prompt: string,
      model: string | undefined,
    ): Effect.Effect<Record<string, unknown>, TextGenerationError> =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => runCopilotGeneration(prompt, model, cliPath),
          catch: (cause) => normalizeCliError(operation, cause, "Copilot generation failed"),
        });
        const jsonStr = extractJsonFromResponse(raw);
        const parsed = yield* Effect.try({
          try: () => JSON.parse(jsonStr) as Record<string, unknown>,
          catch: () =>
            new TextGenerationError({
              operation: `CopilotTextGeneration.${operation}`,
              detail: `Failed to parse JSON: ${raw.slice(0, 200)}`,
            }),
        });
        return parsed;
      });

    const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
      "CopilotTextGeneration.generateCommitMessage",
    )(function* (input) {
      const { prompt } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
      });
      const model = input.modelSelection?.model;
      const result = yield* runGeneration("generateCommitMessage", prompt, model);
      return {
        subject: sanitizeCommitSubject(String(result.subject ?? "")),
        body: typeof result.body === "string" ? result.body.trim() : "",
        ...(typeof result.branch === "string" ? { branch: result.branch } : {}),
      };
    });

    const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
      "CopilotTextGeneration.generatePrContent",
    )(function* (input) {
      const { prompt } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
      });
      const model = input.modelSelection?.model;
      const result = yield* runGeneration("generatePrContent", prompt, model);
      return {
        title: sanitizePrTitle(String(result.title ?? "")),
        body: typeof result.body === "string" ? result.body.trim() : "",
      };
    });

    const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
      "CopilotTextGeneration.generateBranchName",
    )(function* (input: BranchNameGenerationInput) {
      const { prompt } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const model = input.modelSelection?.model;
      const result = yield* runGeneration("generateBranchName", prompt, model);
      return { branch: String(result.branch ?? "") };
    });

    const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
      "CopilotTextGeneration.generateThreadTitle",
    )(function* (input) {
      const { prompt } = buildThreadTitlePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const model = input.modelSelection?.model;
      const result = yield* runGeneration("generateThreadTitle", prompt, model);
      return {
        title: sanitizeThreadTitle(String(result.title ?? "")),
      } satisfies ThreadTitleGenerationResult;
    });

    return {
      generateCommitMessage,
      generatePrContent,
      generateBranchName,
      generateThreadTitle,
    } satisfies TextGenerationShape;
  });

export const CopilotTextGenerationLive = Layer.effect(TextGeneration, makeCopilotTextGeneration);
