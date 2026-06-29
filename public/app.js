const apiStatus = document.querySelector("#apiStatus");
const settingsForm = document.querySelector("#settingsForm");

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

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  apiStatus.textContent = "Settings API coming next";
  apiStatus.className = "status-pill";
});

checkHealth();

