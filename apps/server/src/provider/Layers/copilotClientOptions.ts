// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { CopilotClient, RuntimeConnection, type CopilotClientOptions } from "@github/copilot-sdk";
import type { CopilotSettings } from "@t3tools/contracts";

const DEFAULT_COMMAND_PATTERN = /^copilot(?:\.(?:exe|cmd|bat))?$/i;

export function normalizeCopilotCliPathOverride(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || DEFAULT_COMMAND_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function expandCopilotHomePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "~") {
    return NodeOS.homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return NodePath.join(NodeOS.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function makeCopilotClientOptions(input: {
  readonly settings: CopilotSettings;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
}): CopilotClientOptions {
  const cliPath = normalizeCopilotCliPathOverride(input.settings.binaryPath);
  const baseDirectory = expandCopilotHomePath(input.settings.homePath);
  return {
    mode: "copilot-cli",
    workingDirectory: input.cwd,
    logLevel: "error",
    ...(input.environment ? { env: input.environment } : {}),
    ...(baseDirectory ? { baseDirectory } : {}),
    ...(cliPath ? { connection: RuntimeConnection.forStdio({ path: cliPath }) } : {}),
  };
}

export function createCopilotClient(input: {
  readonly settings: CopilotSettings;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
}): CopilotClient {
  return new CopilotClient(makeCopilotClientOptions(input));
}
