import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { readStore, updateStore } from "./storage.js";

const sessionCookieName = "ih_admin_session";
const sessions = new Map();
const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;

function cookieSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || "dev-session-secret";
}

// The password used to live in the pm2 env file, which meant changing it meant
// editing a config and restarting. It now lives in the store as a scrypt hash,
// so the Settings page can change it. Delete the "auth" block from store.json
// to put it back to the initial password below.
const initialPassword = "ChangeMe1";

let passwordHash = null;

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(String(password), salt, 64).toString("hex")}`;
}

function hashMatches(password, stored) {
  const [salt, digest] = String(stored || "").split(":");
  if (!salt || !digest) {
    return false;
  }
  return constantTimeEqual(scryptSync(String(password), salt, 64).toString("hex"), digest);
}

function sign(value) {
  return createHmac("sha256", cookieSecret()).update(value).digest("base64url");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
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

function createSession() {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionTtlMs;
  sessions.set(id, { expiresAt });
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

  return { id, ...session };
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

function validatePassword(password) {
  return hashMatches(password, passwordHash);
}

async function setPassword(password) {
  const next = hashPassword(password);
  await updateStore((store) => {
    store.auth = { ...(store.auth || {}), passwordHash: next, updatedAt: new Date().toISOString() };
  });
  passwordHash = next;
  // Every other device is now holding a session that was opened with the old
  // password, so none of them should stay open.
  sessions.clear();
  await persistSessions();
}

function passwordIsInitial() {
  return hashMatches(initialPassword, passwordHash);
}

/**
 * Loads the password and any sessions left over from before a restart. Must be
 * awaited before the server starts listening.
 */
async function initAuth() {
  const store = await readStore();
  passwordHash = store.auth?.passwordHash || null;
  if (!passwordHash) {
    await setPassword(initialPassword);
  }
  const now = Date.now();
  for (const session of store.sessions || []) {
    if (session?.id && session.expiresAt > now) {
      sessions.set(session.id, { expiresAt: session.expiresAt });
    }
  }
}

async function persistSessions() {
  // Sessions used to live only in memory, so every restart signed you out and
  // asked for the password again. They now survive one.
  const open = [...sessions.entries()].map(([id, session]) => ({ id, expiresAt: session.expiresAt }));
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

export { createSession, destroySession, initAuth, passwordIsInitial, requireSession, sessionCookie, sessionFromRequest, setPassword, validatePassword };

