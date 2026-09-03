import { TwsWorkspaceBindingId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import { matchTwsBindingByLocators, mergeTwsLocators } from "./TwsBindingMatch.ts";

describe("TwsBindingMatch", () => {
  it("matches by retained locator and merges a rename under the same product id", () => {
    const id = TwsWorkspaceBindingId.make("workspace-binding-1");
    const existing = {
      id,
      canonicalLocator: { kind: "path" as const, value: "/old/path" },
      locators: [{ kind: "registry-entry" as const, value: "registry-1" }],
    };

    assert.deepEqual(
      matchTwsBindingByLocators(
        [existing],
        [
          { kind: "registry-entry", value: "registry-1" },
          { kind: "path", value: "/new/path" },
        ],
      ),
      { kind: "matched", id },
    );
    assert.deepEqual(
      mergeTwsLocators({ kind: "path", value: "/new/path" }, existing.locators, [
        existing.canonicalLocator,
      ]),
      [
        { kind: "path", value: "/new/path" },
        { kind: "registry-entry", value: "registry-1" },
        { kind: "path", value: "/old/path" },
      ],
    );
  });

  it("returns new or ambiguous without consulting repository identity", () => {
    assert.deepEqual(matchTwsBindingByLocators([], [{ kind: "name", value: "feature-a" }]), {
      kind: "new",
    });

    const observed = [{ kind: "name" as const, value: "feature-a" }];
    const bindings = ["binding-b", "binding-a"].map((value) => ({
      id: TwsWorkspaceBindingId.make(value),
      canonicalLocator: observed[0]!,
      locators: observed,
      repositoryIdentity: value,
    }));
    assert.deepEqual(matchTwsBindingByLocators(bindings, observed), {
      kind: "ambiguous",
      ids: [TwsWorkspaceBindingId.make("binding-a"), TwsWorkspaceBindingId.make("binding-b")],
    });
  });
});
