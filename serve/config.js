const commandTimeoutMs = Number.parseInt(process.env.SERVE_COMMAND_TIMEOUT_MS || "120000", 10);
const useSudo = process.env.SERVE_USE_SUDO === "1";

// This panel runs on droplet 2. Droplet 1 is reached over a dedicated key that
// has no shell: sshd runs serve/ops/serve-remote as a forced command, and that
// wrapper accepts only "<verb> <app>" pairs from a fixed table. Even if this
// process were fully compromised it cannot run arbitrary commands over there.
const droplet1Ssh = process.env.SERVE_DROPLET1_SSH || "root@167.172.71.219";
const droplet1Key = process.env.SERVE_DROPLET1_KEY || "/root/.ssh/id_serve_remote";

// Connection multiplexing, because the grid checks seven droplet-1 apps at
// once. Without it, seven ssh processes each pay a full handshake and the
// slowest ones time out, which reads on screen as apps randomly flashing
// offline.
const sshMuxDir = process.env.SERVE_SSH_MUX_DIR || "/tmp/serve-ssh-mux";

const sshOptions = [
  "-o", "StrictHostKeyChecking=no",
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=8",
  "-o", "ControlMaster=auto",
  "-o", `ControlPath=${sshMuxDir}/%r@%h:%p`,
  "-o", "ControlPersist=120"
];

function sudoCommand(command, args = []) {
  return useSudo ? { command: "sudo", args: ["-n", command, ...args] } : { command, args };
}

function remote(verb, app) {
  return {
    command: "ssh",
    args: ["-i", droplet1Key, ...sshOptions, droplet1Ssh, `${verb} ${app}`]
  };
}

// Opens the master connection before any fan-out. "apps" is the wrapper's one
// argument-free verb, so this is a real round trip that changes nothing.
const droplet1Warm = {
  command: "ssh",
  args: ["-i", droplet1Key, ...sshOptions, droplet1Ssh, "apps"]
};

function compose(dir, args, file) {
  const prefix = file ? ["compose", "-f", file] : ["compose"];
  return { command: "docker", args: [...prefix, ...args], cwd: dir };
}

// "docker compose ps" exits 0 whether the container is up or not; when it is
// down it simply prints nothing. So the status step asks for running ids only
// and declares requireOutput, which makes an empty answer count as down
// instead of healthy.
function composeStatus(dir, service, file) {
  return {
    ...compose(dir, ["ps", "-q", "--status", "running", service], file),
    requireOutput: true
  };
}

// Apps that ship by rsync from the Mac have no git remote on the droplet, so
// there is genuinely nothing for this panel to pull. Say so rather than
// offering a button that cannot work.
const rsyncOnly =
  "Deployed by rsync from the Mac, so there is no git remote here to pull from. " +
  "Use the Deploy Dashboard on the Mac. Restart and Logs work from here.";

