import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");
const dataPath = process.env.ADMIN_DATA_PATH || join(rootDir, "data", "store.json");

const emptyStore = {
  workEvents: [],
  calendarEvents: [],
  birthdays: [],
  notificationLog: [],
  settings: {
    serverChanSendKey: ""
  }
};

async function readStore() {
  try {
    const raw = await readFile(dataPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...emptyStore,
      ...parsed,
      settings: {
        ...emptyStore.settings,
        ...(parsed.settings || {})
      }
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return structuredClone(emptyStore);
    }
    throw error;
  }
}

async function writeStore(store) {
  await mkdir(dirname(dataPath), { recursive: true });
  // A name of its own per write. Two writes landing together used to share one
  // tmp file, so the first rename took it and the second failed with ENOENT.
  const tmpPath = `${dataPath}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`);
  await rename(tmpPath, dataPath);
}

// One write at a time, in the order they were asked for. Saving sessions is
// fire and forget, so without this a session write and a user write can read
// the same file and the slower one throws the other away.
let writing = Promise.resolve();

async function updateStore(mutator) {
  const run = writing.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  // The queue must keep moving even when this caller's mutator throws.
  writing = run.then(() => undefined, () => undefined);
  return run;
}

export { readStore, updateStore };
