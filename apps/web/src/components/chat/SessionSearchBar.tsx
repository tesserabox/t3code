import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef } from "react";
import { cn } from "~/lib/utils";

export interface SessionSearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  currentMatchIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

export const SessionSearchBar = memo(function SessionSearchBar(props: SessionSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        props.onPrevious();
      } else if (e.key === "Enter") {
        e.preventDefault();
        props.onNext();
      }
    },
    [props.onClose, props.onNext, props.onPrevious],
  );

  const matchLabel =
    props.query.trim().length > 0 && props.matchCount > 0
      ? `${props.currentMatchIndex + 1} of ${props.matchCount}`
      : props.query.trim().length > 0
        ? "No matches"
        : "";

  return (
    <div className="absolute top-2 right-4 z-50 flex items-center gap-1 rounded-lg border bg-popover px-2 py-1.5 shadow-lg">
      <input
        ref={inputRef}
        type="text"
        className="h-6 w-48 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
        placeholder="Search in thread..."
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
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
