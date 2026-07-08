import test from "node:test";
import assert from "node:assert/strict";
import { printable } from "../runner.js";
import { publicApps } from "../config.js";

test("public app config hides command details", () => {
  const apps = publicApps();
  assert.ok(apps.length > 0);
  assert.equal(Object.hasOwn(apps[0], "restart"), false);
  assert.equal(Object.hasOwn(apps[0], "deploy"), false);
  assert.equal(Object.hasOwn(apps[0], "repoPath"), false);
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
