import type { TimelineEntry } from "../../session-logic";

export interface SessionSearchMatch {
  readonly entryId: string;
  readonly occurrence: number;
}

function searchableFields(entry: TimelineEntry): ReadonlyArray<string> {
  switch (entry.kind) {
    case "message":
      return [entry.message.text];
    case "proposed-plan":
      return [entry.proposedPlan.planMarkdown];
    case "work":
      return [
        entry.entry.label,
        entry.entry.detail ?? "",
        entry.entry.command ?? "",
        entry.entry.rawCommand ?? "",
        entry.entry.toolTitle ?? "",
        ...(entry.entry.changedFiles ?? []),
      ];
  }
}

export function deriveSessionSearchMatches(
  entries: ReadonlyArray<TimelineEntry>,
  rawQuery: string,
): SessionSearchMatch[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (query.length === 0) {
    return [];
  }

  const matches: SessionSearchMatch[] = [];
  for (const entry of entries) {
    let occurrence = 0;
    for (const field of searchableFields(entry)) {
      const text = field.toLocaleLowerCase();
      let searchFrom = 0;
      while (searchFrom <= text.length - query.length) {
        const index = text.indexOf(query, searchFrom);
        if (index < 0) {
          break;
        }
        matches.push({ entryId: entry.id, occurrence });
        occurrence += 1;
        searchFrom = index + query.length;
      }
    }
  }
  return matches;
}
