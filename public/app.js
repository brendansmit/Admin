const apiStatus = document.querySelector("#apiStatus");
const settingsForm = document.querySelector("#settingsForm");
const adminTokenInput = document.querySelector("#adminToken");
const todayTotal = document.querySelector("#todayTotal");
const weekTotal = document.querySelector("#weekTotal");
const monthTotal = document.querySelector("#monthTotal");
const birthdayTotal = document.querySelector("#birthdayTotal");
const nextReminder = document.querySelector("#nextReminder");
const overviewBirthdayList = document.querySelector("#overviewBirthdayList");
const eventList = document.querySelector("#eventList");
const eventEmpty = document.querySelector("#eventEmpty");
const refreshButton = document.querySelector("#refreshButton");
const quickLogButtons = document.querySelectorAll("[data-event]");
const manualEventForm = document.querySelector("#manualEventForm");
const calendarForm = document.querySelector("#calendarForm");
const reminderList = document.querySelector("#reminderList");
const reminderEmpty = document.querySelector("#reminderEmpty");
const runRemindersButton = document.querySelector("#runRemindersButton");
const logoutButton = document.querySelector("#logoutButton");
const navLinks = document.querySelectorAll("[data-nav]");
const pages = document.querySelectorAll("[data-page]");
const birthdayImportForm = document.querySelector("#birthdayImportForm");
const birthdayFile = document.querySelector("#birthdayFile");
const birthdayDropZone = document.querySelector("#birthdayDropZone");
const birthdayImportStatus = document.querySelector("#birthdayImportStatus");
const birthdayFilters = document.querySelector("#birthdayFilters");
const birthdayForm = document.querySelector("#birthdayForm");
const birthdayTable = document.querySelector("#birthdayTable");
const refreshBirthdaysButton = document.querySelector("#refreshBirthdaysButton");

adminTokenInput.value = localStorage.getItem("adminToken") || "dev-admin-token";

function authHeaders(extra = {}) {
  return {
    ...extra,
    authorization: `Bearer ${adminTokenInput.value}`
  };
}

function handleUnauthorized(response) {
  if (response.status === 401) {
    window.location.href = "/login";
    return true;
  }
  return false;
}

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

function showPage(pageName) {
  pages.forEach((page) => page.classList.toggle("active", page.dataset.page === pageName));
  navLinks.forEach((link) => link.classList.toggle("active", link.dataset.nav === pageName));
}

