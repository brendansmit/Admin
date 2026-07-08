const appTabs = document.querySelector("#appTabs");
const sessionStatus = document.querySelector("#sessionStatus");
const statusDot = document.querySelector("#statusDot");
const statusTitle = document.querySelector("#statusTitle");
const statusDetail = document.querySelector("#statusDetail");
const output = document.querySelector("#output");
const refreshButton = document.querySelector("#refreshButton");
const deployButton = document.querySelector("#deployButton");
const restartButton = document.querySelector("#restartButton");
const logsButton = document.querySelector("#logsButton");
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

let csrfToken = "";
let apps = [];
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

function renderTabs() {
  appTabs.replaceChildren(...apps.map((app) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = app.key === currentApp ? "active" : "";
    button.textContent = app.label;
    button.addEventListener("click", () => {
      currentApp = app.key;
      renderTabs();
      loadStatus();
      setOutput("Ready.");
    });
    return button;
  }));
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
  apps = data.apps;
  currentApp = currentApp || apps[0]?.key || "";
  renderTabs();
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
  statusDot.className = data.online ? "status-dot online" : "status-dot offline";
  statusTitle.textContent = data.online ? `${data.label} online` : `${data.label} needs attention`;
  statusDetail.textContent = `${data.host} | ${data.detail}`;
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
    setOutput(data.expected ? `Type exactly: ${data.expected}` : (data.error || "Request failed"));
    return;
  }
  setOutput(data.output || JSON.stringify(data, null, 2));
  await loadStatus();
}

refreshButton.addEventListener("click", () => loadStatus().catch((error) => setOutput(error.message)));
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
await loadStatus();
setInterval(() => loadStatus().catch(() => {}), 30000);
