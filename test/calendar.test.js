import test from "node:test";
import assert from "node:assert/strict";
import { dueReminderEvents, normalizeCalendarEvent, upcomingEvents } from "../src/calendar.js";

test("normalizes calendar events for birthdays and school events", () => {
  const event = normalizeCalendarEvent({
    title: "Alex birthday",
    category: "student_birthday",
    date: "2026-07-01",
    audience: "Year 7",
    notify_days_before: "2"
  });

  assert.equal(event.title, "Alex birthday");
  assert.equal(event.category, "student_birthday");
  assert.equal(event.audience, "Year 7");
  assert.equal(event.notify_days_before, 2);
  assert.equal(event.active, true);
});

test("returns upcoming active events in date order", () => {
  const events = [
    normalizeCalendarEvent({ title: "Later", category: "school_event", date: "2026-07-10" }),
    normalizeCalendarEvent({ title: "Hidden", category: "other", date: "2026-07-01", active: false }),
    normalizeCalendarEvent({ title: "Soon", category: "staff_birthday", date: "2026-07-02" })
  ];

  const upcoming = upcomingEvents(events, new Date("2026-07-01T00:00:00.000Z"));

  assert.deepEqual(
    upcoming.map((event) => event.title),
    ["Soon", "Later"]
  );
});

test("selects due reminder events without repeating the same day", () => {
  const event = normalizeCalendarEvent({
    title: "Staff birthday",
    category: "staff_birthday",
    date: "2026-07-03",
    notify_days_before: 2
  });

  const due = dueReminderEvents([event], [], new Date("2026-07-01T00:00:00.000Z"));
  const repeated = dueReminderEvents(
    [event],
    [{ calendar_event_id: event.id, reminder_for: event.date, sent_on: "2026-07-01" }],
    new Date("2026-07-01T00:00:00.000Z")
  );

  assert.equal(due.length, 1);
  assert.equal(repeated.length, 0);
});

