const apiStatus = document.querySelector("#apiStatus");
const settingsForm = document.querySelector("#settingsForm");
const adminTokenInput = document.querySelector("#adminToken");
const todayTotal = document.querySelector("#todayTotal");
const weekTotal = document.querySelector("#weekTotal");
const openSession = document.querySelector("#openSession");
const eventList = document.querySelector("#eventList");
const eventEmpty = document.querySelector("#eventEmpty");
const refreshButton = document.querySelector("#refreshButton");
const quickLogButtons = document.querySelectorAll("[data-event]");

adminTokenInput.value = localStorage.getItem("adminToken") || "dev-admin-token";

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h ${String(rest).padStart(2, "0")} min`;
}

function formatDateTime(value) {
  if (!value) {
    return "Missing";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const health = await response.json();
    apiStatus.textContent = health.ok ? "Server online" : "Server warning";
    apiStatus.className = health.ok ? "status-pill ok" : "status-pill bad";
  } catch (error) {
    apiStatus.textContent = "Server offline";
    apiStatus.className = "status-pill bad";
  }
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const dashboard = await response.json();
  todayTotal.textContent = formatMinutes(dashboard.todayMinutes);
  weekTotal.textContent = formatMinutes(dashboard.weekMinutes);
  openSession.textContent = dashboard.openSession ? formatDateTime(dashboard.openSession.start) : "None";

  eventEmpty.hidden = dashboard.events.length > 0;
  eventList.replaceChildren(
    ...dashboard.events.map((event) => {
      const row = document.createElement("div");
      row.className = "event-row";
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${event.event_type} at ${event.location}`;
      const meta = document.createElement("span");
      meta.textContent = `${formatDateTime(event.occurred_at)} from ${event.source}`;
      detail.append(title, meta);
      const warning = document.createElement("small");
      warning.textContent = event.warning || (event.duplicate ? "Duplicate" : "");
      row.append(detail, warning);
      return row;
    })
  );
}

async function addManualEvent(eventType) {
  localStorage.setItem("adminToken", adminTokenInput.value);
  const response = await fetch("/api/work-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminTokenInput.value}`
    },
    body: JSON.stringify({
      event: eventType,
      source: "dashboard",
      location: "work",
      occurred_at: new Date().toISOString(),
      device: "admin dashboard"
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  await loadDashboard();
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  localStorage.setItem("adminToken", adminTokenInput.value);
  apiStatus.textContent = "Settings API coming next";
  apiStatus.className = "status-pill";
});

refreshButton.addEventListener("click", () => {
  loadDashboard().catch(() => {
    apiStatus.textContent = "Dashboard load failed";
    apiStatus.className = "status-pill bad";
  });
});

quickLogButtons.forEach((button) => {
  button.addEventListener("click", () => {
    addManualEvent(button.dataset.event).catch(() => {
      apiStatus.textContent = "Manual event failed";
      apiStatus.className = "status-pill bad";
    });
  });
});

checkHealth();
loadDashboard().catch(() => {
  apiStatus.textContent = "Dashboard load failed";
  apiStatus.className = "status-pill bad";
});