function pageFromHash() {
  const pageName = window.location.hash.replace("#", "") || "overview";
  return document.querySelector(`[data-page="${pageName}"]`) ? pageName : "overview";
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

function renderCompactBirthdays(birthdays) {
  overviewBirthdayList.replaceChildren(
    ...birthdays.slice(0, 6).map((birthday) => {
      const row = document.createElement("div");
      row.className = "event-row";
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = birthday.name;
      const meta = document.createElement("span");
      meta.textContent = `${birthday.next_date} | ${birthday.relationship}${birthday.tags.length ? ` | ${birthday.tags.join(", ")}` : ""}`;
      detail.append(title, meta);
      const days = document.createElement("small");
      days.textContent = `${birthday.days_until} days`;
      row.append(detail, days);
      return row;
    })
  );
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const dashboard = await response.json();
  todayTotal.textContent = formatMinutes(dashboard.todayMinutes);
  weekTotal.textContent = formatMinutes(dashboard.weekMinutes);
  monthTotal.textContent = formatMinutes(dashboard.monthMinutes);
  birthdayTotal.textContent = String(dashboard.birthdays.total);
  nextReminder.textContent = dashboard.nextReminder ? `${dashboard.nextReminder.date} ${dashboard.nextReminder.title}` : "Not set";
  renderCompactBirthdays(dashboard.birthdays.upcoming);

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

async function loadBirthdays() {
  const params = new URLSearchParams(new FormData(birthdayFilters));
  const response = await fetch(`/api/birthdays?${params.toString()}`);
  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  birthdayTable.replaceChildren(...data.birthdays.map(renderBirthdayRow));
}

function renderBirthdayRow(birthday) {
  const row = document.createElement("tr");
  row.dataset.id = birthday.id;

  row.append(
    cell(input("name", birthday.name)),
    cell(input("birthdate", birthday.birthdate, "date")),
    cell(selectRelationship(birthday.relationship)),
    cell(input("tags", birthday.tags.join(", "))),
    cell(input("notes", birthday.notes)),
    actionCell(birthday.id)
  );

  return row;
}

function cell(child) {
  const td = document.createElement("td");
  td.append(child);
  return td;
}

function input(name, value, type = "text") {
  const element = document.createElement("input");
  element.name = name;
  element.type = type;
  element.value = value || "";
  return element;
}

function selectRelationship(value) {
  const select = document.createElement("select");
  select.name = "relationship";
  for (const relationship of ["students", "colleagues", "family", "friends", "other"]) {
    const option = document.createElement("option");
    option.value = relationship;
    option.textContent = relationship[0].toUpperCase() + relationship.slice(1);
    option.selected = relationship === value;
    select.append(option);
  }
  return select;
}

function actionCell(id) {
  const td = document.createElement("td");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Save";
  button.addEventListener("click", () => saveBirthday(id));
  td.append(button);
  return td;
}

async function saveBirthday(id) {
  localStorage.setItem("adminToken", adminTokenInput.value);
  const row = birthdayTable.querySelector(`[data-id="${id}"]`);
  const payload = Object.fromEntries(new FormData(wrapRow(row)));
  const response = await fetch(`/api/birthdays/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    apiStatus.textContent = "Birthday save failed";
    apiStatus.className = "status-pill bad";
    return;
  }
  apiStatus.textContent = "Birthday saved";
  apiStatus.className = "status-pill ok";
  await Promise.all([loadBirthdays(), loadDashboard()]);
}

function wrapRow(row) {
  const form = document.createElement("form");
  row.querySelectorAll("input, select").forEach((element) => form.append(element.cloneNode(true)));
  return form;
}

async function addManualEvent(payload) {
  localStorage.setItem("adminToken", adminTokenInput.value);
  const response = await fetch("/api/work-events", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(payload)
  });

  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  await loadDashboard();
}

async function addCalendarEvent(payload) {
  localStorage.setItem("adminToken", adminTokenInput.value);
  const response = await fetch("/api/calendar-events", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(payload)
  });

  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  await loadDashboard();
}

async function addBirthday(payload) {
  localStorage.setItem("adminToken", adminTokenInput.value);
  const response = await fetch("/api/birthdays", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(payload)
  });

  if (handleUnauthorized(response)) {
    return;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  birthdayForm.reset();
  await Promise.all([loadBirthdays(), loadDashboard()]);
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function importBirthdays() {
  const file = birthdayFile.files[0];
  if (!file) {
    birthdayImportStatus.textContent = "Choose a CSV or Excel file first";
    return;
  }

  localStorage.setItem("adminToken", adminTokenInput.value);
  const formData = new FormData(birthdayImportForm);
  birthdayImportStatus.textContent = "Importing";
  const response = await fetch("/api/birthdays/import", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      filename: file.name,
      contentBase64: await fileToBase64(file),
      relationship: formData.get("relationship"),
      batchTag: formData.get("batchTag"),
      notify_days_before: Number(formData.get("notify_days_before") || 0)
    })
  });

  if (handleUnauthorized(response)) {
    return;
  }
  const result = await response.json();
  if (!response.ok) {
    birthdayImportStatus.textContent = result.error || "Import failed";
    return;
  }

  birthdayImportStatus.textContent = `Imported ${result.imported.length}. Skipped ${result.skipped.length}.`;
  await Promise.all([loadBirthdays(), loadDashboard()]);
}

async function saveServerChanKey(sendKey) {
  localStorage.setItem("adminToken", adminTokenInput.value);
  const response = await fetch("/api/settings/serverchan", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ sendKey })
  });

  if (handleUnauthorized(response)) {
    return;
  }
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
    headers: authHeaders()
  });

  if (handleUnauthorized(response)) {
    return;
  }
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

refreshBirthdaysButton.addEventListener("click", () => {
  loadBirthdays().catch(() => {
    apiStatus.textContent = "Birthdays load failed";
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

birthdayForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addBirthday(Object.fromEntries(new FormData(birthdayForm))).catch(() => {
    apiStatus.textContent = "Birthday add failed";
    apiStatus.className = "status-pill bad";
  });
});

birthdayFilters.addEventListener("submit", (event) => {
  event.preventDefault();
  loadBirthdays().catch(() => {
    apiStatus.textContent = "Birthdays load failed";
    apiStatus.className = "status-pill bad";
  });
});

birthdayImportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  importBirthdays().catch(() => {
    birthdayImportStatus.textContent = "Import failed";
  });
});

birthdayDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  birthdayDropZone.classList.add("dragging");
});

birthdayDropZone.addEventListener("dragleave", () => {
  birthdayDropZone.classList.remove("dragging");
});

birthdayDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  birthdayDropZone.classList.remove("dragging");
  if (event.dataTransfer.files.length) {
    birthdayFile.files = event.dataTransfer.files;
  }
});

runRemindersButton.addEventListener("click", () => {
  runReminders().catch(() => {
    apiStatus.textContent = "Reminder run failed";
    apiStatus.className = "status-pill bad";
  });
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

window.addEventListener("hashchange", () => showPage(pageFromHash()));

showPage(pageFromHash());
checkHealth();
loadDashboard().catch(() => {
  apiStatus.textContent = "Dashboard load failed";
  apiStatus.className = "status-pill bad";
});
loadBirthdays().catch(() => {
  apiStatus.textContent = "Birthdays load failed";
  apiStatus.className = "status-pill bad";
});
