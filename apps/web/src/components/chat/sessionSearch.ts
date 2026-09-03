import { omitSupersededLifecycleMarkers } from "@t3tools/client-runtime/work-log/presentation";

import type { TimelineEntry } from "../../session-logic";
import {
  deriveActiveTimelineWorkState,
  deriveUnsettledTurnId,
  type TimelineLatestTurn,
  workEntryDisplayText,
  workEntryIsVisibleInGroup,
  workEntryIsVisibleInTimelineGroup,
} from "./MessagesTimeline.logic";

export const SESSION_SEARCH_MAX_QUERY_LENGTH = 200;

export type SessionSearchMatchKind = "user" | "assistant" | "proposed-plan" | "activity";

export interface SessionSearchMatch {
  readonly key: string;
  readonly entryId: string;
  readonly kind: SessionSearchMatchKind;
  readonly occurrence: number;
  readonly normalizedIndex: number;
}

export interface SessionSearchState {
  readonly open: boolean;
  readonly query: string;
  readonly activeMatchKey: string | null;
  readonly focusRequestId: number;
}

export type SessionSearchAction =
  | { readonly type: "open" }
  | { readonly type: "close" }
  | { readonly type: "thread-changed" }
  | { readonly type: "query-changed"; readonly query: string }
  | { readonly type: "select-match"; readonly matchKey: string };

export const INITIAL_SESSION_SEARCH_STATE: SessionSearchState = {
  open: false,
  query: "",
  activeMatchKey: null,
  focusRequestId: 0,
};

export function reduceSessionSearchState(
  state: SessionSearchState,
  action: SessionSearchAction,
): SessionSearchState {
  switch (action.type) {
    case "open":
      return {
        ...state,
        open: true,
        focusRequestId: state.focusRequestId + 1,
      };
    case "query-changed":
      return {
        ...state,
        query: action.query.slice(0, SESSION_SEARCH_MAX_QUERY_LENGTH),
        activeMatchKey: null,
      };
    case "select-match":
      return {
        ...state,
        activeMatchKey: action.matchKey,
      };
    case "close":
    case "thread-changed":
      return {
        ...INITIAL_SESSION_SEARCH_STATE,
        focusRequestId: state.focusRequestId,
      };
  }
}

export interface SessionSearchKeyboardEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly keyCode: number;
  readonly nativeEvent: {
    readonly isComposing: boolean;
  };
  readonly preventDefault: () => void;
  readonly stopPropagation: () => void;
}

export function handleSessionSearchKeyDown(
  event: SessionSearchKeyboardEvent,
  actions: {
    readonly close: () => void;
    readonly next: () => void;
    readonly previous: () => void;
  },
): boolean {
  if (event.nativeEvent.isComposing || event.keyCode === 229) {
    return false;
  }

  const action =
    event.key === "Escape"
      ? actions.close
      : event.key === "Enter"
        ? event.shiftKey
          ? actions.previous
          : actions.next
        : null;
  if (action === null) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  action();
  return true;
}

export function normalizeSessionSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export interface SessionSearchTimelineContext {
  readonly isWorking?: boolean;
  readonly latestTurn?: TimelineLatestTurn | null;
  readonly runningTurnId?: TimelineLatestTurn["turnId"] | null;
  readonly workspaceRoot?: string | undefined;
}

function searchableWorkEntryIds(
  entries: ReadonlyArray<TimelineEntry>,
  options: SessionSearchTimelineContext | undefined,
): ReadonlySet<string> {
  const visibilityContext = {
    isWorking: options?.isWorking ?? false,
    unsettledTurnId: deriveUnsettledTurnId(
      options?.latestTurn ?? null,
      options?.runningTurnId ?? null,
    ),
  };
  const activeTailEntryIds = new Set(
    deriveActiveTimelineWorkState(entries, visibilityContext).entries.map((entry) => entry.id),
  );
  const visibleEntries = entries.flatMap((entry) => {
    if (entry.kind !== "work" || entry.entry.agentSpawn !== undefined) {
      return [];
    }
    const visible = activeTailEntryIds.has(entry.id)
      ? workEntryIsVisibleInGroup(entry.entry, true)
      : workEntryIsVisibleInTimelineGroup(entry.entry, visibilityContext);
    return visible ? [entry] : [];
  });
  return new Set(
    omitSupersededLifecycleMarkers(visibleEntries, (entry) => entry.entry).map((entry) => entry.id),
  );
}

function searchableEntryText(
  entry: TimelineEntry,
  searchableWorkIds: ReadonlySet<string>,
  workspaceRoot: string | undefined,
): { readonly kind: SessionSearchMatchKind; readonly text: string } | null {
  switch (entry.kind) {
    case "message":
      if (entry.message.role !== "user" && entry.message.role !== "assistant") {
        return null;
      }
      return { kind: entry.message.role, text: entry.message.text };
    case "proposed-plan":
      return { kind: "proposed-plan", text: entry.proposedPlan.planMarkdown };
    case "work":
      return searchableWorkIds.has(entry.id)
        ? {
            kind: "activity",
            text: workEntryDisplayText(entry.entry, workspaceRoot),
          }
        : null;
  }
}

export function deriveSessionSearchMatches(
  entries: ReadonlyArray<TimelineEntry>,
  rawQuery: string,
  options?: SessionSearchTimelineContext,
): SessionSearchMatch[] {
  const query = normalizeSessionSearchText(rawQuery.trim());
  if (query.length === 0) {
    return [];
  }

  const searchableWorkIds = searchableWorkEntryIds(entries, options);
  const matches: SessionSearchMatch[] = [];
  for (const entry of entries) {
    const searchable = searchableEntryText(entry, searchableWorkIds, options?.workspaceRoot);
    if (searchable === null) {
      continue;
    }
    const text = normalizeSessionSearchText(searchable.text);
    let occurrence = 0;
    let searchFrom = 0;
    while (searchFrom <= text.length - query.length) {
      const index = text.indexOf(query, searchFrom);
      if (index < 0) {
        break;
      }
      matches.push({
        key: JSON.stringify([entry.id, searchable.kind, occurrence, index]),
        entryId: entry.id,
        kind: searchable.kind,
        occurrence,
        normalizedIndex: index,
      });
      occurrence += 1;
      searchFrom = index + query.length;
    }
  }
  return matches;
}

export function resolveSessionSearchMatchIndex(
  matches: ReadonlyArray<SessionSearchMatch>,
  activeMatchKey: string | null,
): number {
  if (matches.length === 0) {
    return -1;
  }
  if (activeMatchKey === null) {
    return 0;
  }
  const index = matches.findIndex((match) => match.key === activeMatchKey);
  return index < 0 ? 0 : index;
}

export function navigateSessionSearchMatch(
  matches: ReadonlyArray<SessionSearchMatch>,
  activeMatchKey: string | null,
  direction: "next" | "previous",
): SessionSearchMatch | null {
  const currentIndex = resolveSessionSearchMatchIndex(matches, activeMatchKey);
  if (currentIndex < 0) {
    return null;
  }
  const delta = direction === "next" ? 1 : -1;
  return matches[(currentIndex + delta + matches.length) % matches.length] ?? null;
}
