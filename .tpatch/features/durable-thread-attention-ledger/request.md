# Feature Request: Add a server-owned durable thread attention audit ledger as a backward-compatible extension of the existing orchestration model. The first slice must persist idempotent, server-timestamped records for actionable approval/user-input and settled/unsettled transitions, expose bounded restart-safe projection/query data, and leave current web, mobile, relay, push, and TWS behavior unchanged. Do not introduce polling, a coordinator, APNs/FCM, or notification delivery in this feature.

**Slug**: `durable-thread-attention-ledger`
**Created**: 2026-09-03T08:27:14Z

## Description

Add a server-owned durable thread attention audit ledger as a backward-compatible extension of the existing orchestration model. The first slice must persist idempotent, server-timestamped records for actionable approval/user-input and settled/unsettled transitions, expose bounded restart-safe projection/query data, and leave current web, mobile, relay, push, and TWS behavior unchanged. Do not introduce polling, a coordinator, APNs/FCM, or notification delivery in this feature.
