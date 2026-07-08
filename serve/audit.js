import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clientIp } from "./auth.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const auditPath = process.env.SERVE_AUDIT_LOG || join(__dirname, "data", "audit.jsonl");

async function audit(req, event) {
  const record = {
    at: new Date().toISOString(),
    ip: clientIp(req),
    user: req.headers["cf-access-authenticated-user-email"] || req.headers["x-authenticated-user-email"] || "password-user",
    ...event
  };

  await mkdir(dirname(auditPath), { recursive: true });
  await appendFile(auditPath, `${JSON.stringify(record)}\n`, "utf8");
}

export { audit };
