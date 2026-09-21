import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The whole gate is exercised over HTTP against a throwaway store, because the
// things worth checking here are about cookies, status codes and who is turned
// away, none of which show up in a unit test of one function.

const dir = await mkdtemp(join(tmpdir(), "merit-admin-"));
process.env.ADMIN_DATA_PATH = join(dir, "store.json");
process.env.SESSION_SECRET = "test-secret";
process.env.ADMIN_USER_NAME = "Brendan";
process.env.NODE_ENV = "test";

const { server } = await import("../src/server.js");
const { initAuth } = await import("../src/auth.js");

let base = "";

before(async () => {
  await initAuth();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

function cookieFrom(response) {
  return (response.headers.get("set-cookie") || "").split(";")[0];
}

async function call(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (cookie) {
    headers.cookie = cookie;
  }
  return fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
}

async function login(name, password) {
  const response = await call("/api/login", { method: "POST", body: { name, password } });
  return { response, cookie: cookieFrom(response), body: await response.json().catch(() => ({})) };
}

let ownerCookie = "";

test("the shared password becomes one admin account", async () => {
  const { response, cookie, body } = await login("Brendan", "ChangeMe1");
  assert.equal(response.status, 200);
  assert.ok(cookie);
  // Nothing was inherited in a fresh store, so the owner has to choose one too.
  assert.equal(body.mustChangePassword, true);
  ownerCookie = cookie;
});

test("a starter password is not a way in", async () => {
  const check = await call("/api/auth-check", { cookie: ownerCookie });
  assert.equal(check.status, 401);
});

test("choosing a password opens the gate", async () => {
  const response = await call("/api/password/first", {
    method: "POST",
    cookie: ownerCookie,
    body: { newPassword: "owner-password" }
  });
  assert.equal(response.status, 200);
  ownerCookie = cookieFrom(response);

  const check = await call("/api/auth-check", { cookie: ownerCookie });
  assert.equal(check.status, 200);
  assert.ok(check.headers.get("x-merit-user"));
});

test("a password too short is refused", async () => {
  const response = await call("/api/password", {
    method: "POST",
    cookie: ownerCookie,
    body: { currentPassword: "owner-password", newPassword: "short" }
  });
  assert.equal(response.status, 400);
});

test("the name is not case sensitive and the password is", async () => {
  const good = await login("brendan", "owner-password");
  assert.equal(good.response.status, 200);
  const bad = await login("Brendan", "Owner-Password");
  assert.equal(bad.response.status, 401);
});

let guestId = "";

test("an admin can add a guest, and a guest starts on ChangeMe1", async () => {
  const created = await call("/api/users", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "Sarah" }
  });
  assert.equal(created.status, 200);
  const { user } = await created.json();
  guestId = user.id;
  assert.equal(user.role, "teacher");
  assert.equal(user.mustChangePassword, true);
  // Nothing that talks to another service is handed out by default.
  assert.deepEqual(user.features, { inkheron: false, cadence: false });

  const { response } = await login("sarah", "ChangeMe1");
  assert.equal(response.status, 200);
});

test("the same name cannot be taken twice", async () => {
  const response = await call("/api/users", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "sarah" }
  });
  assert.equal(response.status, 409);
});

test("a guest cannot see or touch the accounts", async () => {
  const guest = await login("Sarah", "ChangeMe1");
  const list = await call("/api/users", { cookie: guest.cookie });
  assert.equal(list.status, 403);
  const add = await call("/api/users", {
    method: "POST",
    cookie: guest.cookie,
    body: { name: "Smuggled" }
  });
  assert.equal(add.status, 403);
});

test("a reset closes that account's sessions and nobody else's", async () => {
  const guest = await login("Sarah", "ChangeMe1");
  const first = await call("/api/password/first", {
    method: "POST",
    cookie: guest.cookie,
    body: { newPassword: "sarah-password" }
  });
  const settled = cookieFrom(first);
  assert.equal((await call("/api/session", { cookie: settled }).then((r) => r.json())).authenticated, true);

  const reset = await call(`/api/users/${guestId}/reset`, { method: "POST", cookie: ownerCookie });
  assert.equal(reset.status, 200);

  const hers = await call("/api/session", { cookie: settled }).then((r) => r.json());
  assert.equal(hers.authenticated, false);
  const mine = await call("/api/session", { cookie: ownerCookie }).then((r) => r.json());
  assert.equal(mine.authenticated, true);

  // And she is back on the starter password with a change to make.
  const back = await login("Sarah", "ChangeMe1");
  assert.equal(back.body.mustChangePassword, true);
});

test("a disabled account fails the same way a wrong password does", async () => {
  await call("/api/users/" + guestId, {
    method: "POST",
    cookie: ownerCookie,
    body: { disabled: true }
  });
  const { response, body } = await login("Sarah", "ChangeMe1");
  assert.equal(response.status, 401);
  assert.equal(body.error, "invalid_login");

  await call("/api/users/" + guestId, {
    method: "POST",
    cookie: ownerCookie,
    body: { disabled: false }
  });
});

test("whoami is what Merit will ask, and it needs the cookie", async () => {
  const anonymous = await call("/api/whoami");
  assert.equal(anonymous.status, 401);

  const mine = await call("/api/whoami", { cookie: ownerCookie });
  assert.equal(mine.status, 200);
  const user = await mine.json();
  assert.equal(user.name, "Brendan");
  assert.equal(user.role, "admin");
  assert.equal(Object.hasOwn(user, "passwordHash"), false);
});

test("no hash ever leaves the service", async () => {
  const listed = await call("/api/users", { cookie: ownerCookie }).then((r) => r.text());
  assert.equal(listed.includes("passwordHash"), false);
});

test("the last admin cannot lock themselves out", async () => {
  const demote = await call("/api/users/" + (await who()), {
    method: "POST",
    cookie: ownerCookie,
    body: { role: "teacher" }
  });
  assert.equal(demote.status, 400);

  const remove = await call("/api/users/" + (await who()), { method: "DELETE", cookie: ownerCookie });
  assert.equal(remove.status, 400);
});

async function who() {
  return (await call("/api/whoami", { cookie: ownerCookie }).then((r) => r.json())).id;
}

test("a guest can be deleted and stops being a way in", async () => {
  const guest = await login("Sarah", "ChangeMe1");
  const gone = await call("/api/users/" + guestId, { method: "DELETE", cookie: ownerCookie });
  assert.equal(gone.status, 200);

  const after = await call("/api/session", { cookie: guest.cookie }).then((r) => r.json());
  assert.equal(after.authenticated, false);
  assert.equal((await login("Sarah", "ChangeMe1")).response.status, 401);
});

// Stage 3 leans on this: Merit picks a database file from the dataset name, so
// an account with no dataset of its own would open somebody else's gradebook.
test("every account carries its own dataset, and only mine is the original", async () => {
  const mine = await call("/api/whoami", { cookie: ownerCookie }).then((r) => r.json());
  assert.equal(mine.dataset, "default");

  const made = await call("/api/users", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "Dana" }
  }).then((r) => r.json());

  assert.equal(made.user.dataset, made.user.id);
  assert.notEqual(made.user.dataset, "default");

  const dana = await login("Dana", "ChangeMe1");
  const hers = await call("/api/whoami", { cookie: dana.cookie }).then((r) => r.json());
  assert.equal(hers.dataset, made.user.id);
});
