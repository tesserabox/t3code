# Exploration: copilot-skill-controls-ws-rpc

## Root Cause

### Issue 1: Missing RpcGroup registration

- `WsServerSetSkillEnabledRpc` was created at `packages/contracts/src/rpc.ts:214` but never added to `WsRpcGroup` at line 475.
- During WS setup, `RpcServer.toHttpEffectWebsocket(WsRpcGroup, ...)` iterates all RPCs. The handler map in `ws.ts` references `WS_METHODS.serverSetSkillEnabled`, but the RpcGroup doesn't know about it.
- Effect's `RpcGroup.js:64` tries to read `.key` on the unregistered entry → `TypeError: Cannot read properties of undefined (reading 'key')`.
- This crashes the entire WS setup — not just skill endpoints — because the error propagates before any RPC handlers are wired.

### Issue 2: VITE_HTTP_URL auto-exposure

- Upstream PR removed `"import.meta.env.VITE_HTTP_URL": JSON.stringify(configuredHttpUrl ?? "")` from vite.config.ts define block.
- The dev-runner still sets `VITE_HTTP_URL` as an env var. Vite auto-exposes `VITE_*` env vars via `import.meta.env`.
- Previously: explicit define set it to `""` → client fell back to `window.location.origin` → API calls went through vite proxy → cookies flowed same-origin.
- Now: auto-exposed as `"http://localhost:13773"` → `resolveConfiguredPrimaryTarget()` fires → API calls go cross-origin → cookies set on `:5733` not sent to `:13773`.
- This issue was masked by Issue 1 (WS crashed before cookie auth could even be attempted).

## Minimal Changeset

1. `packages/contracts/src/rpc.ts` — add `WsServerSetSkillEnabledRpc` to `WsRpcGroup.make(...)` (1 line)
2. `apps/web/vite.config.ts` — restore `"import.meta.env.VITE_HTTP_URL": JSON.stringify("")` in define block (2 lines)
