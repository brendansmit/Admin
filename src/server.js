import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readStore, updateStore } from "./storage.js";
import { markWorkEvent, normalizeWorkEvent, summarizeWork } from "./work-log.js";
import { dueReminderEvents, formatReminderMessage, normalizeCalendarEvent, upcomingEvents } from "./calendar.js";
import { sendServerChan } from "./serverchan.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");
const publicDir = join(rootDir, "public");

const port = Number.parseInt(process.env.PORT || "3468", 10);
const webhookToken = process.env.WEBHOOK_TOKEN || "dev-webhook-token";
const adminToken = process.env.ADMIN_TOKEN || "dev-admin-token";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : "";
}

function requireToken(req, expectedToken) {
  if (bearerToken(req) !== expectedToken) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    error.statusCode = 400;
    error.message = "Invalid JSON";
    throw error;
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const cleanPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const relativePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^[/\\]/, "");
  const filePath = join(publicDir, relativePath);

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream"
    });
    res.end(body);
  } catch (error) {
    if (relativePath !== "index.html") {
      sendText(res, 404, "Not found");
      return;
    }
    throw error;
  }
}

function formatChinaTime(isoDate) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai"
  }).format(new Date(isoDate));
}

function formatArrivalMessage(event) {
  return [
    "Arrived at work",
    "",
    `Location: ${event.location}`,
    `Device: ${event.device || "Unknown"}`,
    `Time: ${formatChinaTime(event.occurred_at)}`
  ].join("\n");
}

async function notifyArrivalIfNeeded(sendKey, event) {
  if (!sendKey || event.duplicate || event.event_type !== "arrive") {
    return { sent: false };
  }

  try {
    await sendServerChan(sendKey, "Arrived at work", formatArrivalMessage(event));
    return { sent: true };
  } catch (error) {
    console.error("ServerChan arrival notification failed:", error.message);
    return { sent: false, error: "serverchan_failed" };
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        app: "inkheron-admin",
        now: new Date().toISOString()
      });
      return;
    }

    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      const store = await readStore();
      const summary = summarizeWork(store.workEvents);
      const reminders = upcomingEvents(store.calendarEvents);
      sendJson(res, 200, {
        ...summary,
        reminders,
        nextReminder: reminders[0] || null,
        settings: {
          hasServerChanKey: Boolean(store.settings.serverChanSendKey)
        }
      });
      return;
    }

    if (url.pathname === "/api/work-log" && req.method === "POST") {
      requireToken(req, webhookToken);
      const body = await readJsonBody(req);
      const result = await updateStore((store) => {
        const event = markWorkEvent(store, normalizeWorkEvent(body));
        return {
          event,
          serverChanSendKey: store.settings.serverChanSendKey
        };
      });
      const notification = await notifyArrivalIfNeeded(result.serverChanSendKey, result.event);
      sendJson(res, result.event.duplicate ? 202 : 201, { event: result.event, notification });
      return;
    }

    if (url.pathname === "/api/work-events" && req.method === "POST") {
      requireToken(req, adminToken);
      const body = await readJsonBody(req);
      const event = await updateStore((store) =>
        markWorkEvent(store, normalizeWorkEvent({ ...body, source: body.source || "manual_admin" }))
      );
      sendJson(res, 201, { event });
      return;
    }

    if (url.pathname === "/api/calendar-events" && req.method === "POST") {
      requireToken(req, adminToken);
      const body = await readJsonBody(req);
      const event = normalizeCalendarEvent(body);
      await updateStore((store) => {
        store.calendarEvents.push(event);
      });
      sendJson(res, 201, { event });
      return;
    }

    if (url.pathname === "/api/settings/serverchan" && req.method === "POST") {
      requireToken(req, adminToken);
      const body = await readJsonBody(req);
      const sendKey = String(body.sendKey || "").trim();
      await updateStore((store) => {
        store.settings.serverChanSendKey = sendKey;
      });
      sendJson(res, 200, { ok: true, hasServerChanKey: Boolean(sendKey) });
      return;
    }

    if (url.pathname === "/api/notifications/run" && req.method === "POST") {
      requireToken(req, adminToken);
      const result = await updateStore(async (store) => {
        const dueEvents = dueReminderEvents(store.calendarEvents, store.notificationLog);
        if (!dueEvents.length) {
          return { sent: 0, events: [] };
        }

        const message = formatReminderMessage(dueEvents);
        await sendServerChan(store.settings.serverChanSendKey, "InkHeron reminders", message);
        const sentAt = new Date().toISOString();
        const sentOn = sentAt.slice(0, 10);
        for (const event of dueEvents) {
          store.notificationLog.push({
            id: randomUUID(),
            calendar_event_id: event.id,
            reminder_for: event.date,
            sent_at: sentAt,
            sent_on: sentOn,
            title: event.title
          });
        }
        return { sent: dueEvents.length, events: dueEvents };
      });
      sendJson(res, 200, result);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    if (error.statusCode) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    console.error(error);
    sendJson(res, 500, { error: "server_error" });
  }
});

if (process.env.NODE_ENV !== "test") {
  server.listen(port, "127.0.0.1", () => {
    console.log(`InkHeron Admin listening on http://127.0.0.1:${port}`);
  });
}

export { server };
