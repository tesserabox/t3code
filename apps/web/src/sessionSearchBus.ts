const SESSION_SEARCH_OPEN_EVENT = "t3code:open-session-search";

export function openSessionSearch(): void {
  window.dispatchEvent(new Event(SESSION_SEARCH_OPEN_EVENT));
}

export function onOpenSessionSearch(listener: () => void): () => void {
  window.addEventListener(SESSION_SEARCH_OPEN_EVENT, listener);
  return () => window.removeEventListener(SESSION_SEARCH_OPEN_EVENT, listener);
}
