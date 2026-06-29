import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const sessionCookieName = "ih_admin_session";
const sessions = new Map();
const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;

function cookieSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || "dev-session-secret";
}

function adminPassword() {
  return process.env.ADMIN_PASSWORD || "dev-admin-password";
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
  return constantTimeEqual(String(password || ""), adminPassword());
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
  }
}

export { createSession, destroySession, requireSession, sessionCookie, sessionFromRequest, validatePassword };

