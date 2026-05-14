/**
 * CopilotAdapter - GitHub Copilot implementation of the generic provider adapter contract.
 *
 * This service owns Copilot SDK session semantics and emits canonical
 * provider runtime events. It does not perform cross-provider routing, shared
 * event fan-out, or checkpoint orchestration.
 *
 * Uses Effect `Context.Service` for dependency injection and returns the
 * shared provider-adapter error channel with `provider: "copilot"` context.
 *
 * @module CopilotAdapter
 */
import * as Context from "effect/Context";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";
import { ProviderDriverKind } from "@t3tools/contracts";

/**
 * CopilotAdapterShape - Service API for the GitHub Copilot provider adapter.
 */
export interface CopilotAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: ProviderDriverKind;
}

/**
 * CopilotAdapter - Service tag for GitHub Copilot provider adapter operations.
 */
export class CopilotAdapter extends Context.Service<CopilotAdapter, CopilotAdapterShape>()(
  "t3/provider/Services/CopilotAdapter",
) {}
