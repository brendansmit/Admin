const dropletGroups = document.querySelector("#dropletGroups");
const localGroup = document.querySelector("#localGroup");
const localGrid = document.querySelector("#localGrid");
const sessionStatus = document.querySelector("#sessionStatus");
const controlTitle = document.querySelector("#controlTitle");
const statusDot = document.querySelector("#statusDot");
const statusTitle = document.querySelector("#statusTitle");
const statusDetail = document.querySelector("#statusDetail");
const output = document.querySelector("#output");
const refreshButton = document.querySelector("#refreshButton");
const refreshAllButton = document.querySelector("#refreshAllButton");
const deployButton = document.querySelector("#deployButton");
const restartButton = document.querySelector("#restartButton");
const logsButton = document.querySelector("#logsButton");
const deployNote = document.querySelector("#deployNote");
const restartNote = document.querySelector("#restartNote");
const logoutButton = document.querySelector("#logoutButton");
const copyButton = document.querySelector("#copyButton");
const actionUnlockStatus = document.querySelector("#actionUnlockStatus");
const unlockActionsButton = document.querySelector("#unlockActionsButton");
const confirmDialog = document.querySelector("#confirmDialog");
const confirmTitle = document.querySelector("#confirmTitle");
const confirmCopy = document.querySelector("#confirmCopy");
const confirmInput = document.querySelector("#confirmInput");
const cancelConfirm = document.querySelector("#cancelConfirm");
const acceptConfirm = document.querySelector("#acceptConfirm");
const unlockDialog = document.querySelector("#unlockDialog");
const unlockInput = document.querySelector("#unlockInput");
const unlockError = document.querySelector("#unlockError");
const cancelUnlock = document.querySelector("#cancelUnlock");
const acceptUnlock = document.querySelector("#acceptUnlock");

// The default action descriptions, kept so they can be restored after an app
// that cannot deploy or restart has replaced them with its reason.
const DEPLOY_DEFAULT = deployNote.textContent;
const RESTART_DEFAULT = restartNote.textContent;

let csrfToken = "";
let apps = [];
let droplets = {};
let localOnlyTools = [];
let currentApp = "";
let actionsUnlocked = false;
let actionUnlockExpiresAt = null;

function setOutput(text) {
  output.textContent = text || "(no output)";
}

function selectedApp() {
  return apps.find((app) => app.key === currentApp);
}

function handleAuth(response) {
  if (response.status === 401) {
    window.location.href = "/login";
    return true;
  }
  return false;
}

function renderActionUnlock() {
  const expiry = actionUnlockExpiresAt ? new Date(actionUnlockExpiresAt) : null;
  actionsUnlocked = Boolean(expiry && expiry.getTime() > Date.now());
  actionUnlockStatus.textContent = actionsUnlocked ? "Actions unlocked" : "Actions locked";
  actionUnlockStatus.className = actionsUnlocked ? "status-pill ok" : "status-pill";
  unlockActionsButton.textContent = actionsUnlocked ? "Extend unlock" : "Unlock actions";
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.method && options.method !== "GET") {
    headers["x-csrf-token"] = csrfToken;
    headers["content-type"] = "application/json";
  }
  const response = await fetch(path, { ...options, headers });
  if (handleAuth(response)) {
    throw new Error("Login required");
  }
  return response;
}

function appCard(app) {
  const card = document.createElement("article");
  card.className = "app-card";
  card.dataset.key = app.key;
  card.tabIndex = 0;

  const head = document.createElement("div");
  head.className = "card-head";
  const dot = document.createElement("span");
  dot.className = "srv-dot";
  dot.dataset.dot = app.key;
  dot.title = "Checking";
  const title = document.createElement("h4");
  title.textContent = app.label;
  head.append(dot, title);

  const host = document.createElement("p");
  host.className = "card-host";
  host.textContent = app.host;

  const actions = document.createElement("div");
  actions.className = "card-actions";

  if (app.url) {
    const open = document.createElement("a");
    open.className = "card-open";
    open.href = app.url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "Open";
    // The whole card selects the app, so the link has to keep its own click.
    open.addEventListener("click", (event) => event.stopPropagation());
    actions.append(open);
  } else {
    const note = document.createElement("span");
    note.className = "card-flag";
    note.textContent = "internal";
    actions.append(note);
  }

  const manage = document.createElement("span");
  manage.className = "card-manage";
  manage.textContent = "Manage";
  actions.append(manage);

  card.append(head, host, actions);
  card.addEventListener("click", () => selectApp(app.key));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectApp(app.key);
    }
  });
  return card;
}

