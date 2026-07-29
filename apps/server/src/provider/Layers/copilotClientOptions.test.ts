import { CopilotSettings } from "@t3tools/contracts";
import { describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  makeCopilotClientOptions,
  normalizeCopilotCliPathOverride,
} from "./copilotClientOptions.ts";

const decodeSettings = Schema.decodeSync(CopilotSettings);

describe("copilotClientOptions", () => {
  it("lets the SDK resolve its bundled platform binary by default", () => {
    const options = makeCopilotClientOptions({
      settings: decodeSettings({}),
      cwd: "/workspace/project",
    });

    NodeAssert.equal(options.connection, undefined);
    NodeAssert.equal(options.mode, "copilot-cli");
    NodeAssert.equal(options.workingDirectory, "/workspace/project");
  });

  it("uses explicit CLI overrides without treating platform command names as paths", () => {
    NodeAssert.equal(normalizeCopilotCliPathOverride("copilot.exe"), undefined);
    NodeAssert.equal(
      normalizeCopilotCliPathOverride("/opt/copilot/bin/copilot"),
      "/opt/copilot/bin/copilot",
    );

    const options = makeCopilotClientOptions({
      settings: decodeSettings({ binaryPath: "/opt/copilot/bin/copilot" }),
      cwd: "/workspace/project",
    });
    NodeAssert.equal(options.connection?.kind, "stdio");
    NodeAssert.equal(
      options.connection?.kind === "stdio" ? options.connection.path : undefined,
      "/opt/copilot/bin/copilot",
    );
  });
});
import * as NodeAssert from "node:assert/strict";
