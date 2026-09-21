import { randomUUID } from "node:crypto";

import { hashMatches, hashPassword } from "./passwords.js";
import { readStore, updateStore } from "./storage.js";

// Everyone who can log in, one record each. The site used to have a single
// shared password, which meant a reset signed out everybody and an audit line
// had no name to point at. A record per person fixes both.

const initialPassword = "ChangeMe1";

// What an account is allowed to reach beyond the gradebook itself. Off for a
// new account: nothing that talks to another one of my services is handed out
// by default.
const defaultFeatures = { inkheron: false, cadence: false };

// Which set of gradebook data the account opens. Merit keeps one database file
// per dataset, so two accounts never see a trace of each other. "default" is
// the file that was there before accounts existed, and it stays mine.
const ownerDataset = "default";

let users = [];

function loginKey(name) {
  return String(name || "").trim().toLowerCase();
}

function features(user) {
  return { ...defaultFeatures, ...(user?.features || {}) };
}

// Never leaves this module with a hash in it.
function publicUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    disabled: Boolean(user.disabled),
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordIsInitial: hashMatches(initialPassword, user.passwordHash),
    features: features(user),
    dataset: user.dataset || user.id,
    createdAt: user.createdAt || null
  };
}

function makeUser({ name, role = "teacher", password = initialPassword, mustChangePassword = true, features: wanted, dataset } = {}) {
  const id = randomUUID();
  return {
    id,
    // Its own by default. Nothing a new account does can reach another one's.
    dataset: dataset || id,
    name: String(name || "").trim(),
    passwordHash: hashPassword(password),
    role: role === "admin" ? "admin" : "teacher",
    mustChangePassword: Boolean(mustChangePassword),
    disabled: false,
    features: { ...defaultFeatures, ...(wanted || {}) },
    createdAt: new Date().toISOString()
  };
}

async function save() {
  await updateStore((store) => {
    store.users = users;
  });
}

/**
 * Loads the accounts. Must be awaited before the first request is judged.
 */
async function initUsers() {
  const store = await readStore();
  users = Array.isArray(store.users) ? store.users : [];
  if (users.length) {
    // Records written before datasets existed. The first account is the one the
    // shared password became, so the data already on disk is its own.
    const missing = users.filter((user) => !user.dataset);
    if (missing.length) {
      users.forEach((user, index) => {
        if (!user.dataset) {
          user.dataset = index === 0 ? ownerDataset : user.id;
        }
      });
      await save();
    }
    return;
  }

  // First start after the change. The one shared password becomes one admin
  // account rather than a locked door, so the upgrade signs nobody out.
  const inherited = store.auth?.passwordHash || null;
  const owner = makeUser({
    name: process.env.ADMIN_USER_NAME || "Brendan",
    role: "admin",
    mustChangePassword: !inherited,
    features: { inkheron: true, cadence: true },
    dataset: ownerDataset
  });
  if (inherited) {
    owner.passwordHash = inherited;
  }
  users = [owner];
  await save();
}

function listUsers() {
  return users.map(publicUser);
}

function findById(id) {
  return users.find((user) => user.id === id) || null;
}

function findByLogin(name) {
  const key = loginKey(name);
  return key ? users.find((user) => loginKey(user.name) === key) || null : null;
}

function adminCount() {
  return users.filter((user) => user.role === "admin" && !user.disabled).length;
}

/**
 * The record when the name and password match and the account is open, null
 * otherwise. A disabled account fails the same way a wrong password does, so
 * the form cannot be used to find out which accounts exist.
 */
function validateLogin(name, password) {
  const user = findByLogin(name);
  if (!user || user.disabled || !hashMatches(password, user.passwordHash)) {
    return null;
  }
  return user;
}

function validateUserPassword(user, password) {
  return Boolean(user) && hashMatches(password, user.passwordHash);
}

async function addUser({ name, role, features: wanted }) {
  const clean = String(name || "").trim();
  if (clean.length < 2) {
    throw fail(400, "name_too_short");
  }
  if (findByLogin(clean)) {
    throw fail(409, "name_taken");
  }
  const user = makeUser({ name: clean, role, features: wanted });
  users.push(user);
  await save();
  return publicUser(user);
}

async function updateUser(id, changes) {
  const user = findById(id);
  if (!user) {
    throw fail(404, "no_such_user");
  }

  if (changes.name !== undefined) {
    const clean = String(changes.name).trim();
    if (clean.length < 2) {
      throw fail(400, "name_too_short");
    }
    const clash = findByLogin(clean);
    if (clash && clash.id !== user.id) {
      throw fail(409, "name_taken");
    }
    user.name = clean;
  }

  if (changes.role !== undefined) {
    user.role = changes.role === "admin" ? "admin" : "teacher";
  }
  if (changes.disabled !== undefined) {
    user.disabled = Boolean(changes.disabled);
  }
  if (changes.features !== undefined) {
    user.features = { ...features(user), ...changes.features };
  }

  // Locking the last way in is the one change that is never worth allowing.
  if (!adminCount()) {
    throw fail(400, "last_admin");
  }

  user.updatedAt = new Date().toISOString();
  await save();
  return publicUser(user);
}

async function setUserPassword(id, password) {
  const user = findById(id);
  if (!user) {
    throw fail(404, "no_such_user");
  }
  user.passwordHash = hashPassword(password);
  user.mustChangePassword = false;
  user.updatedAt = new Date().toISOString();
  await save();
  return publicUser(user);
}

/** Back to the starter password, and they have to pick a new one to get in. */
async function resetUserPassword(id) {
  const user = findById(id);
  if (!user) {
    throw fail(404, "no_such_user");
  }
  user.passwordHash = hashPassword(initialPassword);
  user.mustChangePassword = true;
  user.updatedAt = new Date().toISOString();
  await save();
  return publicUser(user);
}

async function removeUser(id) {
  const user = findById(id);
  if (!user) {
    throw fail(404, "no_such_user");
  }
  users = users.filter((other) => other.id !== id);
  if (!adminCount()) {
    users.push(user);
    throw fail(400, "last_admin");
  }
  await save();
}

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export {
  addUser,
  adminCount,
  findById,
  findByLogin,
  initialPassword,
  initUsers,
  ownerDataset,
  listUsers,
  publicUser,
  removeUser,
  resetUserPassword,
  setUserPassword,
  updateUser,
  validateLogin,
  validateUserPassword
};
