import { MessageId, TurnId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import {
  deriveSessionSearchMatches,
  handleSessionSearchKeyDown,
  INITIAL_SESSION_SEARCH_STATE,
  navigateSessionSearchMatch,
  reduceSessionSearchState,
  resolveSessionSearchMatchIndex,
} from "./sessionSearch";
import { deriveMessagesTimelineRows, findMessagesTimelineRowIndex } from "./MessagesTimeline.logic";

const CREATED_AT = "2026-09-02T00:00:00.000Z";

function messageEntry(id: string, role: "user" | "assistant", text: string): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(id),
      role,
      text,
      turnId: null,
      streaming: false,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  };
}

const ENTRIES: ReadonlyArray<TimelineEntry> = [
  messageEntry("user-1", "user", "Needle from the user"),
  messageEntry("assistant-1", "assistant", "Needle from the assistant"),
  {
    id: "plan-1",
    kind: "proposed-plan",
    createdAt: CREATED_AT,
    proposedPlan: {
      id: "plan-1",
      turnId: null,
      planMarkdown: "# Needle plan",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  },
  {
    id: "work-1",
    kind: "work",
    createdAt: CREATED_AT,
    entry: {
      id: "work-1",
      createdAt: CREATED_AT,
      label: "Ran command",
      command: "rg Needle apps/web",
      detail: "Hidden expanded output",
      tone: "tool",
      toolLifecycleStatus: "completed",
    },
  },
];

describe("deriveSessionSearchMatches", () => {
  it("searches user, assistant, proposed-plan, and visible activity text", () => {
    expect(deriveSessionSearchMatches(ENTRIES, "needle").map((match) => match.kind)).toEqual([
      "user",
      "assistant",
      "proposed-plan",
      "activity",
    ]);
  });

  it("normalizes Unicode compatibility forms and case", () => {
    const entries = [messageEntry("unicode", "assistant", "CAFÉ cafe\u0301 Ｃａｆé")];
    expect(deriveSessionSearchMatches(entries, "café")).toHaveLength(3);
  });

  it("returns every non-overlapping occurrence in deterministic order", () => {
    const matches = deriveSessionSearchMatches(
      [messageEntry("multiple", "user", "alpha ALPHAalpha")],
      "alpha",
    );
    expect(
      matches.map(({ entryId, occurrence, normalizedIndex }) => ({
        entryId,
        occurrence,
        normalizedIndex,
      })),
    ).toEqual([
      { entryId: "multiple", occurrence: 0, normalizedIndex: 0 },
      { entryId: "multiple", occurrence: 1, normalizedIndex: 6 },
      { entryId: "multiple", occurrence: 2, normalizedIndex: 11 },
    ]);
  });

  it("does not search work detail hidden behind a different visible command", () => {
    expect(deriveSessionSearchMatches(ENTRIES, "hidden expanded output")).toEqual([]);
    expect(deriveSessionSearchMatches(ENTRIES, "rg needle")).toHaveLength(1);
  });

  it("indexes only activity entries that resolve to a rendered timeline row", () => {
    const activeTurnId = TurnId.make("turn-active");
    const entries: ReadonlyArray<TimelineEntry> = [
      {
        id: "stale-progress",
        kind: "work",
        createdAt: "2026-09-02T00:00:00.000Z",
        entry: {
          id: "stale-progress",
          createdAt: "2026-09-02T00:00:00.000Z",
          turnId: TurnId.make("turn-stale"),
          label: "Needle stale progress",
          tone: "tool",
          toolLifecycleStatus: "inProgress",
        },
      },
      {
        id: "stale-task-progress",
        kind: "work",
        createdAt: "2026-09-02T00:00:00.500Z",
        entry: {
          id: "stale-task-progress",
          createdAt: "2026-09-02T00:00:00.500Z",
          turnId: TurnId.make("turn-stale"),
          label: "Needle stale task progress",
          tone: "thinking",
          sourceActivityKind: "task.progress",
        },
      },
      {
        id: "completed-activity",
        kind: "work",
        createdAt: "2026-09-02T00:00:01.000Z",
        entry: {
          id: "completed-activity",
          createdAt: "2026-09-02T00:00:01.000Z",
          label: "Needle completed activity",
          tone: "tool",
          toolLifecycleStatus: "completed",
        },
      },
      {
        id: "user-active",
        kind: "message",
        createdAt: "2026-09-02T00:00:02.000Z",
        message: {
          id: MessageId.make("user-active"),
          role: "user",
          text: "Run the next task",
          turnId: null,
          streaming: false,
          createdAt: "2026-09-02T00:00:02.000Z",
          updatedAt: "2026-09-02T00:00:02.000Z",
        },
      },
      {
        id: "active-progress",
        kind: "work",
        createdAt: "2026-09-02T00:00:03.000Z",
        entry: {
          id: "active-progress",
          createdAt: "2026-09-02T00:00:03.000Z",
          turnId: activeTurnId,
          label: "Needle active progress",
          tone: "tool",
          toolLifecycleStatus: "inProgress",
        },
      },
      {
        id: "live-task-progress",
        kind: "work",
        createdAt: "2026-09-02T00:00:04.000Z",
        entry: {
          id: "live-task-progress",
          createdAt: "2026-09-02T00:00:04.000Z",
          turnId: activeTurnId,
          label: "Needle live task progress",
          tone: "thinking",
          sourceActivityKind: "task.progress",
        },
      },
    ];
    const timelineContext = {
      isWorking: true,
      latestTurn: null,
      runningTurnId: activeTurnId,
    } as const;
    const activityMatches = deriveSessionSearchMatches(entries, "needle", timelineContext).filter(
      (match) => match.kind === "activity",
    );

    expect(activityMatches.map((match) => match.entryId)).toEqual([
      "completed-activity",
      "active-progress",
      "live-task-progress",
    ]);
    const liveRows = deriveMessagesTimelineRows({
      timelineEntries: entries,
      ...timelineContext,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });
    const liveTaskProgressRow =
      liveRows[findMessagesTimelineRowIndex(liveRows, "live-task-progress")];
    expect(liveTaskProgressRow).toMatchObject({
      kind: "work-live",
      entry: { id: "live-task-progress" },
    });
    for (const match of activityMatches) {
      const rows = deriveMessagesTimelineRows({
        timelineEntries: entries,
        ...timelineContext,
        revealedEntryId: match.entryId,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: new Map(),
        revertTurnCountByUserMessageId: new Map(),
      });
      expect(findMessagesTimelineRowIndex(rows, match.entryId)).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns no matches for blank or missing queries", () => {
    expect(deriveSessionSearchMatches(ENTRIES, "   ")).toEqual([]);
    expect(deriveSessionSearchMatches(ENTRIES, "absent")).toEqual([]);
  });
});

describe("session search navigation", () => {
  const matches = deriveSessionSearchMatches(
    [messageEntry("multiple", "user", "alpha alpha alpha")],
    "alpha",
  );

  it("wraps next and previous navigation", () => {
    expect(navigateSessionSearchMatch(matches, matches[2]!.key, "next")?.key).toBe(matches[0]!.key);
    expect(navigateSessionSearchMatch(matches, matches[0]!.key, "previous")?.key).toBe(
      matches[2]!.key,
    );
  });

  it("uses the first match when the active key is missing and preserves stable keys", () => {
    expect(resolveSessionSearchMatchIndex(matches, null)).toBe(0);
    expect(resolveSessionSearchMatchIndex(matches, "missing")).toBe(0);
    expect(resolveSessionSearchMatchIndex(matches, matches[1]!.key)).toBe(1);
    expect(navigateSessionSearchMatch([], null, "next")).toBeNull();
  });
});

describe("reduceSessionSearchState", () => {
  it("resets selection on query changes and clears on close", () => {
    const opened = reduceSessionSearchState(INITIAL_SESSION_SEARCH_STATE, { type: "open" });
    const queried = reduceSessionSearchState(opened, {
      type: "query-changed",
      query: "needle",
    });
    const selected = reduceSessionSearchState(queried, {
      type: "select-match",
      matchKey: "match-2",
    });
    expect(selected).toMatchObject({
      open: true,
      query: "needle",
      activeMatchKey: "match-2",
    });
    expect(
      reduceSessionSearchState(selected, { type: "query-changed", query: "other" }),
    ).toMatchObject({ query: "other", activeMatchKey: null });
    expect(reduceSessionSearchState(selected, { type: "close" })).toMatchObject({
      open: false,
      query: "",
      activeMatchKey: null,
    });
  });

  it("clears search state on thread switches and re-focuses an already open search", () => {
    const opened = reduceSessionSearchState(INITIAL_SESSION_SEARCH_STATE, { type: "open" });
    const reopened = reduceSessionSearchState(opened, { type: "open" });
    expect(reopened.focusRequestId).toBe(opened.focusRequestId + 1);
    expect(reduceSessionSearchState(reopened, { type: "thread-changed" })).toMatchObject({
      open: false,
      query: "",
      activeMatchKey: null,
    });
  });
});

describe("handleSessionSearchKeyDown", () => {
  function event(
    key: string,
    overrides: Partial<{
      readonly shiftKey: boolean;
      readonly keyCode: number;
      readonly isComposing: boolean;
    }> = {},
  ) {
    return {
      key,
      shiftKey: overrides.shiftKey ?? false,
      keyCode: overrides.keyCode ?? 0,
      nativeEvent: { isComposing: overrides.isComposing ?? false },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
  }

  it("routes Enter, Shift+Enter, and Escape after preventing browser handling", () => {
    const actions = {
      close: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
    };
    const nextEvent = event("Enter");
    const previousEvent = event("Enter", { shiftKey: true });
    const closeEvent = event("Escape");

    expect(handleSessionSearchKeyDown(nextEvent, actions)).toBe(true);
    expect(handleSessionSearchKeyDown(previousEvent, actions)).toBe(true);
    expect(handleSessionSearchKeyDown(closeEvent, actions)).toBe(true);
    expect(actions.next).toHaveBeenCalledOnce();
    expect(actions.previous).toHaveBeenCalledOnce();
    expect(actions.close).toHaveBeenCalledOnce();
    for (const handledEvent of [nextEvent, previousEvent, closeEvent]) {
      expect(handledEvent.preventDefault).toHaveBeenCalledOnce();
      expect(handledEvent.stopPropagation).toHaveBeenCalledOnce();
    }
  });

  it.each([
    ["Enter", { isComposing: true }],
    ["Escape", { isComposing: true }],
    ["Enter", { keyCode: 229 }],
    ["Escape", { keyCode: 229 }],
  ] as const)("ignores %s during IME composition", (key, overrides) => {
    const composingEvent = event(key, overrides);
    const actions = {
      close: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
    };

    expect(handleSessionSearchKeyDown(composingEvent, actions)).toBe(false);
    expect(composingEvent.preventDefault).not.toHaveBeenCalled();
    expect(composingEvent.stopPropagation).not.toHaveBeenCalled();
    expect(actions.close).not.toHaveBeenCalled();
    expect(actions.next).not.toHaveBeenCalled();
    expect(actions.previous).not.toHaveBeenCalled();
  });
});
