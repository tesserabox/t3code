import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef } from "react";

export interface SessionSearchBarProps {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly matchCount: number;
  readonly currentMatchIndex: number;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onClose: () => void;
}

export const SessionSearchBar = memo(function SessionSearchBar(props: SessionSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
      } else if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        props.onPrevious();
      } else if (event.key === "Enter") {
        event.preventDefault();
        props.onNext();
      }
    },
    [props],
  );

  const trimmedQuery = props.query.trim();
  const matchLabel =
    trimmedQuery.length > 0 && props.matchCount > 0
      ? `${props.currentMatchIndex + 1} of ${props.matchCount}`
      : trimmedQuery.length > 0
        ? "No matches"
        : "";

  return (
    <div className="absolute top-2 right-4 z-50 flex items-center gap-1 rounded-lg border bg-popover px-2 py-1.5 shadow-lg">
      <input
        ref={inputRef}
        type="search"
        className="h-6 w-48 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
        placeholder="Search in thread..."
        value={props.query}
        onChange={(event) => props.onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Search in thread"
      />
      {matchLabel ? (
        <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">{matchLabel}</span>
      ) : null}
      <button
        type="button"
        className="flex size-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-30"
        onClick={props.onPrevious}
        disabled={props.matchCount === 0}
        aria-label="Previous match"
      >
        <ChevronUpIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className="flex size-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-30"
        onClick={props.onNext}
        disabled={props.matchCount === 0}
        aria-label="Next match"
      >
        <ChevronDownIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className="flex size-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
        onClick={props.onClose}
        aria-label="Close search"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
});
