# Exploration: session-search

## Existing Patterns to Follow

### Keybinding Registration
- File: `apps/server/src/keybindings.ts`
- Pattern: `{ key: "mod+f", command: "chat.search", when: "!terminalFocus" }`
- `mod+f` is currently unbound — no conflict
- The `when: "!terminalFocus"` guard prevents intercepting terminal's Ctrl+F

### Search UI Pattern (from ModelPickerContent.tsx)
```typescript
const [searchQuery, setSearchQuery] = useState("");
const searchInputRef = useRef<HTMLInputElement>(null);
// Focus on mount
useEffect(() => { searchInputRef.current?.focus(); }, []);
// Debounced filtering
const isSearching = searchQuery.trim().length > 0;
```

### Command Handling (from ChatView.tsx)
- Commands are dispatched via `useKeybindings()` hook
- ChatView already handles: `terminal.toggle`, `diff.toggle`, `commandPalette.toggle`, `modelPicker.toggle`
- Add `chat.search` to the same handler

### Message Data Available for Search
```typescript
// ChatMessage.text — user/assistant message content
// WorkLogEntry.label — tool call labels
// WorkLogEntry.detail — tool output details
// WorkLogEntry.command — shell commands
```

### Timeline Structure (MessagesTimeline.tsx)
- Renders `TimelineEntry[]` — each entry is a message or work log group
- Messages render via `MarkdownRenderer` — search highlighting would wrap matched spans
- Work log entries render labels/details as plain text — easier to highlight

### Highlight Approach
Two options:
1. **CSS-based**: Add a `<mark>` wrapper around matched text via string splitting — simple but breaks markdown rendering
2. **DOM-based**: After render, use `window.find()` or TreeWalker to highlight matches in the DOM — preserves rendering but more complex
3. **Hybrid**: For plain text (work log), use string splitting. For markdown messages, use a custom rehype plugin or post-render DOM marking.

**Recommended**: Start with option 1 for plain text content, extend to option 3 for markdown if needed.

### Scroll-to-Match
- `MessagesTimeline` uses a scroll container — `scrollIntoView({ behavior: "smooth", block: "center" })` on the matched element
- Need to track matched element refs or use query selectors on `[data-search-match="N"]` attributes

## Key Decisions
- Search bar position: **top of chat area** (like VS Code's find widget) — stays visible while scrolling
- Match navigation: **Enter = next, Shift+Enter = previous** (standard pattern)
- Case sensitivity: **case-insensitive** by default (no toggle needed for v1)
