import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "./audit.js";
import { getApp, publicApps } from "./config.js";
import {
  clearLoginAttempts,
  cookie,
  createSession,
  destroySession,
  rateLimitLogin,
  requireAccessIdentity,
  requireCsrf,
  requireSession,
  sessionFromRequest,
  validatePassword
} from "./auth.js";
import { runSequence, runStep } from "./runner.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number.parseInt(process.env.PORT || "3469", 10);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function securityHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    ...extra
  };
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, securityHeaders({ "content-type": "application/json; charset=utf-8", ...headers }));
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, securityHeaders({ location }));
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

async function serveStatic(req, res, authenticated) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const cleanPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const relativePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^[/\\]/, "");
  const publicLoginFiles = new Set(["login.html", "login.js", "styles.css"]);

  if (!authenticated && !publicLoginFiles.has(relativePath)) {
    redirect(res, "/login");
    return;
  }

  const requestedPath = relativePath === "login" ? "login.html" : relativePath;
  const filePath = join(publicDir, requestedPath);
  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, securityHeaders({
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream"
    }));
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
}

function appFromUrl(url) {
  const key = url.searchParams.get("app") || "";
  const app = getApp(key);
  if (!app) {
    const error = new Error("Unknown app");
    error.statusCode = 404;
    throw error;
  }
  return { key, app };
}

async function statusFor(app) {
  let health = { online: false, detail: "health check failed" };
  try {
    const response = await fetch(app.healthUrl, { signal: AbortSignal.timeout(6000) });
    health = { online: response.status < 400, detail: `HTTP ${response.status}` };
  } catch (error) {
    health = { online: false, detail: error.message };
  }

  if (health.online) {
    return health;
  }

  const processStatus = await runStep(app.status, 15000);
  return {
    online: processStatus.ok,
    detail: processStatus.ok ? "process active" : health.detail,
    processOutput: processStatus.output
  };
}

const server = createServer(async (req, res) => {
  try {
    requireAccessIdentity(req);
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const session = sessionFromRequest(req);

    if (url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, app: "inkheron-serve", now: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/api/session" && req.method === "GET") {
      sendJson(res, 200, { authenticated: Boolean(session), csrfToken: session?.csrf || null });
      return;
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      rateLimitLogin(req);
      const body = await readJsonBody(req);
      if (!validatePassword(body.password)) {
        await audit(req, { action: "login", success: false });
        sendJson(res, 401, { error: "invalid_password" });
        return;
      }
      clearLoginAttempts(req);
      const nextSession = createSession();
      await audit(req, { action: "login", success: true });
      sendJson(res, 200, { ok: true, csrfToken: nextSession.csrf }, {
        "set-cookie": cookie(req, nextSession.cookieValue)
      });
      return;
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      const activeSession = requireSession(req);
      requireCsrf(req, activeSession);
      destroySession(req);
      sendJson(res, 200, { ok: true }, { "set-cookie": cookie(req, "", 0) });
      return;
    }

    if (url.pathname === "/api/apps" && req.method === "GET") {
      requireSession(req);
      sendJson(res, 200, { apps: publicApps() });
      return;
    }

    if (url.pathname === "/api/status" && req.method === "GET") {
      requireSession(req);
      const { key, app } = appFromUrl(url);
      const status = await statusFor(app);
      sendJson(res, 200, { key, label: app.label, host: app.host, ...status });
      return;
    }

    if (url.pathname === "/api/logs" && req.method === "GET") {
      requireSession(req);
      const { key, app } = appFromUrl(url);
      const result = await runStep(app.logs, 20000);
      await audit(req, { action: "logs", app: key, success: result.ok });
      sendJson(res, 200, { success: result.ok, output: result.output });
      return;
    }

    const actionMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/(restart|deploy)$/);
    if (actionMatch && req.method === "POST") {
      const activeSession = requireSession(req);
      requireCsrf(req, activeSession);
      const [, key, action] = actionMatch;
      const app = getApp(key);
      if (!app) {
        sendJson(res, 404, { error: "unknown_app" });
        return;
      }
      const body = await readJsonBody(req);
      if (body.confirm !== app.host) {
        sendJson(res, 400, { error: "confirmation_required", expected: app.host });
        return;
      }

      const result = action === "restart"
        ? await runSequence([app.restart])
        : await runSequence(app.deploy);
      await audit(req, { action, app: key, success: result.ok });
      sendJson(res, 200, { success: result.ok, output: result.output });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (url.pathname === "/login") {
      await serveStatic(req, res, true);
      return;
    }

    await serveStatic(req, res, Boolean(session));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (!error.statusCode) {
      console.error(error);
    }
    sendJson(res, statusCode, { error: error.statusCode ? error.message : "server_error" });
  }
});

if (process.env.NODE_ENV !== "test") {
  server.listen(port, "127.0.0.1", () => {
    console.log(`InkHeron Serve listening on http://127.0.0.1:${port}`);
  });
}

export { server };
