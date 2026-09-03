import { ThreadId, type ServerProviderSkill } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { mergeCopilotSessionSkills } from "./CopilotDriver.ts";

const skill = (
  name: string,
  enabled: boolean,
  scope = "personal-copilot",
): ServerProviderSkill => ({
  name,
  path: `/skills/${name}/SKILL.md`,
  scope,
  enabled,
});

describe("mergeCopilotSessionSkills", () => {
  it("unions context-independent session snapshots and lets the latest session win", () => {
    const skillsBySession = new Map([
      [ThreadId.make("thread-a"), [skill("alpha", true), skill("shared", false)]],
      [ThreadId.make("thread-b"), [skill("beta", true), skill("shared", true)]],
    ]);

    expect(mergeCopilotSessionSkills(skillsBySession)).toEqual([
      skill("alpha", true),
      skill("beta", true),
      skill("shared", true),
    ]);
  });
});
