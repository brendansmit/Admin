import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const cookieName = "ih_serve_session";
const ttlMs = 1000 * 60 * 60 * 12;
const actionUnlockTtlMs = 1000 * 60 * 15;
const sessions = new Map();
const attempts = new Map();
const actionSecretAttempts = new Map();

function secret() {
  return process.env.SERVE_SESSION_SECRET || process.env.SESSION_SECRET || "dev-serve-session-secret";
}

function password() {
  return process.env.SERVE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "dev-serve-password";
}

function actionSecret() {
  return process.env.SERVE_ACTION_SECRET || "dev-serve-action-secret";
}

function sign(value) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key) {
      cookies[key] = decodeURIComponent(valueParts.join("="));
    }
  }
  return cookies;
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
    }
  }
}

function createSession() {
  const id = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + ttlMs;
  sessions.set(id, { csrf, expiresAt, actionUnlockedUntil: 0 });
  return { cookieValue: `${id}.${sign(id)}`, csrf, expiresAt };
}

function sessionFromRequest(req) {
  clearExpiredSessions();
  const raw = parseCookies(req.headers.cookie)[cookieName];
  if (!raw) {
    return null;
  }

  const [id, signature] = raw.split(".");
  if (!id || !signature || !safeEqual(signature, sign(id))) {
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

function requireCsrf(req, session) {
  const token = req.headers["x-csrf-token"] || "";
  if (!safeEqual(token, session.csrf)) {
    const error = new Error("CSRF check failed");
    error.statusCode = 403;
    throw error;
  }
}

function validatePassword(candidate) {
  return safeEqual(String(candidate || ""), password());
}

function validateActionSecret(candidate) {
  return safeEqual(String(candidate || ""), actionSecret());
}

function actionUnlocked(session) {
  return Boolean(session?.actionUnlockedUntil && session.actionUnlockedUntil > Date.now());
}

function unlockActions(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  session.actionUnlockedUntil = Date.now() + actionUnlockTtlMs;
  return session.actionUnlockedUntil;
}

function requireActionUnlock(session) {
  if (!actionUnlocked(session)) {
    const error = new Error("Action secret required");
    error.statusCode = 423;
    throw error;
  }
}

function cookie(req, value, maxAge = Math.floor(ttlMs / 1000)) {
  const proto = req.headers["x-forwarded-proto"] || "";
  const secure = proto === "https" ? "; Secure" : "";
  return `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function destroySession(req) {
  const raw = parseCookies(req.headers.cookie)[cookieName];
  if (raw) {
    const [id] = raw.split(".");
    sessions.delete(id);
  }
}

function clientIp(req) {
  return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function rateLimitLogin(req) {
  rateLimitMap(attempts, req, 8, "Too many login attempts");
}

function rateLimitActionSecret(req) {
  rateLimitMap(actionSecretAttempts, req, 5, "Too many secret attempts");
}

function rateLimitMap(map, req, maxAttempts, message) {
  const ip = clientIp(req);
  const now = Date.now();
  const windowMs = 1000 * 60 * 10;
  const current = map.get(ip) || { count: 0, resetAt: now + windowMs };
  if (current.resetAt <= now) {
    map.set(ip, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  map.set(ip, current);
  if (current.count > maxAttempts) {
    const error = new Error(message);
    error.statusCode = 429;
    throw error;
  }
}

function clearLoginAttempts(req) {
  attempts.delete(clientIp(req));
}

function requireAccessIdentity(req) {
  const allowed = String(process.env.SERVE_ALLOWED_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) {
    return null;
  }

  const email = String(req.headers["cf-access-authenticated-user-email"] || req.headers["x-authenticated-user-email"] || "")
    .trim()
    .toLowerCase();
  if (!email || !allowed.includes(email)) {
    const error = new Error("Identity not allowed");
    error.statusCode = 403;
    throw error;
  }
  return email;
}

export {
  clearLoginAttempts,
  clientIp,
  cookie,
  createSession,
  destroySession,
  requireAccessIdentity,
  requireActionUnlock,
  requireCsrf,
  requireSession,
  sessionFromRequest,
  actionUnlocked,
  validatePassword,
  validateActionSecret,
  unlockActions,
  rateLimitActionSecret,
  rateLimitLogin
};
