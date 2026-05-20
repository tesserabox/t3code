# Feature Request: Register WsServerSetSkillEnabledRpc in WsRpcGroup. The RPC was defined in contracts but never added to the group, causing RpcGroup iteration to crash on undefined.key during WS setup — blocking ALL WebSocket connections. Also restores VITE_HTTP_URL explicit define removed by upstream v0.0.23.

**Slug**: `copilot-skill-controls-ws-rpc`
**Created**: 2026-05-20T00:55:19Z

## Description

Register WsServerSetSkillEnabledRpc in WsRpcGroup. The RPC was defined in contracts but never added to the group, causing RpcGroup iteration to crash on undefined.key during WS setup — blocking ALL WebSocket connections. Also restores VITE_HTTP_URL explicit define removed by upstream v0.0.23.
