import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { GithubCopilotIcon } from "../Icons";
import { AVAILABLE_PROVIDER_OPTIONS, PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";

describe("GitHub Copilot provider presentation", () => {
  it("uses the Copilot icon for canonical and legacy driver kinds", () => {
    expect(PROVIDER_ICON_BY_PROVIDER[ProviderDriverKind.make("githubCopilot")]).toBe(
      GithubCopilotIcon,
    );
    expect(PROVIDER_ICON_BY_PROVIDER[ProviderDriverKind.make("copilot")]).toBe(GithubCopilotIcon);
  });

  it("is active in the model picker", () => {
    expect(AVAILABLE_PROVIDER_OPTIONS.some((option) => option.value === "githubCopilot")).toBe(
      true,
    );
  });
});