function localCard(tool) {
  const card = document.createElement("article");
  card.className = "app-card local";
  const head = document.createElement("div");
  head.className = "card-head";
  const title = document.createElement("h4");
  title.textContent = tool.label;
  head.append(title);
  const note = document.createElement("p");
  note.className = "card-host";
  note.textContent = tool.note;
  const flag = document.createElement("div");
  flag.className = "card-actions";
  const badge = document.createElement("span");
  badge.className = "card-flag";
  badge.textContent = "local only";
  flag.append(badge);
  card.append(head, note, flag);
  return card;
}

function renderLauncher() {
  const groups = Object.entries(droplets).map(([key, droplet]) => {
    const group = document.createElement("div");
    group.className = "group";

    const head = document.createElement("div");
    head.className = "group-head";
    const heading = document.createElement("h3");
    heading.textContent = droplet.label;
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = droplet.note;
    head.append(heading, note);

    const grid = document.createElement("div");
    grid.className = "app-grid";
    grid.append(...apps.filter((app) => app.droplet === key).map(appCard));

    group.append(head, grid);
    return group;
  });

  dropletGroups.replaceChildren(...groups);

  localGroup.hidden = localOnlyTools.length === 0;
  localGrid.replaceChildren(...localOnlyTools.map(localCard));
  markSelected();
}

function markSelected() {
  document.querySelectorAll(".app-card[data-key]").forEach((card) => {
    card.classList.toggle("selected", card.dataset.key === currentApp);
  });
}

function renderControl() {
  const app = selectedApp();
  if (!app) {
    controlTitle.textContent = "Select an app above";
    return;
  }
  controlTitle.textContent = `${app.label} · ${app.host}`;

  // A greyed button with unchanged text reads as a glitch, so each blocked
  // action explains itself instead.
  deployButton.disabled = !app.canDeploy;
  deployNote.textContent = app.canDeploy ? DEPLOY_DEFAULT : (app.deployNote || "Deploy is not configured for this app.");
  restartButton.disabled = !app.canRestart;
  restartNote.textContent = app.canRestart ? RESTART_DEFAULT : (app.restartNote || "Restart is not configured for this app.");
}

function selectApp(key) {
  currentApp = key;
  markSelected();
  renderControl();
  setOutput("Ready.");
  loadStatus().catch((error) => setOutput(error.message));
  document.querySelector(".control").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadSession() {
  const response = await fetch("/api/session");
  const session = await response.json();
  if (!session.authenticated) {
    window.location.href = "/login";
    return;
  }
  csrfToken = session.csrfToken;
  actionsUnlocked = Boolean(session.actionsUnlocked);
  actionUnlockExpiresAt = session.actionUnlockExpiresAt;
  sessionStatus.textContent = "Authenticated";
  sessionStatus.className = "status-pill ok";
  renderActionUnlock();
}

async function loadApps() {
  const response = await api("/api/apps");
  const data = await response.json();
  apps = data.apps || [];
  droplets = data.droplets || {};
  localOnlyTools = data.localOnlyTools || [];
  renderLauncher();
  renderControl();
}

function paintDot(key, state, title) {
  const dot = document.querySelector(`.srv-dot[data-dot="${key}"]`);
  if (!dot) {
    return;
  }
  dot.className = `srv-dot ${state}`;
  dot.title = title;
}

async function refreshAllDots() {
  document.querySelectorAll(".srv-dot").forEach((dot) => {
    dot.className = "srv-dot";
  });
  const response = await api("/api/status-all");
  const all = await response.json();
  Object.entries(all).forEach(([key, data]) => {
    const state = data.online ? "online" : data.degraded ? "degraded" : "offline";
    paintDot(key, state, data.detail || "");
  });
}

async function loadStatus() {
  if (!currentApp) {
    return;
  }
  statusDot.className = "status-dot";
  statusTitle.textContent = "Checking";
  statusDetail.textContent = selectedApp()?.host || "";
  const response = await api(`/api/status?app=${encodeURIComponent(currentApp)}`);
  const data = await response.json();
  // Degraded means the process is running but the public URL did not answer.
  // Painting that green would hide a real outage, so it gets its own colour.
  const state = data.online ? "online" : data.degraded ? "degraded" : "offline";
  statusDot.className = `status-dot ${state}`;
  statusTitle.textContent = data.online
    ? `${data.label} online`
    : data.degraded
      ? `${data.label} degraded`
      : `${data.label} needs attention`;
  statusDetail.textContent = `${data.host} | ${data.detail}`;
  paintDot(currentApp, state, data.detail || "");
}

function askConfirmation(action) {
  const app = selectedApp();
  confirmTitle.textContent = `${action === "deploy" ? "Deploy" : "Restart"} ${app.label}`;
  confirmCopy.textContent = `This will ${action} ${app.host}.`;
  confirmInput.value = "";
  confirmDialog.showModal();

  return new Promise((resolve) => {
    const cleanUp = () => {
      cancelConfirm.removeEventListener("click", onCancel);
      acceptConfirm.removeEventListener("click", onAccept);
    };
    const onCancel = () => {
      cleanUp();
      confirmDialog.close();
      resolve(null);
    };
    const onAccept = () => {
      const value = confirmInput.value.trim();
      cleanUp();
      confirmDialog.close();
      resolve(value);
    };
    cancelConfirm.addEventListener("click", onCancel);
    acceptConfirm.addEventListener("click", onAccept);
  });
}

function askActionSecret() {
  unlockInput.value = "";
  unlockError.textContent = "";
  unlockDialog.showModal();
  setTimeout(() => unlockInput.focus(), 0);

  return new Promise((resolve) => {
    const cleanUp = () => {
      cancelUnlock.removeEventListener("click", onCancel);
      acceptUnlock.removeEventListener("click", onAccept);
      unlockInput.removeEventListener("keydown", onKeydown);
    };
    const onCancel = () => {
      cleanUp();
      unlockDialog.close();
      resolve(null);
    };
    const onAccept = () => {
      const value = unlockInput.value;
      cleanUp();
      unlockDialog.close();
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onAccept();
      }
    };
    cancelUnlock.addEventListener("click", onCancel);
    acceptUnlock.addEventListener("click", onAccept);
    unlockInput.addEventListener("keydown", onKeydown);
  });
}

