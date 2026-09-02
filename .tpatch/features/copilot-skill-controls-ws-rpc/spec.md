# Spec: copilot-skill-controls-ws-rpc

## Acceptance Criteria

1. `WsServerSetSkillEnabledRpc` is listed in `WsRpcGroup.make(...)` in `packages/contracts/src/rpc.ts`
2. `import.meta.env.VITE_HTTP_URL` is explicitly defined as `""` in `apps/web/vite.config.ts` define block
3. WebSocket connections succeed in dev mode (`bun run dev`)
4. Chat history loads after pairing
5. Filesystem browse works in "Add Project" dialog
6. `bun run typecheck` passes 13/13
