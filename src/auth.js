import { createHmac, randomBytes } from "node:crypto";

import { closeAccess, initAccessLog, openAccess } from "./acting.js";
import { constantTimeEqual } from "./passwords.js";
import { readStore, updateStore } from "./storage.js";
import { findById, initUsers, listUsers, publicUser, validateLogin } from "./users.js";

const sessionCookieName = "ih_admin_session";
const sessions = new Map();
const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;

function cookieSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || "dev-session-secret";
}

function sign(value) {
  return createHmac("sha256", cookieSecret()).update(value).digest("base64url");
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (!key) {
      continue;
    }
    cookies[key] = decodeURIComponent(valueParts.join("="));
  }
  return cookies;
}

// A session belongs to one account now, so signing one person out leaves
// everybody else where they were.
function createSession(userId) {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionTtlMs;
  sessions.set(id, { expiresAt, userId });
  savingSessions();
  return `${id}.${sign(id)}`;
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      // A browser that was simply closed never asked to stop, so the row is
      // closed here instead of being left open for a fortnight.
      if (session.accessId) {
        closeAccess(session.accessId);
      }
      sessions.delete(id);
    }
  }
}

/** Closes every session of one account and leaves the rest alone. */
function clearSessionsFor(userId) {
  for (const [id, session] of sessions) {
    if (session.userId === userId) {
      if (session.accessId) {
        closeAccess(session.accessId);
      }
      sessions.delete(id);
    }
  }
  savingSessions();
}

function sessionFromRequest(req) {
  clearExpiredSessions();
  const raw = parseCookies(req.headers.cookie)[sessionCookieName];
  if (!raw) {
    return null;
  }

  const [id, signature] = raw.split(".");
  if (!id || !signature || !constantTimeEqual(signature, sign(id))) {
    return null;
  }

  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }

  // An account that has been deleted or switched off stops being a way in the
  // moment it changes, without waiting for the cookie to run out.
  const user = findById(session.userId);
  if (!user || user.disabled) {
    sessions.delete(id);
    savingSessions();
    return null;
  }

  // Whose account this session is looking at, when that is not its own. The
  // session still belongs to whoever logged in: acting is a view, never a way
  // to become somebody, so nothing below reads role off the borrowed account.
  let acting = null;
  if (session.actingAs) {
    const target = findById(session.actingAs);
    if (target && !target.disabled) {
      acting = { userId: target.id, user: target, since: session.actingSince, accessId: session.accessId };
    } else {
      // Deleted or switched off while I was in there. The view ends by itself
      // rather than falling back to my own account without saying so.
      stopActing(id);
    }
  }

  return { id, expiresAt: session.expiresAt, userId: session.userId, user, acting };
}

// ── Opening somebody else's account ───────────────────────────────────────────
// An admin looks at a teacher's Merit from inside their own session. No second
// password, no second login, and the account being looked at is told afterwards.

function startActing(sessionId, target, by) {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  if (session.actingAs) {
    stopActing(sessionId);
  }
  session.actingAs = target.id;
  session.actingSince = new Date().toISOString();
  session.accessId = openAccess({ byId: by.id, byName: by.name, userId: target.id });
  savingSessions();
  return session.actingSince;
}

function stopActing(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || !session.actingAs) {
    return false;
  }
  if (session.accessId) {
    closeAccess(session.accessId);
  }
  delete session.actingAs;
  delete session.actingSince;
  delete session.accessId;
  savingSessions();
  return true;
}

/** Refuses anything an account should only do as itself. */
function refuseWhileActing(session) {
  if (session?.acting) {
    // A code rather than a sentence, because the page turns it into one.
    const error = new Error("acting");
    error.statusCode = 409;
    throw error;
  }
  return session;
}

function requireSession(req) {
  const session = sessionFromRequest(req);
  if (!session) {
    const error = new Error("Login required");
    error.statusCode = 401;
    throw error;
  }
  return session;
}

function requireAdmin(req) {
  const session = requireSession(req);
  if (session.user.role !== "admin") {
    const error = new Error("Not allowed");
    error.statusCode = 403;
    throw error;
  }
  return session;
}

/**
 * Loads the accounts and any sessions left over from before a restart. Must be
 * awaited before the server starts listening.
 */
async function initAuth() {
  await initUsers();
  await initAccessLog();
  const store = await readStore();
  const now = Date.now();
  // Sessions from before accounts existed carry no owner. They belong to the
  // one account the shared password became, so a deploy does not sign me out.
  const fallback = listUsers().find((user) => user.role === "admin")?.id || null;
  for (const session of store.sessions || []) {
    if (session?.id && session.expiresAt > now) {
      sessions.set(session.id, {
        expiresAt: session.expiresAt,
        userId: session.userId || fallback,
        actingAs: session.actingAs,
        actingSince: session.actingSince,
        accessId: session.accessId
      });
    }
  }
  await persistSessions();
}

async function persistSessions() {
  // Sessions used to live only in memory, so every restart signed you out and
  // asked for the password again. They now survive one.
  const open = [...sessions.entries()].map(([id, session]) => ({
    id,
    expiresAt: session.expiresAt,
    userId: session.userId,
    actingAs: session.actingAs,
    actingSince: session.actingSince,
    accessId: session.accessId
  }));
  await updateStore((store) => {
    store.sessions = open;
  });
}

function savingSessions() {
  persistSessions().catch((error) => {
    console.error("Could not save sessions", error);
  });
}

function sessionCookie(req, value, maxAge = Math.floor(sessionTtlMs / 1000)) {
  const proto = req.headers["x-forwarded-proto"] || "";
  const secure = proto === "https" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function destroySession(req) {
  const raw = parseCookies(req.headers.cookie)[sessionCookieName];
  if (raw) {
    const [id] = raw.split(".");
    const session = sessions.get(id);
    if (session?.accessId) {
      closeAccess(session.accessId);
    }
    sessions.delete(id);
    savingSessions();
  }
}

/** The account this session is looking at, which is its own unless acting. */
function sessionUser(req) {
  const session = sessionFromRequest(req);
  return publicUser(session?.acting?.user || session?.user || null);
}

export {
  clearSessionsFor,
  refuseWhileActing,
  startActing,
  stopActing,
  createSession,
  destroySession,
  initAuth,
  requireAdmin,
  requireSession,
  sessionCookie,
  sessionFromRequest,
  sessionUser,
  validateLogin
};
