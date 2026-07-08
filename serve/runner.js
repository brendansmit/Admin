import { spawn } from "node:child_process";
import { commandTimeoutMs } from "./config.js";

const maxOutputChars = 60000;

function printable(step) {
  return [step.command, ...(step.args || [])].join(" ");
}

function trimOutput(text) {
  if (text.length <= maxOutputChars) {
    return text;
  }
  return `${text.slice(0, maxOutputChars)}\n\n[output truncated]`;
}

function runStep(step, timeoutMs = commandTimeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(step.command, step.args || [], {
      cwd: step.cwd,
      env: { ...process.env, ...(step.env || {}) },
      shell: false
    });
    let output = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      output = trimOutput(output);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
      output = trimOutput(output);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        output: `${printable(step)}\n${error.message}`,
        durationMs: Date.now() - startedAt
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !killed,
        output: output.trim() || "(no output)",
        code,
        timedOut: killed,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

async function runSequence(steps) {
  const lines = [];
  for (const step of steps) {
    lines.push(`$ ${printable(step)}`);
    const result = await runStep(step);
    lines.push(result.output);
    if (!result.ok) {
      lines.push(result.timedOut ? "Timed out. Aborting." : "Failed. Aborting.");
      return { ok: false, output: lines.join("\n\n") };
    }
  }
  return { ok: true, output: lines.join("\n\n") };
}

export { printable, runSequence, runStep };
