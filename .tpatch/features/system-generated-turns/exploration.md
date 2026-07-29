# Exploration: system-generated-turns

## Minimal Changeset

This document maps every file and line range that would need modification, organized by implementation phase.

---

## Phase 1: Contracts (`packages/contracts/src/orchestration.ts`)

### 1.1 Message Role Union — Line 185

```ts
// CURRENT
export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);

// CHANGE: add "system-event"
export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system", "system-event"]);
```

### 1.2 Message Schema — Lines 188-197

```ts
// CURRENT
export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

// CHANGE: add source + triggerRef after turnId
  source: Schema.optional(Schema.Literals(["user", "system", "trigger"])),
  triggerRef: Schema.optional(Schema.String),
```

### 1.3 New Command Schema — After line 557

Add `ThreadTurnStartSystemCommand` mirroring `ThreadTurnStartCommand` (lines 538-557) but with:
- `type: Schema.Literal("thread.turn.start-system")`
- `triggerRef: Schema.String`
- message role constrained to `"system-event"`

Register in `InternalOrchestrationCommand` union at lines 725-733 (server-only, not client-dispatchable).

### 1.4 Event Type Registry — Lines 742-765

Reuse existing `"thread.turn-start-requested"` — no new event type needed. The event payload already carries `messageId`, and the message's `role` distinguishes system vs user origin.

---

## Phase 2: Orchestration (server)

### 2.1 Decider — `apps/server/src/orchestration/decider.ts` line 377-449

Add new case after `case "thread.turn.start"`:

```ts
case "thread.turn.start-system": {
  // Mirror lines 377-449 but:
  // - Skip sourceProposedPlan logic (lines 383-406) — system turns don't carry plans
  // - Set role: "system-event" at line 418
  // - Add source: "system", triggerRef: command.triggerRef to message-sent payload
  // - Emit same [userMessageEvent, turnStartRequestedEvent] pair
}
```

### 2.2 Projector — `apps/server/src/orchestration/projector.ts` line 67

```ts
// CURRENT
if (message.role === "system") {

// CHANGE
if (message.role === "system" || message.role === "system-event") {
```

### 2.3 ProviderCommandReactor — `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

**Line 568** — Role check gate:
```ts
// CURRENT
if (!message || message.role !== "user") {

// CHANGE
if (!message || (message.role !== "user" && message.role !== "system-event")) {
```

**Lines 580-607** — First-message logic (title generation, worktree naming):
Add guard: `if (message.role === "user" && isFirstUserMessageTurn)` — skip for system-event turns.

---

## Phase 3: Adapter Mapping

### 3.1 ClaudeAdapter — `apps/server/src/provider/Layers/ClaudeAdapter.ts`

**`buildUserMessage` at lines 581-593** — Add `isSynthetic` flag:
```ts
function buildUserMessage(input: {
  readonly sdkContent: Array<Record<string, unknown>>;
  readonly isSynthetic?: boolean;  // NEW
}): SDKUserMessage {
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    isSynthetic: input.isSynthetic ?? false,  // NEW
    message: {
      role: "user",
      content: input.sdkContent as unknown as SDKUserMessage["message"]["content"],
    },
  } as SDKUserMessage;
}
```

**`sendTurn` at line 3118** — Branch on message role:
```ts
// Before buildUserMessageEffect call, check if source message role is "system-event"
// Pass isSynthetic: true to buildUserMessage
```

### 3.2 CopilotAdapter — `apps/server/src/provider/Layers/CopilotAdapter.ts`

**Line 2045** — Prefix prompt:
```ts
// CURRENT
prompt: input.input ?? "",

// CHANGE
prompt: isSystemEvent ? `[System] ${input.input}` : (input.input ?? ""),
```

### 3.3 CodexAdapter — `apps/server/src/provider/Layers/CodexAdapter.ts`

**Lines 1502-1517** — Add `developer_instructions` to sendTurn params:
```ts
// After line 1515, add:
...(systemEventContent ? { developer_instructions: systemEventContent } : {}),
```

### 3.4 OpenCodeAdapter — `apps/server/src/provider/Layers/OpenCodeAdapter.ts`

**Lines 1179-1186** — Add `system` field to promptAsync body:
```ts
// Add to the object at line 1181:
...(systemInstruction ? { system: systemInstruction } : {}),
```

---

## Phase 4: UI Rendering

### 4.1 MessagesTimeline — `apps/web/src/components/chat/MessagesTimeline.tsx`

**Between lines 377-379** — New conditional block for system-event messages:
```tsx
{row.kind === "message" && row.message.role === "system-event" && (
  <div className="mx-auto max-w-md rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2 text-center text-xs text-muted-foreground">
    <span className="font-medium">[System Event]</span> {row.message.text}
  </div>
)}
```

### 4.2 Trigger Management UI (future) — Parallels `apps/web/src/components/ProjectScriptsControl.tsx`

**Pattern to follow** (lines 335-348 for add button, line 351+ for dialog):
- `PlusIcon` button → opens dialog
- Form fields: trigger name, event source (file watcher / MCP / webhook), pattern/filter, policy (auto/ask/deny)
- Toggle: "active" on/off

---

## File Impact Summary

| File | Lines | Change Type |
|------|-------|-------------|
| `packages/contracts/src/orchestration.ts` | 185, 188-197, 538+, 725-733, 742-765 | Schema additions |
| `apps/server/src/orchestration/decider.ts` | 377-449 | New case block |
| `apps/server/src/orchestration/projector.ts` | 67 | Condition extension |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | 568, 580-607 | Role check + guard |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts` | 581-593, 3118 | isSynthetic mapping |
| `apps/server/src/provider/Layers/CopilotAdapter.ts` | 2045 | Prompt prefix |
| `apps/server/src/provider/Layers/CodexAdapter.ts` | 1502-1517 | developer_instructions |
| `apps/server/src/provider/Layers/OpenCodeAdapter.ts` | 1179-1186 | system field |
| `apps/web/src/components/chat/MessagesTimeline.tsx` | 377-379 | New render block |
| NEW: `apps/server/src/EventTriggerService.ts` | — | Event source management |
| NEW: `apps/web/src/components/TriggerControl.tsx` | — | Trigger UI (future, out of v1 scope) |

**Total: 8 existing files modified, 1-2 new files (Phase 4+)**
