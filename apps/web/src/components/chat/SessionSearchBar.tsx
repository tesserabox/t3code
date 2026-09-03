import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { handleSessionSearchKeyDown, SESSION_SEARCH_MAX_QUERY_LENGTH } from "./sessionSearch";

export interface SessionSearchBarProps {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly matchCount: number;
  readonly currentMatchIndex: number;
  readonly focusRequestId: number;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onClose: () => void;
  readonly hasUnloadedHistory: boolean;
  readonly loadingEarlierHistory: boolean;
  readonly onLoadEarlierHistory?: (() => void) | undefined;
}

export const SessionSearchBar = memo(function SessionSearchBar(props: SessionSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    return () => {
      const restoreTarget = restoreFocusRef.current;
      if (restoreTarget?.isConnected) {
        restoreTarget.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [props.focusRequestId]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      handleSessionSearchKeyDown(event, {
        close: props.onClose,
        next: props.onNext,
        previous: props.onPrevious,
      });
    },
    [props],
  );

  const hasQuery = props.query.trim().length > 0;
  const resultLabel =
    hasQuery && props.matchCount > 0
      ? `${props.currentMatchIndex + 1} of ${props.matchCount}`
      : hasQuery
        ? "No matches"
        : "Type to search";

  return (
    <div
      role="search"
      aria-label="Search current thread"
      className="absolute top-2 right-3 left-3 z-40 flex max-w-full flex-wrap items-center justify-end gap-1 rounded-lg border bg-popover px-2 py-1.5 shadow-lg sm:left-auto"
    >
      <input
        ref={inputRef}
        type="search"
        className="h-6 min-w-36 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50 sm:w-52 sm:flex-none"
        placeholder="Search loaded turns..."
        value={props.query}
        maxLength={SESSION_SEARCH_MAX_QUERY_LENGTH}
        onChange={(event) => props.onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Search in thread"
      />
      <span
        role="status"
        aria-live="polite"
        className="shrink-0 text-xs text-muted-foreground/70 tabular-nums"
      >
        {resultLabel}
      </span>
      {props.hasUnloadedHistory && props.onLoadEarlierHistory ? (
        <button
          type="button"
          className="h-6 shrink-0 rounded px-1.5 text-xs text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground disabled:cursor-default disabled:opacity-50"
          onClick={props.onLoadEarlierHistory}
          disabled={props.loadingEarlierHistory}
          aria-label="Load earlier turns to include them in search"
        >
          {props.loadingEarlierHistory ? "Loading…" : "Load earlier"}
        </button>
      ) : null}
      <button
        type="button"
        className="flex size-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-30"
        onClick={props.onPrevious}
        disabled={props.matchCount === 0}
        aria-label="Previous match"
      >
        <ChevronUpIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className="flex size-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-30"
        onClick={props.onNext}
        disabled={props.matchCount === 0}
        aria-label="Next match"
      >
        <ChevronDownIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className="flex size-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground"
        onClick={props.onClose}
        aria-label="Close search"
      >
        <XIcon className="size-3.5" />
      </button>
      {props.hasUnloadedHistory ? (
        <span className="w-full text-right text-[10px] leading-none text-muted-foreground/60">
          Results include loaded turns only
        </span>
      ) : null}
    </div>
  );
});
