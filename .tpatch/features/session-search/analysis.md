# Analysis: session-search

## Summary
Add Cmd/Ctrl+F in-session search to find text within the current chat thread. Currently there's no way to search through conversation history — users have to scroll manually or rely on browser find (which doesn't work well in the desktop app since messages are virtualized/lazy-rendered).

## Compatibility
- **Compatible** — additive UI feature, no provider or server changes needed
- **Scope**: Web app only (`apps/web/`)
- **Risk**: Low — new component + keybinding, no existing behavior modified

## Technical Notes
- Messages are stored as `ChatMessage[]` with `text` field containing the searchable content
- Work log entries have `label`, `detail`, and `command` fields
- The app already has search UI patterns: `ModelPickerContent.tsx` uses `searchQuery` state + filtered list
- Keybinding system supports `mod+f` registration (currently unbound)
- `MessagesTimeline.tsx` renders all visible messages — search highlighting would go here
- Electron's `webContents.findInPage()` exists but would search the entire page, not scoped to the thread
- A custom search is better — can scope to thread content, highlight within message bubbles, and navigate between matches
