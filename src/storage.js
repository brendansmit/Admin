import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");
const dataPath = process.env.ADMIN_DATA_PATH || join(rootDir, "data", "store.json");

const emptyStore = {
  workEvents: [],
  calendarEvents: [],
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
  const tmpPath = `${dataPath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`);
  await rename(tmpPath, dataPath);
}

async function updateStore(mutator) {
  const store = await readStore();
  const result = await mutator(store);
  await writeStore(store);
  return result;
}

export { readStore, updateStore };

