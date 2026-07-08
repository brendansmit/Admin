const commandTimeoutMs = Number.parseInt(process.env.SERVE_COMMAND_TIMEOUT_MS || "120000", 10);
const useSudo = process.env.SERVE_USE_SUDO === "1";

function sudoCommand(command, args = []) {
  return useSudo ? { command: "sudo", args: ["-n", command, ...args] } : { command, args };
}

function systemdRestart(service) {
  return sudoCommand("systemctl", ["restart", service]);
}

function systemdStatus(service) {
  return sudoCommand("systemctl", ["is-active", service]);
}

function systemdLogs(service) {
  return sudoCommand("journalctl", ["-u", service, "-n", "120", "--no-pager"]);
}

const apps = {
  inkpad: {
    label: "InkPad",
    host: "inkpad.inkheron.app",
    healthUrl: "https://inkpad.inkheron.app/healthz",
    repoPath: "/opt/inkheron-platform",
    status: systemdStatus("inkheron-wrapper"),
    logs: systemdLogs("inkheron-wrapper"),
    restart: systemdRestart("inkheron-wrapper"),
    deploy: [
      { command: "git", args: ["-C", "/opt/inkheron-platform", "pull", "--ff-only"] },
      { command: "npm", args: ["install", "--omit=dev"], cwd: "/opt/inkheron-platform" },
      {
        command: "node",
        args: ["src/db/migrate.js"],
        cwd: "/opt/inkheron-platform",
        env: { INKHERON_DB_PATH: "/opt/inkheron-platform/data/inkheron.db" }
      },
      systemdRestart("inkheron-wrapper")
    ]
  },
  admin: {
    label: "Admin",
    host: "admin.inkheron.app",
    healthUrl: "https://admin.inkheron.app/api/health",
    repoPath: "/opt/inkheron-admin",
    status: systemdStatus("inkheron-admin"),
    logs: systemdLogs("inkheron-admin"),
    restart: systemdRestart("inkheron-admin"),
    deploy: [
      { command: "git", args: ["-C", "/opt/inkheron-admin", "pull", "--ff-only"] },
      { command: "npm", args: ["install", "--omit=dev"], cwd: "/opt/inkheron-admin" },
      systemdRestart("inkheron-admin")
    ]
  },
  eap: {
    label: "EAP",
    host: "eap.inkheron.app",
    healthUrl: "https://eap.inkheron.app/healthz",
    repoPath: "/opt/eap-platform",
    status: { command: "pm2", args: ["describe", "eap-platform"] },
    logs: { command: "pm2", args: ["logs", "eap-platform", "--lines", "120", "--nostream", "--raw"] },
    restart: { command: "pm2", args: ["restart", "eap-platform", "--update-env"] },
    deploy: [
      { command: "git", args: ["-C", "/opt/eap-platform", "pull", "--ff-only"] },
      { command: "npm", args: ["install", "--omit=dev"], cwd: "/opt/eap-platform" },
      {
        command: "node",
        args: ["src/db/migrate.js"],
        cwd: "/opt/eap-platform",
        env: { INKHERON_DB_PATH: "/opt/eap-platform/data/inkheron.db" }
      },
      { command: "pm2", args: ["restart", "eap-platform", "--update-env"] }
    ]
  },
  lang: {
    label: "AP Lang",
    host: "lang.inkheron.app",
    healthUrl: "https://lang.inkheron.app",
    repoPath: "/var/www/ap-lang-dashboard",
    status: { command: "pm2", args: ["describe", "ap-lang"] },
    logs: { command: "pm2", args: ["logs", "ap-lang", "--lines", "120", "--nostream", "--raw"] },
    restart: { command: "pm2", args: ["restart", "ap-lang"] },
    deploy: [
      { command: "git", args: ["-C", "/var/www/ap-lang-dashboard", "pull", "--ff-only"] },
      { command: "npm", args: ["install", "--omit=dev"], cwd: "/var/www/ap-lang-dashboard" },
      { command: "pm2", args: ["restart", "ap-lang"] }
    ]
  },
  speedDating: {
    label: "Speed Dating",
    host: "speeddating.inkheron.app",
    healthUrl: "https://speeddating.inkheron.app",
    repoPath: "/var/www/speed-dating",
    status: { command: "pm2", args: ["describe", "speed-dating"] },
    logs: { command: "pm2", args: ["logs", "speed-dating", "--lines", "120", "--nostream", "--raw"] },
    restart: { command: "pm2", args: ["restart", "speed-dating"] },
    deploy: [
      { command: "git", args: ["-C", "/var/www/speed-dating", "pull", "--ff-only"] },
      { command: "npm", args: ["install", "--omit=dev"], cwd: "/var/www/speed-dating" },
      { command: "pm2", args: ["restart", "speed-dating"] }
    ]
  },
  grammarArcade: {
    label: "Grammar Arcade",
    host: "eap.inkheron.app/grammar-arcade/",
    healthUrl: "https://eap.inkheron.app/grammar-arcade/api/health",
    repoPath: "/var/www/grammar-arcade",
    status: { command: "pm2", args: ["describe", "grammar-arcade"] },
    logs: { command: "pm2", args: ["logs", "grammar-arcade", "--lines", "120", "--nostream", "--raw"] },
    restart: { command: "pm2", args: ["reload", "ecosystem.config.cjs", "--update-env"], cwd: "/var/www/grammar-arcade" },
    deploy: [
      { command: "git", args: ["-C", "/var/www/grammar-arcade", "pull", "--ff-only"] },
      { command: "npm", args: ["install", "--omit=dev"], cwd: "/var/www/grammar-arcade" },
      { command: "pm2", args: ["reload", "ecosystem.config.cjs", "--update-env"], cwd: "/var/www/grammar-arcade" }
    ]
  }
};

function publicApps() {
  return Object.entries(apps).map(([key, app]) => ({
    key,
    label: app.label,
    host: app.host,
    healthUrl: app.healthUrl
  }));
}

function getApp(key) {
  return apps[key] || null;
}

export { apps, commandTimeoutMs, getApp, publicApps };
