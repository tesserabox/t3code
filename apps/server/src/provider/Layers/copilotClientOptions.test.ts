// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { CopilotSettings } from "@t3tools/contracts";
import { describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  copilotContinuationGroupKey,
  createCopilotClient,
  expandCopilotHomePath,
  makeCopilotClientOptions,
  normalizeCopilotCliPathOverride,
  resolveCopilotClientConfiguration,
  resolveElectronCopilotCliPath,
  resolveElectronUnpackedPath,
  type CopilotHostRuntime,
} from "./copilotClientOptions.ts";

const decodeSettings = Schema.decodeSync(CopilotSettings);

describe("copilotClientOptions", () => {
  it("uses the official bundled runtime in copilot-cli mode by default", () => {
    const options = makeCopilotClientOptions({
      settings: decodeSettings({}),
      cwd: "/workspace/project",
    });

    NodeAssert.equal(options.connection, undefined);
    NodeAssert.equal(options.mode, "copilot-cli");
    NodeAssert.equal(options.workingDirectory, "/workspace/project");
    NodeAssert.equal(options.baseDirectory, NodePath.join(NodeOS.homedir(), ".copilot"));
  });

  it("constructs the bundled runtime client with the compatible platform package", () => {
    const client = createCopilotClient({
      settings: decodeSettings({}),
      cwd: "/workspace/project",
    });

    NodeAssert.ok(client);
  });

  it("uses the unpacked native Copilot executable under Electron", () => {
    const packedPath =
      "/Applications/T3 Code.app/Contents/Resources/app.asar/node_modules/@github/copilot-darwin-arm64/copilot";
    const unpackedPath =
      "/Applications/T3 Code.app/Contents/Resources/app.asar.unpacked/node_modules/@github/copilot-darwin-arm64/copilot";
    const runtime: CopilotHostRuntime = {
      isElectron: true,
      platform: "darwin",
      architecture: "arm64",
      resolvePackage: (packageName) => {
        NodeAssert.equal(packageName, "@github/copilot-darwin-arm64");
        return packedPath;
      },
      pathExists: (path) => path === unpackedPath,
    };

    NodeAssert.equal(resolveElectronUnpackedPath(packedPath), unpackedPath);
    NodeAssert.equal(resolveElectronCopilotCliPath(runtime), unpackedPath);

    const options = makeCopilotClientOptions(
      {
        settings: decodeSettings({}),
        cwd: "/workspace/project",
        environment: { ELECTRON_RUN_AS_NODE: "1" },
      },
      runtime,
    );

    NodeAssert.equal(options.connection?.kind, "stdio");
    NodeAssert.equal(
      options.connection?.kind === "stdio" ? options.connection.path : undefined,
      unpackedPath,
    );
  });

  it("preserves an explicitly selected in-process Electron connection", () => {
    const runtime: CopilotHostRuntime = {
      isElectron: true,
      platform: "darwin",
      architecture: "arm64",
      resolvePackage: () => {
        throw new Error("The bundled executable should not be resolved.");
      },
      pathExists: () => false,
    };
    const options = makeCopilotClientOptions(
      {
        settings: decodeSettings({}),
        cwd: "/workspace/project",
        environment: { COPILOT_SDK_DEFAULT_CONNECTION: "inprocess" },
      },
      runtime,
    );

    NodeAssert.equal(options.connection, undefined);
  });

  it("resolves Windows server.asar executables and Linux musl fallbacks", () => {
    const windowsPacked =
      "C:\\Program Files\\T3 Code\\resources\\server.asar\\node_modules\\@github\\copilot-win32-x64\\copilot.exe";
    const windowsUnpacked =
      "C:\\Program Files\\T3 Code\\resources\\server.asar.unpacked\\node_modules\\@github\\copilot-win32-x64\\copilot.exe";
    NodeAssert.equal(
      resolveElectronCopilotCliPath({
        isElectron: true,
        platform: "win32",
        architecture: "x64",
        resolvePackage: (packageName) => {
          NodeAssert.equal(packageName, "@github/copilot-win32-x64");
          return windowsPacked;
        },
        pathExists: (path) => path === windowsUnpacked,
      }),
      windowsUnpacked,
    );

    const attemptedPackages: string[] = [];
    const linuxUnpacked =
      "/opt/t3/resources/app.asar.unpacked/node_modules/@github/copilot-linuxmusl-arm64/copilot";
    NodeAssert.equal(
      resolveElectronCopilotCliPath({
        isElectron: true,
        platform: "linux",
        architecture: "arm64",
        resolvePackage: (packageName) => {
          attemptedPackages.push(packageName);
          if (packageName === "@github/copilot-linux-arm64") {
            throw new Error("glibc package unavailable");
          }
          return linuxUnpacked.replace("app.asar.unpacked", "app.asar");
        },
        pathExists: (path) => path === linuxUnpacked,
      }),
      linuxUnpacked,
    );
    NodeAssert.deepEqual(attemptedPackages, [
      "@github/copilot-linux-arm64",
      "@github/copilot-linuxmusl-arm64",
    ]);
  });

  it("uses explicit runtime and COPILOT_HOME overrides", () => {
    NodeAssert.equal(normalizeCopilotCliPathOverride("copilot.exe"), undefined);
    NodeAssert.equal(
      normalizeCopilotCliPathOverride("/opt/copilot/bin/copilot"),
      "/opt/copilot/bin/copilot",
    );
    NodeAssert.equal(
      expandCopilotHomePath("~/work-copilot"),
      NodePath.join(NodeOS.homedir(), "work-copilot"),
    );

    const environment = { PATH: "/usr/bin", COPILOT_HOME: "/ignored/environment-home" };
    const options = makeCopilotClientOptions({
      settings: decodeSettings({
        binaryPath: "/opt/copilot/bin/copilot",
        homePath: "~/work-copilot",
      }),
      cwd: "/workspace/project",
      environment,
    });
    NodeAssert.equal(options.connection?.kind, "stdio");
    NodeAssert.equal(
      options.connection?.kind === "stdio" ? options.connection.path : undefined,
      "/opt/copilot/bin/copilot",
    );
    NodeAssert.equal(options.baseDirectory, NodePath.join(NodeOS.homedir(), "work-copilot"));
    NodeAssert.deepEqual(options.env, environment);
  });

  it("uses normalized environment COPILOT_HOME when the setting is blank", () => {
    const resolved = resolveCopilotClientConfiguration({
      settings: decodeSettings({ homePath: "" }),
      cwd: "/workspace/project",
      environment: { COPILOT_HOME: "~/environment-copilot" },
    });
    const expectedHome = NodePath.join(NodeOS.homedir(), "environment-copilot");

    NodeAssert.equal(resolved.effectiveHome, expectedHome);
    NodeAssert.equal(resolved.options.baseDirectory, expectedHome);
    NodeAssert.equal(
      copilotContinuationGroupKey(resolved.effectiveHome),
      `githubCopilot:home:${expectedHome}`,
    );
  });
});