async function unlockActions() {
  const secret = await askActionSecret();
  if (secret === null) {
    return false;
  }
  const response = await api("/api/action-unlock", {
    method: "POST",
    body: JSON.stringify({ secret })
  });
  const data = await response.json();
  if (!response.ok) {
    actionsUnlocked = false;
    actionUnlockExpiresAt = null;
    renderActionUnlock();
    setOutput(data.error === "invalid_secret" ? "Secret phrase was wrong." : (data.error || "Unlock failed"));
    return false;
  }
  actionsUnlocked = true;
  actionUnlockExpiresAt = data.actionUnlockExpiresAt;
  renderActionUnlock();
  setOutput("Actions unlocked for 15 minutes.");
  return true;
}

async function ensureActionsUnlocked() {
  renderActionUnlock();
  if (actionsUnlocked) {
    return true;
  }
  return unlockActions();
}

async function runAction(action) {
  const app = selectedApp();
  if (!app) {
    setOutput("Select an app first.");
    return;
  }
  if (action === "deploy" && !app.canDeploy) {
    setOutput(app.deployNote || "Deploy is not configured for this app.");
    return;
  }
  if (action === "restart" && !app.canRestart) {
    setOutput(app.restartNote || "Restart is not configured for this app.");
    return;
  }
  if (action !== "logs" && !(await ensureActionsUnlocked())) {
    return;
  }
  const confirmation = action === "logs" ? app.host : await askConfirmation(action);
  if (confirmation === null) {
    return;
  }

  setOutput(`${action} started for ${app.host}...`);
  const path = action === "logs"
    ? `/api/logs?app=${encodeURIComponent(app.key)}`
    : `/api/apps/${encodeURIComponent(app.key)}/${action}`;
  const response = await api(path, action === "logs"
    ? {}
    : { method: "POST", body: JSON.stringify({ confirm: confirmation }) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 423) {
      actionsUnlocked = false;
      actionUnlockExpiresAt = null;
      renderActionUnlock();
    }
    setOutput(data.message || (data.expected ? `Type exactly: ${data.expected}` : (data.error || "Request failed")));
    return;
  }
  setOutput(data.output || JSON.stringify(data, null, 2));
  await loadStatus();
}

refreshButton.addEventListener("click", () => loadStatus().catch((error) => setOutput(error.message)));
refreshAllButton.addEventListener("click", () => refreshAllDots().catch((error) => setOutput(error.message)));
deployButton.addEventListener("click", () => runAction("deploy").catch((error) => setOutput(error.message)));
restartButton.addEventListener("click", () => runAction("restart").catch((error) => setOutput(error.message)));
logsButton.addEventListener("click", () => runAction("logs").catch((error) => setOutput(error.message)));
unlockActionsButton.addEventListener("click", () => unlockActions().catch((error) => setOutput(error.message)));
logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  window.location.href = "/login";
});
copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(output.textContent);
  copyButton.textContent = "Copied";
  setTimeout(() => {
    copyButton.textContent = "Copy";
  }, 1200);
});

await loadSession();
await loadApps();
await refreshAllDots().catch(() => {});
// The whole grid is one request, so a slow droplet cannot starve the others.
setInterval(() => refreshAllDots().catch(() => {}), 60000);
setInterval(() => loadStatus().catch(() => {}), 30000);
