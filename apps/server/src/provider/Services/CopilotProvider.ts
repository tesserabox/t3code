import * as Context from "effect/Context";

import type { ServerProviderShape } from "./ServerProvider.ts";

export interface CopilotProviderShape extends ServerProviderShape {}

export class CopilotProvider extends Context.Service<CopilotProvider, CopilotProviderShape>()(
  "t3/provider/Services/CopilotProvider",
) {}
