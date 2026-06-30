import { randomUUID } from "node:crypto";

const duplicateWindowMs = 15 * 60 * 1000;
const shortSessionMs = 2 * 60 * 1000;
const defaultTimeZone = process.env.ADMIN_TIME_ZONE || "Asia/Shanghai";

function cleanInput(input) {
  return Object.fromEntries(
    Object.entries(input || {}).map(([key, value]) => [String(key).trim(), typeof value === "string" ? value.trim() : value])
  );
}

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
  const cleaned = cleanInput(input);
  const eventType = String(cleaned.event || cleaned.event_type || "").trim().toLowerCase();

  if (!["arrive", "leave"].includes(eventType)) {
    const error = new Error("event must be arrive or leave");
    error.statusCode = 400;
    throw error;
  }

  return {
    id: randomUUID(),
    event_type: eventType,
    location: String(cleaned.location || "work").trim() || "work",
    occurred_at: parseDate(cleaned.occurred_at, receivedAt).toISOString(),
    received_at: receivedAt.toISOString(),
    source: String(cleaned.source || "unknown").trim() || "unknown",
    device: cleaned.device ? String(cleaned.device).trim() : "",
    lat: Number.isFinite(Number(cleaned.lat)) ? Number(cleaned.lat) : null,
    lon: Number.isFinite(Number(cleaned.lon)) ? Number(cleaned.lon) : null,
    duplicate: false,
    ignored: false,
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
    .filter((event) => !event.duplicate && !event.ignored)
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  const openByLocation = new Map();

  function pushSession(session) {
    sessions.push(session);
  }

  for (const event of sorted) {
    const location = event.location || "work";
    const openArrive = openByLocation.get(location) || null;

    if (event.event_type === "arrive") {
      if (openArrive) {
        pushSession({
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
      openByLocation.set(location, event);
      continue;
    }

    if (!openArrive) {
      pushSession({
        id: `${event.id}:orphan`,
        arrive_event_id: null,
        leave_event_id: event.id,
        location,
        start: null,
        end: event.occurred_at,
        duration_minutes: 0,
        status: "missing_arrive"
      });
      continue;
    }

    const durationMs = new Date(event.occurred_at) - new Date(openArrive.occurred_at);
    pushSession({
      id: `${openArrive.id}:${event.id}`,
      arrive_event_id: openArrive.id,
      leave_event_id: event.id,
      location: openArrive.location,
      start: openArrive.occurred_at,
      end: event.occurred_at,
      duration_minutes: Math.max(0, Math.round(durationMs / 60000)),
      status: durationMs >= 0 ? "complete" : "invalid_order",
      warning: durationMs >= 0 && durationMs < shortSessionMs ? "Arrive and leave are less than 2 minutes apart" : ""
    });
    openByLocation.delete(location);
  }

  for (const openArrive of openByLocation.values()) {
    pushSession({
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

  return sessions.sort((a, b) => new Date(a.start || a.end) - new Date(b.start || b.end));
}

function localParts(date, timeZone = defaultTimeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function localDateKey(value, timeZone = defaultTimeZone) {
  if (!value) {
    return "";
  }
  const parts = localParts(new Date(value), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localMonthKey(value, timeZone = defaultTimeZone) {
  return localDateKey(value, timeZone).slice(0, 7);
}

function localWeekStartKey(now, timeZone = defaultTimeZone) {
  const parts = localParts(now, timeZone);
  const localUtcDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const day = localUtcDate.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  localUtcDate.setUTCDate(localUtcDate.getUTCDate() - daysSinceMonday);
  return localUtcDate.toISOString().slice(0, 10);
}

function effectiveSessionMinutes(session, now) {
  if (session.status === "complete") {
    return session.duration_minutes;
  }
  if (session.status !== "open" || !session.start) {
    return 0;
  }
  const durationMs = now - new Date(session.start);
  return Math.max(0, Math.round(durationMs / 60000));
}

function summarizeWork(events, now = new Date(), timeZone = defaultTimeZone) {
  const sessions = pairSessions(events);
  const today = localDateKey(now, timeZone);
  const weekStart = localWeekStartKey(now, timeZone);
  const month = today.slice(0, 7);
  const billableSessions = sessions.filter((session) => ["complete", "open"].includes(session.status));
  const todayMinutes = billableSessions
    .filter((session) => localDateKey(session.start, timeZone) === today)
    .reduce((total, session) => total + effectiveSessionMinutes(session, now), 0);
  const weekMinutes = billableSessions
    .filter((session) => localDateKey(session.start, timeZone) >= weekStart)
    .reduce((total, session) => total + effectiveSessionMinutes(session, now), 0);
  const monthMinutes = billableSessions
    .filter((session) => localMonthKey(session.start, timeZone) === month)
    .reduce((total, session) => total + effectiveSessionMinutes(session, now), 0);
  const openSession = sessions.findLast((session) => session.status === "open") || null;
  const warningSessions = sessions.filter((session) => session.status !== "complete" || session.warning);

  return {
    todayMinutes,
    weekMinutes,
    monthMinutes,
    openSession,
    warningSessions,
    timeZone,
    sessions: sessions.slice(-20).reverse(),
    events: [...events].slice(-30).reverse()
  };
}

function setWorkEventIgnored(store, eventId, ignored) {
  const event = store.workEvents.find((candidate) => candidate.id === eventId);
  if (!event) {
    const error = new Error("Work event not found");
    error.statusCode = 404;
    throw error;
  }
  event.ignored = Boolean(ignored);
  return event;
}

export { markWorkEvent, normalizeWorkEvent, pairSessions, setWorkEventIgnored, summarizeWork };
