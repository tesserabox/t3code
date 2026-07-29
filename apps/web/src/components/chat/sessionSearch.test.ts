import { describe, expect, it } from "vitest";

import { MessageId } from "@t3tools/contracts";

import type { TimelineEntry } from "../../session-logic";
import { deriveSessionSearchMatches } from "./sessionSearch";

const ENTRIES: ReadonlyArray<TimelineEntry> = [
  {
    id: "message-1",
    kind: "message",
    createdAt: "2026-07-29T00:00:00.000Z",
    message: {
      id: MessageId.make("message-1"),
      role: "user",
      text: "Alpha beta alpha",
      turnId: null,
      streaming: false,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
  },
  {
    id: "work-1",
    kind: "work",
    createdAt: "2026-07-29T00:00:01.000Z",
    entry: {
      id: "work-1",
      createdAt: "2026-07-29T00:00:01.000Z",
      label: "Read file",
      detail: "Found beta in output",
      tone: "tool",
    },
  },
];

describe("deriveSessionSearchMatches", () => {
  it("finds every case-insensitive occurrence across messages and work entries", () => {
    expect(deriveSessionSearchMatches(ENTRIES, "ALPHA")).toEqual([
      { entryId: "message-1", occurrence: 0 },
      { entryId: "message-1", occurrence: 1 },
    ]);
    expect(deriveSessionSearchMatches(ENTRIES, "beta")).toEqual([
      { entryId: "message-1", occurrence: 0 },
      { entryId: "work-1", occurrence: 0 },
    ]);
  });

  it("returns no matches for an empty query", () => {
    expect(deriveSessionSearchMatches(ENTRIES, "   ")).toEqual([]);
  });
});
