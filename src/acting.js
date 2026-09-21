import { randomUUID } from "node:crypto";

import { readStore, updateStore } from "./storage.js";

// Every time I open somebody else's account, a row is written here: who did it,
// whose account, when it started and when it ended. Her banner is built from
// these rows rather than from anything the borrowing browser reports, so it
// tells her the truth whether or not that browser behaved.

// The most recent ones. Old enough rows are dropped, because this is a record
// for the person it happened to rather than an archive.
const keep = 300;

let log = [];

async function initAccessLog() {
  const store = await readStore();
  log = Array.isArray(store.accessLog) ? store.accessLog : [];
}

function persist() {
  const rows = log.slice(-keep);
  log = rows;
  updateStore((store) => {
    store.accessLog = rows;
  }).catch((error) => {
    console.error("Could not save the access log", error);
  });
}

/** Records the start and answers with the row's id. */
function openAccess({ byId, byName, userId }) {
  const id = randomUUID();
  log.push({
    id,
    byId,
    byName,
    userId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    seenAt: null
  });
  persist();
  return id;
}

/** Marks a row finished. Doing it twice is harmless and changes nothing. */
function closeAccess(id) {
  const row = log.find((entry) => entry.id === id);
  if (!row || row.endedAt) {
    return;
  }
  row.endedAt = new Date().toISOString();
  persist();
}

/**
 * What she has not been told about yet. A row with no endedAt is somebody in
 * there at this moment, and says so rather than being held back until it ends.
 */
function noticesFor(userId) {
  return log
    .filter((row) => row.userId === userId && !row.seenAt)
    .map((row) => ({
      id: row.id,
      byName: row.byName,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      open: !row.endedAt
    }));
}

/** She has read them. Only rows that have ended are put away, so somebody who
 *  is in there right now is still on her screen after she dismisses. */
function markSeen(userId) {
  const now = new Date().toISOString();
  let changed = false;
  for (const row of log) {
    if (row.userId === userId && !row.seenAt && row.endedAt) {
      row.seenAt = now;
      changed = true;
    }
  }
  if (changed) {
    persist();
  }
  return changed;
}

/** Test seam. Nothing in the service calls this. */
function allAccess() {
  return log.map((row) => ({ ...row }));
}

export { allAccess, closeAccess, initAccessLog, markSeen, noticesFor, openAccess };
