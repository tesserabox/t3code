// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { CopilotClient, RuntimeConnection, type CopilotClientOptions } from "@github/copilot-sdk";
import type { CopilotSettings } from "@t3tools/contracts";

const DEFAULT_COMMAND_PATTERN = /^copilot(?:\.(?:exe|cmd|bat))?$/i;
const ASAR_PATH_SEGMENT_PATTERN = /([\\/][^\\/]+\.asar)(?=[\\/])/u;

export interface CopilotHostRuntime {
  readonly isElectron: boolean;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly resolvePackage: (packageName: string) => string;
  readonly pathExists: (path: string) => boolean;
}

function liveCopilotHostRuntime(): CopilotHostRuntime {
  const requireFromServer = NodeModule.createRequire(import.meta.url);
  const requireFromSdk = NodeModule.createRequire(requireFromServer.resolve("@github/copilot-sdk"));
  return {
    isElectron: typeof process.versions.electron === "string",
    // oxlint-disable-next-line t3code/no-global-process-runtime -- SDK options are synchronous and this descriptor is injectable in tests.
    platform: NodeOS.platform(),
    // oxlint-disable-next-line t3code/no-global-process-runtime -- SDK options are synchronous and this descriptor is injectable in tests.
    architecture: NodeOS.arch(),
    resolvePackage: (packageName) => requireFromSdk.resolve(packageName),
    pathExists: NodeFS.existsSync,
  };
}

function copilotPlatformPackageNames(
  platform: NodeJS.Platform,
  architecture: string,
): ReadonlyArray<string> {
  if (architecture !== "arm64" && architecture !== "x64") {
    throw new Error(`Unsupported GitHub Copilot desktop architecture: ${architecture}`);
  }
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    throw new Error(`Unsupported GitHub Copilot desktop platform: ${platform}`);
  }
  const variants = platform === "linux" ? ["linux", "linuxmusl"] : [platform];
  return variants.map((variant) => `@github/copilot-${variant}-${architecture}`);
}

export function resolveElectronUnpackedPath(path: string): string {
  return path.replace(ASAR_PATH_SEGMENT_PATTERN, "$1.unpacked");
}

export function resolveElectronCopilotCliPath(runtime: CopilotHostRuntime): string | undefined {
  if (!runtime.isElectron) {
    return undefined;
  }

  const failures: string[] = [];
  for (const packageName of copilotPlatformPackageNames(runtime.platform, runtime.architecture)) {
    let resolvedPath: string;
    try {
      resolvedPath = runtime.resolvePackage(packageName);
    } catch (cause) {
      failures.push(`${packageName}: ${cause instanceof Error ? cause.message : String(cause)}`);
      continue;
    }

    const executablePath = resolveElectronUnpackedPath(resolvedPath);
    if (runtime.pathExists(executablePath)) {
      return executablePath;
    }
    failures.push(`${packageName}: executable not found at ${executablePath}`);
  }

  throw new Error(
    `Could not resolve the bundled GitHub Copilot executable for Electron. ${failures.join("; ")}`,
  );
}

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

export interface ResolvedCopilotClientConfiguration {
  readonly options: CopilotClientOptions;
  readonly effectiveHome: string;
}

export function resolveCopilotClientConfiguration(
  input: {
    readonly settings: CopilotSettings;
    readonly cwd: string;
    readonly environment?: NodeJS.ProcessEnv;
  },
  runtime: CopilotHostRuntime = liveCopilotHostRuntime(),
): ResolvedCopilotClientConfiguration {
  const configuredCliPath = normalizeCopilotCliPathOverride(input.settings.binaryPath);
  const environmentCliPath = input.environment?.COPILOT_CLI_PATH?.trim();
  const defaultConnection = input.environment?.COPILOT_SDK_DEFAULT_CONNECTION?.trim().toLowerCase();
  const bundledElectronCliPath =
    !configuredCliPath &&
    !environmentCliPath &&
    (defaultConnection === undefined || defaultConnection === "" || defaultConnection === "stdio")
      ? resolveElectronCopilotCliPath(runtime)
      : undefined;
  const cliPath = configuredCliPath ?? bundledElectronCliPath;
  const configuredHome = input.settings.homePath.trim();
  const environmentHome = input.environment?.COPILOT_HOME?.trim() ?? "";
  const homeCandidate =
    configuredHome || environmentHome || NodePath.join(NodeOS.homedir(), ".copilot");
  const effectiveHome = NodePath.resolve(expandCopilotHomePath(homeCandidate) ?? homeCandidate);
  return {
    effectiveHome,
    options: {
      mode: "copilot-cli",
      workingDirectory: input.cwd,
      logLevel: "error",
      ...(input.environment ? { env: input.environment } : {}),
      baseDirectory: effectiveHome,
      ...(cliPath ? { connection: RuntimeConnection.forStdio({ path: cliPath }) } : {}),
    },
  };
}

export function copilotContinuationGroupKey(effectiveHome: string): string {
  return `githubCopilot:home:${effectiveHome}`;
}

export function makeCopilotClientOptions(
  input: {
    readonly settings: CopilotSettings;
    readonly cwd: string;
    readonly environment?: NodeJS.ProcessEnv;
  },
  runtime?: CopilotHostRuntime,
): CopilotClientOptions {
  return resolveCopilotClientConfiguration(input, runtime).options;
}

export function createCopilotClient(input: {
  readonly settings: CopilotSettings;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
}): CopilotClient {
  return new CopilotClient(makeCopilotClientOptions(input));
}
