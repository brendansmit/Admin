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
