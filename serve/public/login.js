const form = document.querySelector("#loginForm");
const error = document.querySelector("#loginError");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  const password = new FormData(form).get("password");
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });

  if (!response.ok) {
    error.textContent = response.status === 429 ? "Too many attempts. Try again later." : "Login failed.";
    return;
  }

  window.location.href = "/";
});
