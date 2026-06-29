const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const password = new FormData(loginForm).get("password");

  const response = await fetch("/api/login", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ password })
  });

  if (!response.ok) {
    loginError.textContent = "Wrong password";
    return;
  }

  window.location.href = "/";
});

