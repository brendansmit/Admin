import { randomUUID } from "node:crypto";

const validCategories = new Set(["staff_birthday", "student_birthday", "school_event", "personal", "other"]);

function asDateKey(value) {
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const error = new Error("date must be YYYY-MM-DD");
    error.statusCode = 400;
    throw error;
  }
  return raw;
}

function normalizeCalendarEvent(input) {
  const title = String(input.title || "").trim();
  if (!title) {
    const error = new Error("title is required");
    error.statusCode = 400;
    throw error;
  }

  const category = String(input.category || "other").trim();
  if (!validCategories.has(category)) {
    const error = new Error("invalid category");
    error.statusCode = 400;
    throw error;
  }

  return {
    id: input.id || randomUUID(),
    title,
    category,
    date: asDateKey(input.date),
    audience: String(input.audience || "").trim(),
    notes: String(input.notes || "").trim(),
    notify_days_before: Number.isInteger(Number(input.notify_days_before)) ? Number(input.notify_days_before) : 0,
    active: input.active !== false,
    created_at: input.created_at || new Date().toISOString()
  };
}

function daysBetween(startKey, endKey) {
  const start = new Date(`${startKey}T00:00:00.000Z`);
  const end = new Date(`${endKey}T00:00:00.000Z`);
  return Math.round((end - start) / 86400000);
}

function upcomingEvents(events, now = new Date(), limit = 8) {
  const today = now.toISOString().slice(0, 10);
  return [...events]
    .filter((event) => event.active && event.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}

function dueReminderEvents(events, notificationLog, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const alreadySent = new Set(
    notificationLog
      .filter((entry) => entry.sent_on === today)
      .map((entry) => `${entry.calendar_event_id}:${entry.reminder_for}`)
  );

  return events.filter((event) => {
    if (!event.active) {
      return false;
    }

    const daysUntil = daysBetween(today, event.date);
    const reminderDue = daysUntil >= 0 && daysUntil <= event.notify_days_before;
    return reminderDue && !alreadySent.has(`${event.id}:${event.date}`);
  });
}

function formatReminderMessage(events) {
  const lines = events.map((event) => {
    const parts = [event.date, event.title];
    if (event.audience) {
      parts.push(event.audience);
    }
    if (event.notes) {
      parts.push(event.notes);
    }
    return `- ${parts.join(" | ")}`;
  });

  return ["InkHeron reminders", "", ...lines].join("\n");
}

export { dueReminderEvents, formatReminderMessage, normalizeCalendarEvent, upcomingEvents };

