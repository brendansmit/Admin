import { createHmac, randomBytes } from "node:crypto";

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
      sessions.delete(id);
    }
  }
}

/** Closes every session of one account and leaves the rest alone. */
function clearSessionsFor(userId) {
  for (const [id, session] of sessions) {
    if (session.userId === userId) {
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

  return { id, expiresAt: session.expiresAt, userId: session.userId, user };
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
  const store = await readStore();
  const now = Date.now();
  // Sessions from before accounts existed carry no owner. They belong to the
  // one account the shared password became, so a deploy does not sign me out.
  const fallback = listUsers().find((user) => user.role === "admin")?.id || null;
  for (const session of store.sessions || []) {
    if (session?.id && session.expiresAt > now) {
      sessions.set(session.id, { expiresAt: session.expiresAt, userId: session.userId || fallback });
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
    userId: session.userId
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
    sessions.delete(id);
    savingSessions();
  }
}

function sessionUser(req) {
  return publicUser(sessionFromRequest(req)?.user || null);
}

export {
  clearSessionsFor,
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