const apps = {
  // ── droplet 1: nginx, pm2 and systemd ──────────────────────────────────
  inkpad: {
    droplet: "droplet-1",
    label: "InkPad",
    host: "inkpad.inkheron.app",
    url: "https://inkpad.inkheron.app",
    healthUrl: "https://inkpad.inkheron.app/healthz",
    repoPath: "/opt/inkheron-platform",
    status: remote("status", "inkpad"),
    logs: remote("logs", "inkpad"),
    restart: remote("restart", "inkpad"),
    deployNote: rsyncOnly
  },
  admin: {
    droplet: "droplet-1",
    label: "Admin",
    host: "admin.inkheron.app",
    url: "https://admin.inkheron.app",
    healthUrl: "https://admin.inkheron.app",
    repoPath: "/opt/admin-platform",
    status: remote("status", "admin-platform"),
    logs: remote("logs", "admin-platform"),
    restart: remote("restart", "admin-platform"),
    deployNote: rsyncOnly
  },
  eap: {
    droplet: "droplet-1",
    label: "EAP",
    host: "eap.inkheron.app",
    url: "https://eap.inkheron.app",
    healthUrl: "https://eap.inkheron.app/healthz",
    repoPath: "/opt/eap-platform",
    status: remote("status", "eap-platform"),
    logs: remote("logs", "eap-platform"),
    restart: remote("restart", "eap-platform"),
    deployNote: rsyncOnly
  },
  lang: {
    droplet: "droplet-1",
    label: "AP Lang",
    host: "lang.inkheron.app",
    url: "https://lang.inkheron.app",
    healthUrl: "https://lang.inkheron.app",
    repoPath: "/var/www/ap-lang-dashboard",
    status: remote("status", "ap-lang"),
    logs: remote("logs", "ap-lang"),
    restart: remote("restart", "ap-lang"),
    deploy: [remote("deploy", "ap-lang")]
  },
  speedDating: {
    droplet: "droplet-1",
    label: "Speed Dating",
    host: "speeddating.inkheron.app",
    url: "https://speeddating.inkheron.app",
    healthUrl: "https://speeddating.inkheron.app",
    repoPath: "/var/www/speed-dating",
    status: remote("status", "speed-dating"),
    logs: remote("logs", "speed-dating"),
    restart: remote("restart", "speed-dating"),
    deploy: [remote("deploy", "speed-dating")]
  },
  grammarArcade: {
    droplet: "droplet-1",
    label: "Grammar Arcade",
    host: "eap.inkheron.app/grammar-arcade/",
    url: "https://eap.inkheron.app/grammar-arcade/",
    healthUrl: "https://eap.inkheron.app/grammar-arcade/api/health",
    repoPath: "/var/www/grammar-arcade",
    status: remote("status", "grammar-arcade"),
    logs: remote("logs", "grammar-arcade"),
    restart: remote("restart", "grammar-arcade"),
    deploy: [remote("deploy", "grammar-arcade")]
  },
  gradeImporter: {
    droplet: "droplet-1",
    label: "Grade Importer",
    host: "grade-importer (internal)",
    url: null, // not exposed publicly, so there is nothing to open
    healthUrl: null, // status comes from the process alone
    repoPath: "/var/www/grade-importer",
    status: remote("status", "grade-importer"),
    logs: remote("logs", "grade-importer"),
    restart: remote("restart", "grade-importer"),
    deployNote: rsyncOnly
  },

  // ── droplet 2: this host, Caddy in Docker ──────────────────────────────
  serve: {
    droplet: "droplet-2",
    label: "Serve Panel",
    host: "serve.inkheron.app",
    url: "https://serve.inkheron.app",
    healthUrl: "https://serve.inkheron.app/api/health",
    repoPath: "/opt/admin-platform",
    status: { command: "pm2", args: ["describe", "inkheron-serve"] },
    logs: { command: "pm2", args: ["logs", "inkheron-serve", "--lines", "120", "--nostream", "--raw"] },
    // Restarting this panel from inside itself kills the request that asked
    // for it, so the answer never comes back and the outcome is unknowable.
    selfManaged: true,
    restartNote:
      "This is the panel you are using. Restarting it from here would kill the request. " +
      "Use the Deploy Dashboard on the Mac.",
    deployNote:
      "This panel deploys by rsync from the Mac. Use the Deploy Dashboard there."
  },
  mosaic: {
    droplet: "droplet-2",
    label: "Mosaic",
    host: "mosaic.inkheron.app",
    url: "https://mosaic.inkheron.app",
    healthUrl: "https://mosaic.inkheron.app",
    repoPath: "/opt/mosaic",
    status: composeStatus("/opt/mosaic", "web"),
    logs: compose("/opt/mosaic", ["logs", "--tail", "120", "web"]),
    restart: compose("/opt/mosaic", ["restart", "web"]),
    deployNote:
      "No git remote on the droplet. /opt/mosaic is deployed by copying a new " +
      "directory into place, so there is nothing to pull. Restart and Logs work."
  },
  healthspan: {
    droplet: "droplet-2",
    label: "HealthSpan",
    host: "healthspan.inkheron.app",
    url: "https://healthspan.inkheron.app",
    healthUrl: "https://healthspan.inkheron.app",
    repoPath: "/opt/healthspan",
    status: composeStatus("/opt/healthspan", "app"),
    logs: compose("/opt/healthspan", ["logs", "--tail", "120", "app"]),
    restart: compose("/opt/healthspan", ["restart", "app"]),
    deploy: [
      { command: "git", args: ["-C", "/opt/healthspan", "pull", "--ff-only"] },
      compose("/opt/healthspan", ["up", "-d", "--build", "app"])
    ]
  },
  smitrecipes: {
    droplet: "droplet-2",
    label: "SmitRecipes",
    host: "smitrecipes.inkheron.app",
    url: "https://smitrecipes.inkheron.app",
    healthUrl: "https://smitrecipes.inkheron.app",
    repoPath: "/opt/smitrecipes",
    status: composeStatus("/opt/smitrecipes", "app", "docker-compose.deploy.yml"),
    logs: compose("/opt/smitrecipes", ["logs", "--tail", "120", "app"], "docker-compose.deploy.yml"),
    restart: compose("/opt/smitrecipes", ["restart", "app"], "docker-compose.deploy.yml"),
    deploy: [
      { command: "git", args: ["-C", "/opt/smitrecipes", "pull", "--ff-only"] },
      compose("/opt/smitrecipes", ["up", "-d", "--build", "app"], "docker-compose.deploy.yml")
    ]
  }
};

const droplets = {
  "droplet-1": {
    label: "Droplet 1 · 167.172.71.219",
    note: "nginx on 80/443, pm2 and systemd. Reached over the restricted key."
  },
  "droplet-2": {
    label: "Droplet 2 · 165.22.242.91",
    note: "Caddy in Docker on 80/443. This panel runs here."
  }
};

// Mac-only tools. They have no server counterpart at all, so the grid shows
// them greyed rather than pretending they can be reached from a browser.
const localOnlyTools = [
  { label: "Writing Analyzer", note: "macOS desktop app" },
  { label: "Maestro", note: "runs on the Mac" },
  { label: "BugSmash", note: "local HTML tool" },
  { label: "Model Router", note: "runs on the Mac" },
  { label: "Prototype Coder", note: "runs on the Mac" }
];

function publicApps() {
  return Object.entries(apps).map(([key, app]) => ({
    key,
    label: app.label,
    host: app.host,
    url: app.url || null,
    droplet: app.droplet,
    healthUrl: app.healthUrl || null,
    canDeploy: Array.isArray(app.deploy),
    deployNote: app.deployNote || null,
    canRestart: Boolean(app.restart),
    restartNote: app.restartNote || null
  }));
}

function getApp(key) {
  return apps[key] || null;
}

export {
  apps,
  commandTimeoutMs,
  droplet1Warm,
  droplets,
  getApp,
  localOnlyTools,
  publicApps,
  sshMuxDir
};
