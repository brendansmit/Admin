import test from "node:test";
import assert from "node:assert/strict";
import { markWorkEvent, normalizeWorkEvent, pairSessions, summarizeWork } from "../src/work-log.js";

test("pairs arrive and leave events into a complete session", () => {
  const events = [
    normalizeWorkEvent({
      event: "arrive",
      location: "office",
      occurred_at: "2026-06-29T08:00:00.000Z",
      source: "test"
    }),
    normalizeWorkEvent({
      event: "leave",
      location: "office",
      occurred_at: "2026-06-29T16:30:00.000Z",
      source: "test"
    })
  ];

  const sessions = pairSessions(events);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].status, "complete");
  assert.equal(sessions[0].duration_minutes, 510);
});

test("marks repeated events inside 15 minutes as duplicates", () => {
  const store = { workEvents: [] };
  const first = normalizeWorkEvent({
    event: "arrive",
    location: "classroom",
    occurred_at: "2026-06-29T08:00:00.000Z",
    source: "test"
  });
  const second = normalizeWorkEvent({
    event: "arrive",
    location: "classroom",
    occurred_at: "2026-06-29T08:10:00.000Z",
    source: "test"
  });

  markWorkEvent(store, first);
  markWorkEvent(store, second);

  assert.equal(store.workEvents[1].duplicate, true);
  assert.match(store.workEvents[1].warning, /Duplicate arrive/);
});

test("summarizes today and week totals from complete sessions", () => {
  const events = [
    normalizeWorkEvent({
      event: "arrive",
      location: "office",
      occurred_at: "2026-06-29T08:00:00.000Z",
      source: "test"
    }),
    normalizeWorkEvent({
      event: "leave",
      location: "office",
      occurred_at: "2026-06-29T12:15:00.000Z",
      source: "test"
    })
  ];

  const summary = summarizeWork(events, new Date("2026-06-29T18:00:00.000Z"));

  assert.equal(summary.todayMinutes, 255);
  assert.equal(summary.weekMinutes, 255);
  assert.equal(summary.openSession, null);
});

