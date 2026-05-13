# Spec: session-search

## Acceptance Criteria

1. **Keybinding**: `Cmd+F` (Mac) / `Ctrl+F` (Windows/Linux) opens a search bar within the chat view
2. **Search bar**: Floating input at the top of the message area with:
   - Text input field with placeholder "Search in thread..."
   - Match count indicator ("3 of 12 matches")
   - Up/Down navigation arrows to jump between matches
   - Close button (Escape also closes)
3. **Search scope**: Searches across:
   - User message text
   - Assistant message text (rendered markdown source)
   - Work log entry labels and details
   - Tool output summaries
4. **Highlighting**: Matched text is visually highlighted in the message timeline
5. **Navigation**: Up/Down arrows or Enter/Shift+Enter scroll to and focus the next/previous match
6. **Performance**: Search is debounced (200ms) and doesn't block the UI for large threads
7. **Dismiss**: Escape key or close button dismisses the search bar and clears highlights
8. `bun run typecheck` passes

## Out of Scope
- Search across multiple threads (this is single-thread search)
- Regex or advanced query syntax
- Search in collapsed/hidden content (file diffs, images)
- Persistent search history
- Server-side search (all client-side)

## Plan

1. Register `mod+f` keybinding for `chat.search` command in `keybindings.ts`
2. Create `SessionSearchBar.tsx` component (input + match count + navigation)
3. Add search state to `ChatView.tsx` (query, matches, current match index)
4. Add highlight wrapping in `MessagesTimeline.tsx` for matched text spans
5. Wire Escape to dismiss, Enter to navigate

## Files to Touch

| File | Change |
|------|--------|
| `apps/server/src/keybindings.ts` | Add `{ key: "mod+f", command: "chat.search" }` |
| `apps/web/src/components/chat/SessionSearchBar.tsx` | NEW — search input + navigation |
| `apps/web/src/components/ChatView.tsx` | Search state, toggle visibility, pass to timeline |
| `apps/web/src/components/chat/MessagesTimeline.tsx` | Highlight matched text in messages |
| `apps/web/src/session-logic.ts` | Optional: search/filter utility for messages |
