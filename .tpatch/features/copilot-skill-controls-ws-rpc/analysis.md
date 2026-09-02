# Analysis: copilot-skill-controls-ws-rpc

## Compatibility

- **Upstream conflict**: None. The RpcGroup registration is purely additive.
- **VITE_HTTP_URL define**: Upstream removed it in v0.0.23 — this restores it. May conflict if upstream re-adds it differently.

## Impact

- **Critical fix**: Without this, ALL WebSocket connections fail (not just skill-related). Blocks auth, chat history, filesystem browse, terminal, and all orchestration.
- **Scope**: 2 files — `packages/contracts/src/rpc.ts` (1 line), `apps/web/vite.config.ts` (2 lines).

## Risk

- Low. Both changes are additive/restorative. No behavioral change for non-dev environments.
