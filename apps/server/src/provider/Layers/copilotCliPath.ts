// @effect-diagnostics effect/nodeBuiltinImport:off
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const GITHUB_SCOPE_DIR = "@github";
const COPILOT_PATHLESS_COMMAND_PATTERN = /^copilot(?:\.(?:exe|cmd|bat))?$/i;
const COPILOT_NPM_LOADER = "npm-loader.js";

function dedupePaths(paths: ReadonlyArray<string | undefined>): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const candidate of paths) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    resolved.push(candidate);
  }

  return resolved;
}

function resolveRealPath(path: string | undefined): string | undefined {
  if (!path) return undefined;

  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function resolvePackageDirFromEntrypoint(
  entrypoint: string | undefined,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (!entrypoint) return undefined;

  let current = dirname(entrypoint);
  while (true) {
    const packageJsonPath = join(current, "package.json");
    if (exists(packageJsonPath) && isPackageRootPackageJson(packageJsonPath)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

function isPackageRootPackageJson(packageJsonPath: string): boolean {
  try {
    const raw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.length > 0;
  } catch {
    return true;
  }
}

function resolvePackageDir(specifier: string, issuer?: string): string | undefined {
  try {
    const packageRequire = issuer ? createRequire(issuer) : require;
    const resolvedEntrypoint = resolveRealPath(packageRequire.resolve(specifier));
    return resolvePackageDirFromEntrypoint(resolvedEntrypoint);
  } catch {
    return undefined;
  }
}

function resolveSdkPackageDir(): string | undefined {
  return resolvePackageDir("@github/copilot-sdk");
}

function resolveCopilotPackageDir(
  sdkPackageDir: string | undefined,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const sdkNodeModulesRoot = resolveNodeModulesRootFromPackageDir(sdkPackageDir);
  if (!sdkNodeModulesRoot) return undefined;

  const copilotPackageDir = join(sdkNodeModulesRoot, GITHUB_SCOPE_DIR, "copilot");
  if (!exists(copilotPackageDir)) {
    return undefined;
  }

  return resolveRealPath(copilotPackageDir);
}

function resolveProcessResourcesPath(): string | undefined {
  const processWithResourcesPath = process as NodeJS.Process & {
    readonly resourcesPath?: string;
  };
  return processWithResourcesPath.resourcesPath;
}

export function normalizeCopilotCliPathOverride(
  value: string | null | undefined,
): string | undefined {
  if (value == null) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (
    !trimmed.includes("/") &&
    !trimmed.includes("\\") &&
    COPILOT_PATHLESS_COMMAND_PATTERN.test(trimmed)
  ) {
    return undefined;
  }

  return trimmed;
}

function resolveGithubScopeDirFromPackageDir(packageDir: string | undefined): string | undefined {
  if (!packageDir) return undefined;
  return dirname(packageDir);
}

function resolveNodeModulesRootFromPackageDir(packageDir: string | undefined): string | undefined {
  if (!packageDir) return undefined;
  return dirname(dirname(packageDir));
}

function resolveNodeModulesRoots(input: {
  currentDir: string;
  resourcesPath?: string;
  sdkPackageDir?: string;
  copilotPackageDir?: string;
  sdkEntrypoint?: string;
  exists?: (path: string) => boolean;
}): string[] {
  const exists = input.exists ?? existsSync;
  const sdkPackageDir =
    input.sdkPackageDir ??
    resolvePackageDirFromEntrypoint(resolveRealPath(input.sdkEntrypoint), exists);
  return dedupePaths([
    input.resourcesPath ? join(input.resourcesPath, "app.asar.unpacked/node_modules") : undefined,
    input.resourcesPath ? join(input.resourcesPath, "node_modules") : undefined,
    join(input.currentDir, "../../../node_modules"),
    join(input.currentDir, "../../../../../node_modules"),
    resolveNodeModulesRootFromPackageDir(sdkPackageDir),
    resolveNodeModulesRootFromPackageDir(input.copilotPackageDir),
  ]);
}

function getCopilotPlatformBinaryName(platform: string): string {
  return platform === "win32" ? "copilot.exe" : "copilot";
}

export function getBundledCopilotPlatformPackages(
  platform: string = process.platform,
  arch: string = process.arch,
): ReadonlyArray<string> {
  if (platform === "darwin" && arch === "arm64") {
    return ["copilot-darwin-arm64"];
  }
  if (platform === "darwin" && arch === "x64") {
    return ["copilot-darwin-x64"];
  }
  if (platform === "linux" && arch === "arm64") {
    return ["copilot-linux-arm64"];
  }
  if (platform === "linux" && arch === "x64") {
    return ["copilot-linux-x64"];
  }
  if (platform === "win32" && arch === "arm64") {
    return ["copilot-win32-arm64"];
  }
  if (platform === "win32" && arch === "x64") {
    return ["copilot-win32-x64"];
  }

  return [];
}

export function resolveBundledCopilotCliPathFrom(input: {
  currentDir: string;
  resourcesPath?: string;
  sdkEntrypoint?: string;
  sdkPackageDir?: string;
  copilotPackageDir?: string;
  platform?: string;
  arch?: string;
  exists?: (path: string) => boolean;
}): string | undefined {
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const exists = input.exists ?? existsSync;
  const sdkPackageDir =
    input.sdkPackageDir ??
    resolvePackageDirFromEntrypoint(resolveRealPath(input.sdkEntrypoint), exists);
  const copilotPackageDir = input.copilotPackageDir;
  const nodeModulesRoots = resolveNodeModulesRoots({
    currentDir: input.currentDir,
    ...(input.resourcesPath ? { resourcesPath: input.resourcesPath } : {}),
    ...(sdkPackageDir ? { sdkPackageDir } : {}),
    ...(copilotPackageDir ? { copilotPackageDir } : {}),
    ...(input.sdkEntrypoint ? { sdkEntrypoint: input.sdkEntrypoint } : {}),
    exists,
  });
  const binaryName = getCopilotPlatformBinaryName(platform);
  const platformPackages = getBundledCopilotPlatformPackages(platform, arch);
  const githubScopeDirs = dedupePaths([
    resolveGithubScopeDirFromPackageDir(sdkPackageDir),
    resolveGithubScopeDirFromPackageDir(copilotPackageDir),
  ]);

  const binaryCandidates = nodeModulesRoots.flatMap((root) =>
    platformPackages.map((packageName) => join(root, GITHUB_SCOPE_DIR, packageName, binaryName)),
  );
  const npmLoaderCandidates = nodeModulesRoots.map((root) =>
    join(root, GITHUB_SCOPE_DIR, "copilot", COPILOT_NPM_LOADER),
  );
  const scopeBinaryCandidates = githubScopeDirs.flatMap((scopeDir) =>
    platformPackages.map((packageName) => join(scopeDir, packageName, binaryName)),
  );
  const scopeLoaderCandidates = githubScopeDirs.map((scopeDir) =>
    join(scopeDir, "copilot", COPILOT_NPM_LOADER),
  );
  for (const candidate of dedupePaths([
    ...binaryCandidates,
    ...scopeBinaryCandidates,
    ...npmLoaderCandidates,
    ...scopeLoaderCandidates,
  ])) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function resolveBundledCopilotCliPath(): string | undefined {
  const sdkPackageDir = resolveSdkPackageDir();
  const copilotPackageDir = resolveCopilotPackageDir(sdkPackageDir);
  const resourcesPath = resolveProcessResourcesPath();
  return resolveBundledCopilotCliPathFrom({
    currentDir: CURRENT_DIR,
    ...(resourcesPath ? { resourcesPath } : {}),
    ...(sdkPackageDir ? { sdkPackageDir } : {}),
    ...(copilotPackageDir ? { copilotPackageDir } : {}),
  });
}
