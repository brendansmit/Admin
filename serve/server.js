import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "./audit.js";
import {
  apps,
  droplet1Warm,
  droplets,
  getApp,
  localOnlyTools,
  publicApps,
  sshMuxDir
} from "./config.js";
import {
  actionUnlocked,
  clearLoginAttempts,
  cookie,
  createSession,
  destroySession,
  rateLimitActionSecret,
  rateLimitLogin,
  requireActionUnlock,
  requireAccessIdentity,
  requireCsrf,
  requireSession,
  sessionFromRequest,
  unlockActions,
  validateActionSecret,
  validatePassword
} from "./auth.js";
import { runSequence, runStep } from "./runner.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number.parseInt(process.env.PORT || "3469", 10);
// Loopback by default, so nothing changes for a local run. On droplet 2 the
// TLS terminator is Caddy inside Docker, which reaches the host across a
// bridge network and so cannot see 127.0.0.1. That deployment sets
// SERVE_BIND=0.0.0.0 and relies on ufw to allow port 3469 from the Docker
// subnets only.
const bindHost = process.env.SERVE_BIND || "127.0.0.1";

// ssh refuses to create a control socket in a directory that does not exist.
mkdirSync(sshMuxDir, { recursive: true, mode: 0o700 });

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
  // Two independent signals: does the public URL answer, and is the process
  // running. A process that is up while its site does not answer is degraded,
  // not online, and reporting it as online hides a real outage.
  let unreachable = null;
  if (app.healthUrl) {
    try {
      const response = await fetch(app.healthUrl, { signal: AbortSignal.timeout(10000) });
      if (response.status >= 400) {
        unreachable = `HTTP ${response.status}`;
      }
    } catch (error) {
      unreachable = error.message;
    }
  }

  const processStatus = await runStep(app.status, 20000);
  // Some checks cannot report failure through an exit code. "docker compose
  // ps" is happy either way and just prints nothing when the container is
  // down, so those steps declare requireOutput and an empty answer counts as
  // down rather than healthy.
  const processOk = processStatus.ok
    && (!app.status.requireOutput || processStatus.output.trim().length > 0);

  let detail;
  if (!processOk) {
    detail = unreachable || "process not active";
  } else if (unreachable) {
    detail = `process up, site unreachable (${unreachable})`;
  } else {
    detail = app.healthUrl ? "online" : "process active";
  }

  return {
    online: processOk && !unreachable,
    degraded: Boolean(processOk && unreachable),
    detail,
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
      sendJson(res, 200, {
        authenticated: Boolean(session),
        csrfToken: session?.csrf || null,
        actionsUnlocked: actionUnlocked(session),
        actionUnlockExpiresAt: session?.actionUnlockedUntil || null
      });
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

    if (url.pathname === "/api/action-unlock" && req.method === "POST") {
      const activeSession = requireSession(req);
      requireCsrf(req, activeSession);
      rateLimitActionSecret(req);
      const body = await readJsonBody(req);
      if (!validateActionSecret(body.secret)) {
        await audit(req, { action: "action_unlock", success: false });
        sendJson(res, 401, { error: "invalid_secret" });
        return;
      }
      const expiresAt = unlockActions(activeSession.id);
      await audit(req, { action: "action_unlock", success: true });
      sendJson(res, 200, { ok: true, actionsUnlocked: true, actionUnlockExpiresAt: expiresAt });
      return;
    }

    if (url.pathname === "/api/apps" && req.method === "GET") {
      requireSession(req);
      sendJson(res, 200, { apps: publicApps(), droplets, localOnlyTools });
      return;
    }

    if (url.pathname === "/api/status" && req.method === "GET") {
      requireSession(req);
      const { key, app } = appFromUrl(url);
      const status = await statusFor(app);
      sendJson(res, 200, { key, label: app.label, host: app.host, ...status });
      return;
    }

    if (url.pathname === "/api/status-all" && req.method === "GET") {
      requireSession(req);
      // Warm the shared ssh connection first, then check everything at once.
      // One request for the whole grid: the browser caps concurrent requests
      // per host at around six, so a dot per request left the last few queued
      // behind the slow ssh calls.
      await runStep(droplet1Warm, 15000);
      const entries = Object.entries(apps);
      const results = await Promise.all(entries.map(async ([key, app]) => {
        try {
          const { online, degraded, detail } = await statusFor(app);
          return [key, { online, degraded, detail }];
        } catch (error) {
          return [key, { online: false, degraded: false, detail: error.message }];
        }
      }));
      sendJson(res, 200, Object.fromEntries(results));
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
      requireActionUnlock(activeSession);
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

      // Not every app supports both actions. mosaic has nothing to pull, the
      // rsync apps have no git remote on their droplet, and this panel cannot
      // restart itself. Refuse those before spawning anything, so a missing
      // step never reaches the runner as undefined.
      const steps = action === "restart"
        ? (app.restart ? [app.restart] : null)
        : (Array.isArray(app.deploy) ? app.deploy : null);
      if (!steps) {
        const note = action === "restart" ? app.restartNote : app.deployNote;
        await audit(req, { action, app: key, success: false, detail: "unsupported" });
        sendJson(res, 409, {
          error: `${action}_unavailable`,
          message: note || `${action} is not configured for this app.`
        });
        return;
      }

      const result = await runSequence(steps);
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
  server.listen(port, bindHost, () => {
    console.log(`InkHeron Serve listening on http://${bindHost}:${port}`);
  });
}

export { server };
