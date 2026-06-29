import { randomUUID } from "node:crypto";

const duplicateWindowMs = 15 * 60 * 1000;

function parseDate(value, fallback = new Date()) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date;
}

function normalizeWorkEvent(input, receivedAt = new Date()) {
  const eventType = String(input.event || input.event_type || "").trim().toLowerCase();

  if (!["arrive", "leave"].includes(eventType)) {
    const error = new Error("event must be arrive or leave");
    error.statusCode = 400;
    throw error;
  }

  return {
    id: randomUUID(),
    event_type: eventType,
    location: String(input.location || "work").trim() || "work",
    occurred_at: parseDate(input.occurred_at, receivedAt).toISOString(),
    received_at: receivedAt.toISOString(),
    source: String(input.source || "unknown").trim() || "unknown",
    device: input.device ? String(input.device).trim() : "",
    lat: Number.isFinite(Number(input.lat)) ? Number(input.lat) : null,
    lon: Number.isFinite(Number(input.lon)) ? Number(input.lon) : null,
    duplicate: false,
    warning: "",
    raw_json: input
  };
}

function markWorkEvent(store, event) {
  const previousEvents = store.workEvents
    .filter((candidate) => candidate.location === event.location)
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  const previous = previousEvents.at(-1);

  if (previous) {
    const gapMs = Math.abs(new Date(event.occurred_at) - new Date(previous.occurred_at));
    if (previous.event_type === event.event_type && gapMs <= duplicateWindowMs) {
      event.duplicate = true;
      event.warning = `Duplicate ${event.event_type} within 15 minutes`;
    }

    if (!event.duplicate && previous.event_type === "arrive" && event.event_type === "arrive") {
      event.warning = "Arrive event without a matching leave";
    }

    if (!event.duplicate && previous.event_type === "leave" && event.event_type === "leave") {
      event.warning = "Leave event without a matching arrive";
    }
  } else if (event.event_type === "leave") {
    event.warning = "Leave event without an earlier arrive";
  }

  store.workEvents.push(event);
  store.workEvents.sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  return event;
}

function pairSessions(events) {
  const sessions = [];
  const sorted = [...events]
    .filter((event) => !event.duplicate)
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));

  let openArrive = null;

  for (const event of sorted) {
    if (event.event_type === "arrive") {
      if (openArrive) {
        sessions.push({
          id: `${openArrive.id}:open`,
          arrive_event_id: openArrive.id,
          leave_event_id: null,
          location: openArrive.location,
          start: openArrive.occurred_at,
          end: null,
          duration_minutes: 0,
          status: "missing_leave"
        });
      }
      openArrive = event;
      continue;
    }

    if (!openArrive) {
      sessions.push({
        id: `${event.id}:orphan`,
        arrive_event_id: null,
        leave_event_id: event.id,
        location: event.location,
        start: null,
        end: event.occurred_at,
        duration_minutes: 0,
        status: "missing_arrive"
      });
      continue;
    }

    const durationMs = new Date(event.occurred_at) - new Date(openArrive.occurred_at);
    sessions.push({
      id: `${openArrive.id}:${event.id}`,
      arrive_event_id: openArrive.id,
      leave_event_id: event.id,
      location: openArrive.location,
      start: openArrive.occurred_at,
      end: event.occurred_at,
      duration_minutes: Math.max(0, Math.round(durationMs / 60000)),
      status: durationMs >= 0 ? "complete" : "invalid_order"
    });
    openArrive = null;
  }

  if (openArrive) {
    sessions.push({
      id: `${openArrive.id}:open`,
      arrive_event_id: openArrive.id,
      leave_event_id: null,
      location: openArrive.location,
      start: openArrive.occurred_at,
      end: null,
      duration_minutes: 0,
      status: "open"
    });
  }

  return sessions;
}

function dateKey(isoDate) {
  return isoDate ? isoDate.slice(0, 10) : "";
}

function summarizeWork(events, now = new Date()) {
  const sessions = pairSessions(events);
  const today = now.toISOString().slice(0, 10);
  const day = now.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));

  const completeSessions = sessions.filter((session) => session.status === "complete");
  const todayMinutes = completeSessions
    .filter((session) => dateKey(session.start) === today)
    .reduce((total, session) => total + session.duration_minutes, 0);
  const weekMinutes = completeSessions
    .filter((session) => new Date(session.start) >= weekStart)
    .reduce((total, session) => total + session.duration_minutes, 0);
  const monthMinutes = completeSessions
    .filter((session) => session.start?.slice(0, 7) === today.slice(0, 7))
    .reduce((total, session) => total + session.duration_minutes, 0);
  const openSession = sessions.findLast((session) => session.status === "open") || null;

  return {
    todayMinutes,
    weekMinutes,
    monthMinutes,
    openSession,
    sessions: sessions.slice(-20).reverse(),
    events: [...events].slice(-30).reverse()
  };
}

export { markWorkEvent, normalizeWorkEvent, pairSessions, summarizeWork };
