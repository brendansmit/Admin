import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { updateStore } from "./storage.js";
import {
  createSession,
  destroySession,
  initAuth,
  passwordIsInitial,
  requireSession,
  sessionCookie,
  sessionFromRequest,
  setPassword,
  validatePassword
} from "./auth.js";

// This service used to be the whole admin site. Grade Importer now sits at the
// root of admin.inkheron.app, so all that is left here is the login gate that
// nginx checks with auth_request, the password form behind it, and the
// ServerChan key, which is parked until something is wired to send with it.

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");
const publicDir = join(rootDir, "public");

const port = Number.parseInt(process.env.PORT || "3468", 10);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
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

async function serveLoginPage(res) {
  const body = await readFile(join(publicDir, "login.html"));
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
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

    if (url.pathname === "/api/session" && req.method === "GET") {
      const authenticated = Boolean(sessionFromRequest(req));
      sendJson(res, 200, { authenticated, passwordIsInitial: authenticated && passwordIsInitial() });
      return;
    }

    if (url.pathname === "/api/password" && req.method === "POST") {
      requireSession(req);
      const body = await readJsonBody(req);
      if (!validatePassword(body.currentPassword)) {
        sendJson(res, 401, { error: "invalid_password" });
        return;
      }
      const next = String(body.newPassword || "");
      if (next.length < 8) {
        sendJson(res, 400, { error: "too_short" });
        return;
      }
      await setPassword(next);
      // Changing it closes every session, this one included, so hand back a
      // fresh one rather than bouncing the person who just changed it.
      const session = createSession();
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": sessionCookie(req, session)
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/auth-check" && req.method === "GET") {
      if (sessionFromRequest(req)) {
        res.writeHead(200);
      } else {
        res.writeHead(401);
      }
      res.end();
      return;
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (!validatePassword(body.password)) {
        sendJson(res, 401, { error: "invalid_password" });
        return;
      }

      const session = createSession();
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": sessionCookie(req, session)
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      destroySession(req);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": sessionCookie(req, "", 0)
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/api/settings/serverchan" && req.method === "POST") {
      requireSession(req);
      const body = await readJsonBody(req);
      const sendKey = String(body.sendKey || "").trim();
      await updateStore((store) => {
        store.settings.serverChanSendKey = sendKey;
      });
      sendJson(res, 200, { ok: true, hasServerChanKey: Boolean(sendKey) });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (url.pathname === "/login" || url.pathname === "/login.html") {
      await serveLoginPage(res);
      return;
    }

    // Nothing else is served from here any more. nginx sends the rest of the
    // site to Grade Importer, so anything that lands here is a stale link.
    redirect(res, "/");
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
  // The password and any sessions left over from before a restart have to be
  // loaded before the first request can be judged.
  await initAuth();
  server.listen(port, "127.0.0.1", () => {
    console.log(`InkHeron Admin listening on http://127.0.0.1:${port}`);
  });
}

export { server };
