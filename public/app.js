const apiStatus = document.querySelector("#apiStatus");
const settingsForm = document.querySelector("#settingsForm");
const adminTokenInput = document.querySelector("#adminToken");
const todayTotal = document.querySelector("#todayTotal");
const weekTotal = document.querySelector("#weekTotal");
const monthTotal = document.querySelector("#monthTotal");
const nextReminder = document.querySelector("#nextReminder");
const eventList = document.querySelector("#eventList");
const eventEmpty = document.querySelector("#eventEmpty");
const refreshButton = document.querySelector("#refreshButton");
const quickLogButtons = document.querySelectorAll("[data-event]");
const manualEventForm = document.querySelector("#manualEventForm");
const calendarForm = document.querySelector("#calendarForm");
const reminderList = document.querySelector("#reminderList");
const reminderEmpty = document.querySelector("#reminderEmpty");
const runRemindersButton = document.querySelector("#runRemindersButton");

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
  monthTotal.textContent = formatMinutes(dashboard.monthMinutes);
  nextReminder.textContent = dashboard.nextReminder ? `${dashboard.nextReminder.date} ${dashboard.nextReminder.title}` : "Not set";

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

  reminderEmpty.hidden = dashboard.reminders.length > 0;
  reminderList.replaceChildren(
    ...dashboard.reminders.map((event) => {
      const row = document.createElement("div");
      row.className = "event-row";
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = event.title;
      const meta = document.createElement("span");
      meta.textContent = `${event.date} | ${event.category}${event.audience ? ` | ${event.audience}` : ""}`;
      detail.append(title, meta);
      const notice = document.createElement("small");
      notice.textContent = `${event.notify_days_before} days`;
      row.append(detail, notice);
      return row;
    })
  );
}

async function addManualEvent(payload) {
  localStorage.setItem("adminToken", adminTokenInput.value);
  const response = await fetch("/api/work-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminTokenInput.value}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  await loadDashboard();
}

async function addCalendarEvent(payload) {
  localStorage.setItem("adminToken", adminTokenInput.value);
  const response = await fetch("/api/calendar-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminTokenInput.value}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  await loadDashboard();
}

async function saveServerChanKey(sendKey) {
  localStorage.setItem("adminToken", adminTokenInput.value);
  const response = await fetch("/api/settings/serverchan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminTokenInput.value}`
    },
    body: JSON.stringify({ sendKey })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  apiStatus.textContent = "ServerChan key saved";
  apiStatus.className = "status-pill ok";
}

async function runReminders() {
  localStorage.setItem("adminToken", adminTokenInput.value);
  const response = await fetch("/api/notifications/run", {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminTokenInput.value}`
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = await response.json();
  apiStatus.textContent = `Reminders sent: ${result.sent}`;
  apiStatus.className = "status-pill ok";
  await loadDashboard();
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveServerChanKey(new FormData(settingsForm).get("serverChanKey")).catch(() => {
    apiStatus.textContent = "Settings save failed";
    apiStatus.className = "status-pill bad";
  });
});

refreshButton.addEventListener("click", () => {
  loadDashboard().catch(() => {
    apiStatus.textContent = "Dashboard load failed";
    apiStatus.className = "status-pill bad";
  });
});

quickLogButtons.forEach((button) => {
  button.addEventListener("click", () => {
    addManualEvent({
      event: button.dataset.event,
      source: "dashboard",
      location: "work",
      occurred_at: new Date().toISOString(),
      device: "admin dashboard"
    }).catch(() => {
      apiStatus.textContent = "Manual event failed";
      apiStatus.className = "status-pill bad";
    });
  });
});

manualEventForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(manualEventForm);
  const occurredAt = data.get("occurred_at");
  addManualEvent({
    event: data.get("event"),
    source: "manual_correction",
    location: data.get("location"),
    occurred_at: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
    device: "admin dashboard"
  }).catch(() => {
    apiStatus.textContent = "Correction failed";
    apiStatus.className = "status-pill bad";
  });
});

calendarForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addCalendarEvent(Object.fromEntries(new FormData(calendarForm))).catch(() => {
    apiStatus.textContent = "Calendar save failed";
    apiStatus.className = "status-pill bad";
  });
});

runRemindersButton.addEventListener("click", () => {
  runReminders().catch(() => {
    apiStatus.textContent = "Reminder run failed";
    apiStatus.className = "status-pill bad";
  });
});

checkHealth();
loadDashboard().catch(() => {
  apiStatus.textContent = "Dashboard load failed";
  apiStatus.className = "status-pill bad";
});
