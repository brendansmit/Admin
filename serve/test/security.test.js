import test from "node:test";
import assert from "node:assert/strict";
import { printable } from "../runner.js";
import { apps as appConfig, droplets, publicApps } from "../config.js";

test("public app config hides command details", () => {
  const apps = publicApps();
  assert.ok(apps.length > 0);
  assert.equal(Object.hasOwn(apps[0], "restart"), false);
  assert.equal(Object.hasOwn(apps[0], "deploy"), false);
  assert.equal(Object.hasOwn(apps[0], "repoPath"), false);
});

test("every app belongs to a known droplet", () => {
  for (const app of publicApps()) {
    assert.ok(droplets[app.droplet], `${app.key} has no droplet`);
  }
});

test("an app that cannot deploy or restart explains why", () => {
  // The panel greys the button and shows the note. A blocked action with no
  // note would render as a dead button with no reason given.
  for (const app of publicApps()) {
    if (!app.canDeploy) {
      assert.ok(app.deployNote, `${app.key} blocks deploy without a note`);
    }
    if (!app.canRestart) {
      assert.ok(app.restartNote, `${app.key} blocks restart without a note`);
    }
  }
});

test("no configured step is passed through a shell", () => {
  // runner.js spawns with shell:false, so an app that smuggled a shell string
  // into a step would silently stop being injection-safe.
  const steps = [];
  for (const app of Object.values(appConfig)) {
    steps.push(app.status, app.logs, app.restart, ...(app.deploy || []));
  }
  for (const step of steps.filter(Boolean)) {
    assert.equal(typeof step.command, "string");
    assert.ok(Array.isArray(step.args), `${step.command} has non-array args`);
  }
});

test("command rendering does not require shell strings", () => {
  assert.equal(printable({ command: "pm2", args: ["restart", "inkpad"] }), "pm2 restart inkpad");
});

test("dangerous actions require action secret unlock", async () => {
  process.env.NODE_ENV = "test";
  process.env.SERVE_ADMIN_PASSWORD = "test-admin-password";
  process.env.SERVE_ACTION_SECRET = "test-action-secret";
  const { server } = await import("../server.js");

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "test-admin-password" })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const { csrfToken } = await login.json();

    const locked = await fetch(`${baseUrl}/api/apps/admin/restart`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({ confirm: "admin.inkheron.app" })
    });
    assert.equal(locked.status, 423);

    const wrongSecret = await fetch(`${baseUrl}/api/action-unlock`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({ secret: "wrong" })
    });
    assert.equal(wrongSecret.status, 401);

    const unlocked = await fetch(`${baseUrl}/api/action-unlock`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({ secret: "test-action-secret" })
    });
    assert.equal(unlocked.status, 200);

    const confirmationGuard = await fetch(`${baseUrl}/api/apps/admin/restart`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({ confirm: "wrong-host" })
    });
    assert.equal(confirmationGuard.status, 400);

    // An app with no git remote on its droplet must be refused before
    // anything is spawned, with the reason, not by handing the runner an
    // undefined step.
    const blockedDeploy = await fetch(`${baseUrl}/api/apps/inkpad/deploy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({ confirm: "inkpad.inkheron.app" })
    });
    assert.equal(blockedDeploy.status, 409);
    const blockedDeployBody = await blockedDeploy.json();
    assert.equal(blockedDeployBody.error, "deploy_unavailable");
    assert.ok(blockedDeployBody.message.length > 0);

    // This panel cannot restart itself: the restart would kill the request.
    const blockedRestart = await fetch(`${baseUrl}/api/apps/serve/restart`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": cookie,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({ confirm: "serve.inkheron.app" })
    });
    assert.equal(blockedRestart.status, 409);
    assert.equal((await blockedRestart.json()).error, "restart_unavailable");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
