import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { updateStore } from "./storage.js";
import { markSeen, noticesFor } from "./acting.js";
import {
  clearSessionsFor,
  createSession,
  destroySession,
  initAuth,
  refuseWhileActing,
  requireAdmin,
  requireSession,
  startActing,
  stopActing,
  sessionCookie,
  sessionFromRequest,
  sessionUser,
  validateLogin
} from "./auth.js";
import {
  addUser,
  findById,
  listUsers,
  publicUser,
  removeUser,
  resetUserPassword,
  setUserPassword,
  updateUser,
  validateUserPassword
} from "./users.js";

// This service used to be the whole admin site. Merit now sits at the root of
// admin.inkheron.app, so all that is left here is the login gate that nginx
// checks with auth_request, the accounts behind it, and the ServerChan key,
// which is parked until something is wired to send with it.

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");
const publicDir = join(rootDir, "public");

const port = Number.parseInt(process.env.PORT || "3468", 10);
const minPasswordLength = 8;

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

// A new session on the way out, so whoever just changed a password is not the
// one person the change signs out.
function sendSessionCookie(req, res, userId, payload = { ok: true }) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "set-cookie": sessionCookie(req, createSession(userId))
  });
  res.end(JSON.stringify(payload));
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
      // Deliberately the account that logged in rather than whichever one it is
      // looking at, because this is what the page uses to say who you are.
      const session = sessionFromRequest(req);
      const user = publicUser(session?.user || null);
      sendJson(res, 200, {
        authenticated: Boolean(user),
        user,
        mustChangePassword: Boolean(user?.mustChangePassword),
        passwordIsInitial: Boolean(user?.passwordIsInitial),
        actingAs: session?.acting
          ? { id: session.acting.userId, name: session.acting.user.name, since: session.acting.since }
          : null,
        // Times somebody opened this account. Built from the log rather than
        // from anything the browser that did it chose to report.
        accessNotices: user ? noticesFor(session.userId) : []
      });
      return;
    }

    // Merit asks this one, forwarding the browser's cookie, so it knows whose
    // data to open rather than trusting nginx to have checked something.
    if (url.pathname === "/api/whoami" && req.method === "GET") {
      const session = sessionFromRequest(req);
      const user = sessionUser(req);
      if (!user) {
        sendJson(res, 401, { error: "not_logged_in" });
        return;
      }
      // Merit reads dataset and features off this, so while acting it opens her
      // gradebook with her flags. actingAs is what makes the strip appear.
      sendJson(res, 200, {
        ...user,
        actingAs: session?.acting ? { byName: session.user.name, since: session.acting.since } : null
      });
      return;
    }

    if (url.pathname === "/api/password" && req.method === "POST") {
      const session = refuseWhileActing(requireSession(req));
      const body = await readJsonBody(req);
      if (!validateUserPassword(session.user, body.currentPassword)) {
        sendJson(res, 401, { error: "invalid_password" });
        return;
      }
      const next = String(body.newPassword || "");
      if (next.length < minPasswordLength) {
        sendJson(res, 400, { error: "too_short" });
        return;
      }
      await setUserPassword(session.userId, next);
      // Their other devices are holding sessions opened with the old password.
      // Nobody else's are touched.
      clearSessionsFor(session.userId);
      sendSessionCookie(req, res, session.userId);
      return;
    }

    // The one case where the current password is not asked for: they typed it
    // seconds ago to get here, and the account cannot be used until it changes.
    if (url.pathname === "/api/password/first" && req.method === "POST") {
      const session = refuseWhileActing(requireSession(req));
      if (!session.user.mustChangePassword) {
        sendJson(res, 400, { error: "not_required" });
        return;
      }
      const body = await readJsonBody(req);
      const next = String(body.newPassword || "");
      if (next.length < minPasswordLength) {
        sendJson(res, 400, { error: "too_short" });
        return;
      }
      await setUserPassword(session.userId, next);
      clearSessionsFor(session.userId);
      sendSessionCookie(req, res, session.userId);
      return;
    }

    if (url.pathname === "/api/auth-check" && req.method === "GET") {
      const session = sessionFromRequest(req);
      // A starter password is not a way in. They go back to the login page,
      // which shows them the change-password form instead.
      if (!session || session.user.mustChangePassword) {
        res.writeHead(401);
        res.end();
        return;
      }
      // Handed back in case nginx is ever told to forward it on.
      res.writeHead(200, { "x-merit-user": session.userId });
      res.end();
      return;
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      const user = validateLogin(body.name, body.password);
      if (!user) {
        // A disabled account and a wrong password fail the same way, so the
        // form cannot be used to find out which accounts exist.
        sendJson(res, 401, { error: "invalid_login" });
        return;
      }
      sendSessionCookie(req, res, user.id, {
        ok: true,
        mustChangePassword: Boolean(user.mustChangePassword)
      });
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

    if (url.pathname === "/api/users" && req.method === "GET") {
      const session = refuseWhileActing(requireAdmin(req));
      sendJson(res, 200, { users: listUsers(), you: session.userId });
      return;
    }

    if (url.pathname === "/api/users" && req.method === "POST") {
      refuseWhileActing(requireAdmin(req));
      const body = await readJsonBody(req);
      const user = await addUser({ name: body.name, role: body.role, features: body.features });
      sendJson(res, 200, { ok: true, user });
      return;
    }

    const userRoute = url.pathname.match(/^\/api\/users\/([^/]+)(?:\/(reset))?$/);
    if (userRoute) {
      const session = refuseWhileActing(requireAdmin(req));
      const id = decodeURIComponent(userRoute[1]);
      const action = userRoute[2];

      if (action === "reset" && req.method === "POST") {
        const user = await resetUserPassword(id);
        clearSessionsFor(id);
        sendJson(res, 200, { ok: true, user });
        return;
      }

      if (!action && req.method === "POST") {
        const body = await readJsonBody(req);
        // Taking your own way in is never a mistake worth letting through.
        if (id === session.userId && (body.disabled === true || body.role === "teacher")) {
          sendJson(res, 400, { error: "not_yourself" });
          return;
        }
        const user = await updateUser(id, body);
        if (user.disabled) {
          clearSessionsFor(id);
        }
        sendJson(res, 200, { ok: true, user });
        return;
      }

      if (!action && req.method === "DELETE") {
        if (id === session.userId) {
          sendJson(res, 400, { error: "not_yourself" });
          return;
        }
        await removeUser(id);
        clearSessionsFor(id);
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    // ── Opening somebody else's account ───────────────────────────────────────
    // Inside my own session, so there is no second password to keep anywhere.
    // The account being opened is told afterwards, from the log.

    if (url.pathname === "/api/act-as/stop" && req.method === "POST") {
      const session = requireSession(req);
      sendJson(res, 200, { ok: true, stopped: stopActing(session.id) });
      return;
    }

    const actRoute = url.pathname.match(/^\/api\/act-as\/([^/]+)$/);
    if (actRoute && req.method === "POST") {
      const session = refuseWhileActing(requireAdmin(req));
      const id = decodeURIComponent(actRoute[1]);
      const target = findById(id);
      if (!target || target.disabled) {
        sendJson(res, 404, { error: "no_such_user" });
        return;
      }
      if (target.id === session.userId) {
        sendJson(res, 400, { error: "not_yourself" });
        return;
      }
      // An admin is not a support case, and opening one would be a way to reach
      // the accounts page as somebody else.
      if (target.role === "admin") {
        sendJson(res, 400, { error: "not_an_admin" });
        return;
      }
      const since = startActing(session.id, target, session.user);
      sendJson(res, 200, { ok: true, name: target.name, since });
      return;
    }

    if (url.pathname === "/api/access-notices/seen" && req.method === "POST") {
      const session = refuseWhileActing(requireSession(req));
      sendJson(res, 200, { ok: true, changed: markSeen(session.userId) });
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
    // site to Merit, so anything that lands here is a stale link.
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
  // The accounts and any sessions left over from before a restart have to be
  // loaded before the first request can be judged.
  await initAuth();
  server.listen(port, "127.0.0.1", () => {
    console.log(`InkHeron Admin listening on http://127.0.0.1:${port}`);
  });
}

export { server };
